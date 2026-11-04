import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '../../lib/validacion';
import { requireScope, ctxOf, type AuthInfo } from '../../lib/auth/middleware';
import type { Mesa } from '@backio/shared';
import {
  ensureSemana,
  getSemana,
  listSenales,
  marcarSenalAtendida,
  insertAcuerdo,
  cerrarAcuerdo,
  cambiarFechaAcuerdo,
  listAcuerdosSemana,
  listAcuerdosAbiertos,
  getActa,
  audit,
} from '../../lib/db';
import {
  recalcularSenales,
  capacidadSemana,
  generarPlanOperativo,
  generarActaCierre,
  marcadorDeMesa,
  senalesDeMesa,
} from '../../lib/rituals/service';
import { sugerirReparto } from '../../lib/rituals/reparto';
import { idsClientesDePrueba } from '../../lib/db/clientes';
import { getDaily, avisosAntesDePublicar } from '../../lib/rituals/daily';
import {
  estadoDaily,
  faltanEnDaily,
  huellaDaily,
  nombreDe,
  notasUnificadas,
  pendienteDeAgregar,
  responsablesDaily,
} from '../../lib/rituals/daily_compartido';
import { guardarPreparacion, listPreparacion, type TipoDaily } from '../../lib/db/daily_preparacion';
import { notificar } from '../../lib/notificaciones';
import { getRequerimiento, listClientes, listMesas, listBacklog, listUsuarios } from '../../lib/db';
import type { DbCtx } from '../../lib/db/client';
import { usuarioDelTenant } from '../../lib/db/admin';
import { alcanceMesa } from '../../lib/db/mesas';
import { cargaDelDia, cargaDelEquipo } from '../../lib/carga';
import { escenariosDelDia, preguntarSiSiguenVivas } from '../../lib/rituals/escenarios';
import {
  comentarDailyEnBasecamp,
  cuerpoAgregado,
  cuerpoDaily,
  personasDelProyectoDaily,
  publicarActaEnBasecamp,
  publicarDailyEnBasecamp,
  tituloDaily,
  type DailyMensaje,
} from '../../lib/mcp/publish';
import { getMesa } from '../../lib/db';
import { armarDailyMensaje, DailySinResponsable } from '../../lib/ia/daily';
import { narrarWeekly, renderWeeklyIA } from '../../lib/ia/weekly';
import { fotoDaily } from '../../lib/evolutivo';
import { listAgregadosDaily, listPublicacionesDaily } from '../../lib/db/evolutivo';
import { conCandado } from '../../lib/candado';
import { serviceClient } from '../../lib/db/client';
import { hoyLocal, inicioDiaLocal, horaLocal, sumarDias } from '@backio/shared';
import { log } from '../../lib/logger';

export const semanas = new Hono();

semanas.get('/actual', requireScope('read:senales'), async (c) => c.json(await ensureSemana(ctxOf(c), hoyLocal())));

semanas.get('/daily', requireScope('read:backlog'), async (c) =>
  c.json(await getDaily(ctxOf(c), { mesaId: c.req.query('mesa') || undefined, ejecutivaId: c.req.query('ejecutiva') || undefined })),
);

/** Para armar el día: horas por tarea y persona, capacidad de un día y lo elegido en otras mesas (docs/05). */
semanas.get('/daily/carga', requireScope('read:backlog'), async (c) => {
  const ctx = ctxOf(c);
  const mesa = c.req.query('mesa');
  return c.json(await cargaDelDia(ctx, mesa ? await alcanceMesa(ctx, mesa, { sinPrueba: true }) : undefined));
});

/** Escenarios para armar el día (docs/05). `solo_mias=1`: solo con las cuentas de quien pregunta. */
semanas.get('/daily/escenarios', requireScope('read:backlog'), async (c) => {
  const ctx = ctxOf(c);
  return c.json(
    await escenariosDelDia(
      ctx,
      c.req.query('mesa') || undefined,
      c.req.query('solo_mias') === '1' ? (ctx.usuarioId ?? undefined) : undefined,
    ),
  );
});

/** «¿Sigue viva?»: avisa a la campana de los responsables de esas tareas atrasadas y quietas. */
semanas.post(
  '/daily/preguntar-vivas',
  requireScope('write:actas'),
  zValidator('json', z.object({ ids: z.array(z.string().uuid()).min(1).max(100) })),
  async (c) => {
    const ctx = ctxOf(c);
    const r = await preguntarSiSiguenVivas(ctx, c.req.valid('json').ids, c.get('auth').nombre);
    await audit(ctx, { accion: 'preguntar_sigue_viva', entidad: 'mesa', detalle: r });
    return c.json(r);
  },
);

semanas.get('/acuerdos/abiertos', requireScope('read:senales'), async (c) => c.json({ items: await listAcuerdosAbiertos(ctxOf(c)) }));

semanas.get('/:id', requireScope('read:senales'), async (c) => {
  const s = await getSemana(ctxOf(c), c.req.param('id'));
  return s ? c.json(s) : c.json({ error: 'No encontrada' }, 404);
});

// ?mesa= devuelve las señales de esa mesa (calculadas con sus clientes y proyectos), como el plan y el acta.
semanas.get('/:id/senales', requireScope('read:senales'), async (c) => {
  const ctx = ctxOf(c);
  const mesa = c.req.query('mesa');
  let items;
  if (mesa) {
    const s = await getSemana(ctx, c.req.param('id'));
    if (!s) return c.json({ error: 'No encontrada' }, 404);
    items = await senalesDeMesa(ctx, s, mesa);
  } else items = await listSenales(ctx, c.req.param('id'));
  return c.json({ items, total: items.length });
});

semanas.post('/:id/senales/recalcular', requireScope('write:actas'), async (c) => {
  // Una semana cerrada queda congelada: recalcular con el estado de hoy reescribiría su historia.
  const s = await getSemana(ctxOf(c), c.req.param('id'));
  if (s && s.fecha_fin < hoyLocal()) return c.json({ error: 'Esa semana ya cerró: sus señales quedan como estaban.' }, 409);
  const items = await recalcularSenales(ctxOf(c), c.req.param('id'));
  return c.json({ items, total: items.length });
});

// Botón «Atendida» del weekly (migración 35): por clave (tipo + entidad), porque la señal de una mesa puede no tener
// fila guardada; guarda quién y cuándo.
export const atenderSenalSchema = z.object({
  atendida: z.boolean(),
  senal: z.object({
    tipo: z.string().min(1),
    severidad: z.enum(['critica', 'alta', 'media']),
    entidad_tipo: z.enum(['requerimiento', 'usuario', 'cliente', 'proyecto', 'acuerdo']),
    entidad_id: z.string().uuid(),
    titulo: z.string().min(1).max(500),
    detalle: z.record(z.string(), z.unknown()).default({}),
  }),
});
semanas.post('/:id/senales/atender', requireScope('write:actas'), zValidator('json', atenderSenalSchema), async (c) => {
  const ctx = ctxOf(c);
  const { atendida, senal } = c.req.valid('json');
  await marcarSenalAtendida(ctx, c.req.param('id'), senal as never, atendida);
  await audit(ctx, {
    accion: atendida ? 'senal_atendida' : 'senal_reabierta',
    entidad: 'senal',
    entidad_id: senal.entidad_id,
    detalle: { tipo: senal.tipo },
  });
  return c.body(null, 204);
});

semanas.get('/:id/capacidad', requireScope('read:capacidad'), async (c) =>
  c.json({ items: await capacidadSemana(ctxOf(c), c.req.param('id'), c.req.query('mesa') || null) }),
);

semanas.get('/:id/acuerdos', requireScope('read:senales'), async (c) =>
  c.json({ items: await listAcuerdosSemana(ctxOf(c), c.req.param('id')) }),
);

export const crearAcuerdoSchema = z.object({
  descripcion: z.string().min(3),
  responsable_id: z.string().uuid(),
  fecha_compromiso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Mesa en cuyo weekly se acordó (migración 35). Sin mesa: weekly de toda la agencia. */
  mesa_id: z.string().uuid().nullable().optional(),
  /** Tarea sobre la que se acordó (migración 43). Opcional. */
  requerimiento_id: z.string().uuid().nullable().optional(),
});

// Tres campos: acuerdo, responsable, fecha. La fecha es un date picker real: sin "próxima weekly".
semanas.post('/:id/acuerdos', requireScope('write:actas'), zValidator('json', crearAcuerdoSchema), async (c) => {
  const ctx = ctxOf(c);
  const b = c.req.valid('json');
  if (b.requerimiento_id && !(await getRequerimiento(ctx, b.requerimiento_id))) return c.json({ error: 'La tarea no existe' }, 422);
  const a = await insertAcuerdo(ctx, { semana_id: c.req.param('id'), ...b });
  await audit(ctx, { accion: 'crear_acuerdo', entidad: 'acuerdo', entidad_id: a.id });
  return c.json(a, 201);
});

semanas.post(
  '/:id/acuerdos/:acuerdoId/cerrar',
  requireScope('write:actas'),
  zValidator('json', z.object({ estado: z.enum(['cumplido', 'cancelado']) })),
  async (c) => {
    const ctx = ctxOf(c);
    const { estado } = c.req.valid('json');
    await cerrarAcuerdo(ctx, c.req.param('acuerdoId'), estado);
    await audit(ctx, { accion: 'cerrar_acuerdo', entidad: 'acuerdo', entidad_id: c.req.param('acuerdoId'), detalle: { estado } });
    return c.body(null, 204);
  },
);

semanas.patch(
  '/:id/acuerdos/:acuerdoId/fecha',
  requireScope('write:actas'),
  zValidator('json', z.object({ fecha_compromiso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })),
  async (c) => {
    const ctx = ctxOf(c);
    const { fecha_compromiso } = c.req.valid('json');
    if (fecha_compromiso < hoyLocal()) return c.json({ error: 'La nueva fecha no puede estar en el pasado' }, 422);
    await cambiarFechaAcuerdo(ctx, c.req.param('acuerdoId'), fecha_compromiso);
    await audit(ctx, {
      accion: 'reprogramar_acuerdo',
      entidad: 'acuerdo',
      entidad_id: c.req.param('acuerdoId'),
      detalle: { fecha_compromiso },
    });
    return c.body(null, 204);
  },
);

/** Qué hacer con lo que no entra esta semana: a quién reasignarlo o qué fecha renegociar. Solo sugiere. */
semanas.get('/:id/reparto', requireScope('read:capacidad'), async (c) => {
  const ctx = ctxOf(c);
  const semana = await getSemana(ctx, c.req.param('id'));
  if (!semana) return c.json({ error: 'Semana no encontrada' }, 404);
  const mesa = c.req.query('mesa');
  const alcance = mesa ? await alcanceMesa(ctx, mesa, { sinPrueba: true }) : null;
  return c.json({
    items: sugerirReparto(await cargaDelEquipo(ctx, semana), {
      soloClientes: alcance ? new Set(alcance.clienteIds) : undefined,
      fechaRenegociar: sumarDias(semana.fecha_fin, 1),
    }),
  });
});

/** El marcador de la semana para el modo reunión. Solo por mesa, como en el plan y el acta. */
semanas.get('/:id/marcador', requireScope('read:senales'), async (c) => {
  const ctx = ctxOf(c);
  const semana = await getSemana(ctx, c.req.param('id'));
  const mesa = c.req.query('mesa');
  if (!semana || !mesa) return c.json({ error: 'Semana o mesa no encontrada' }, 404);
  const [alcance, prueba] = await Promise.all([alcanceMesa(ctx, mesa, { sinPrueba: true }), idsClientesDePrueba(ctx)]);
  return c.json({ marcador: (await marcadorDeMesa(ctx, semana, alcance, prueba, false)) ?? null });
});

/** ?ia=1 antepone el resumen ejecutivo y la agenda por causa redactados por la IA. */
async function narrativaOpcional(c: Parameters<typeof ctxOf>[0], semanaId: string, mesaId: string | null): Promise<string | undefined> {
  if (c.req.query('ia') !== '1') return undefined;
  return renderWeeklyIA(await narrarWeekly(ctxOf(c), semanaId, mesaId));
}

semanas.post('/:id/plan', requireScope('write:actas'), async (c) => {
  const ctx = ctxOf(c);
  const mesaId = c.req.query('mesa') || null;
  const acta = await generarPlanOperativo(ctx, c.req.param('id'), mesaId, await narrativaOpcional(c, c.req.param('id'), mesaId));
  await audit(ctx, { accion: 'generar_plan_operativo', entidad: 'acta', entidad_id: acta.id });
  return c.json(acta, 201);
});

semanas.post('/:id/acta', requireScope('write:actas'), async (c) => {
  const ctx = ctxOf(c);
  const mesaId = c.req.query('mesa') || null;
  const acta = await generarActaCierre(ctx, c.req.param('id'), mesaId, await narrativaOpcional(c, c.req.param('id'), mesaId));
  await audit(ctx, { accion: 'generar_acta_cierre', entidad: 'acta', entidad_id: acta.id });
  return c.json(acta, 201);
});

semanas.get('/actas/:actaId', requireScope('read:senales'), async (c) => {
  const a = await getActa(ctxOf(c), c.req.param('actaId'));
  return a ? c.json(a) : c.json({ error: 'No encontrada' }, 404);
});

semanas.post('/actas/:actaId/publicar', requireScope('write:actas'), async (c) => {
  const ctx = ctxOf(c);
  const acta = await getActa(ctx, c.req.param('actaId'));
  if (!acta) return c.json({ error: 'No encontrada' }, 404);
  if (acta.publicado_at) return c.json({ error: 'Ya publicada' }, 409);
  try {
    const r = await publicarActaEnBasecamp(ctx, acta);
    await audit(ctx, { accion: 'publicar_acta', entidad: 'acta', entidad_id: acta.id, detalle: r });
    return c.json(r);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 422);
  }
});

const TIPO_DAILY = z.enum(['apertura', 'cierre']);

/** El mensaje como saldría ahora: notas de todas, responsables y lo ya publicado hoy para saber qué falta sumar. */
async function armarDailyCompartido(
  ctx: DbCtx,
  mesa: Mesa,
  tipo: TipoDaily,
  b: { notas?: string[]; responsable?: string; narrativa?: string },
  quien: string,
) {
  const hoy = hoyLocal();
  const inicio = inicioDiaLocal(hoy);
  const [prep, usuarios, publicadas, agregados] = await Promise.all([
    listPreparacion(ctx, mesa.id, hoy, tipo),
    listUsuarios(ctx, { incluirInactivos: true }),
    listPublicacionesDaily(ctx, mesa.id, inicio),
    listAgregadosDaily(ctx, mesa.id, inicio),
  ]);
  const nombre = nombreDe(usuarios);
  const m: DailyMensaje = {
    ...(await armarDailyMensaje(
      ctx,
      mesa,
      tipo,
      notasUnificadas(prep, nombre, b.notas ?? []),
      b.responsable ?? responsablesDaily(prep, nombre, quien),
    )),
    narrativa: b.narrativa?.trim() || undefined,
  };
  const previas = publicadas.filter((x) => x.accion === `publicar_daily_${tipo}`);
  // Una publicación anterior a este registro no trae `ids` y su contenido se considera nuevo.
  const ya = [...previas, ...agregados.filter((x) => x.accion === `agregar_daily_${tipo}`)].map((x) => x.detalle);
  return { m, previas, agregado: pendienteDeAgregar(m, ya) };
}

/** ¿Es tu mesa?, ¿es hora de apertura?, ¿hay algo elegido para hoy? Se muestran en la vista previa; no impiden publicar. */
async function avisosDelDaily(ctx: DbCtx, auth: AuthInfo, mesa: Mesa, tipo: TipoDaily, hoySeTrabaja: number): Promise<string[]> {
  const hoy = hoyLocal();
  const [clientes, mesas, activosHoy, lider, publicaciones] = await Promise.all([
    listClientes(ctx, { incluirInactivos: true }),
    listMesas(ctx),
    tipo === 'apertura' ? listBacklog(ctx, { solo_activos: true }) : Promise.resolve([]),
    mesa.lider_id ? usuarioDelTenant(ctx, mesa.lider_id) : Promise.resolve(null),
    listPublicacionesDaily(ctx, mesa.id, inicioDiaLocal(sumarDias(hoy, -30))),
  ]);
  const yo = ctx.usuarioId;
  const mesaDe = new Map(clientes.map((x) => [x.id, x.mesa_id]));
  const suHoyEnOtrasMesas = [
    ...new Set(
      activosHoy
        .filter(
          (r) =>
            r.daily_fecha === hoy &&
            !!yo &&
            (r.owner_agencia.includes(yo) || clientes.find((x) => x.id === r.cliente_id)?.ejecutiva_id === yo),
        )
        .map((r) => mesaDe.get(r.cliente_id))
        .filter((id): id is string => !!id && id !== mesa.id),
    ),
  ].map((id) => mesas.find((x) => x.id === id)?.nombre ?? 'otra mesa');
  return avisosAntesDePublicar({
    tipo,
    mesa,
    usuarioId: yo,
    llevaTodas: auth.tipo !== 'usuario' || ['admin', 'gerencia', 'operaciones'].includes(auth.rol ?? ''),
    mesasDeSusCuentas: new Set(clientes.filter((x) => yo && x.ejecutiva_id === yo && x.mesa_id).map((x) => x.mesa_id!)),
    publicoAntes: publicaciones.some((x) => x.usuario_id === yo),
    hora: horaLocal(new Date().toISOString()),
    hoySeTrabaja,
    suHoyEnOtrasMesas,
    liderNombre: lider?.nombre ?? null,
  }).map((a) => a.mensaje);
}

/** Cómo va el daily de la mesa: quién preparó qué y si ya se publicó. */
semanas.get('/daily/preparacion', requireScope('read:backlog'), async (c) => {
  const ctx = ctxOf(c);
  const tipo = TIPO_DAILY.safeParse(c.req.query('tipo'));
  const mesa = await getMesa(ctx, c.req.query('mesa') ?? '');
  if (!tipo.success || !mesa) return c.json({ error: 'Mesa o tipo no válidos' }, 400);
  return c.json({ ...(await estadoDaily(ctx, mesa, tipo.data)), yo: ctx.usuarioId });
});

/** Mis notas y «Mi parte está lista». Cada persona escribe solo lo suyo. Marcar «lista» avisa por la campana a las demás. */
semanas.put(
  '/daily/preparacion',
  requireScope('write:actas'),
  zValidator(
    'json',
    z.object({
      mesa_id: z.string().uuid(),
      tipo: TIPO_DAILY,
      notas: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
      listo: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const ctx = ctxOf(c);
    const b = c.req.valid('json');
    const yo = ctx.usuarioId;
    if (!yo) return c.json({ error: 'Solo una persona puede preparar el daily' }, 403);
    const mesa = await getMesa(ctx, b.mesa_id);
    if (!mesa) return c.json({ error: 'Mesa no encontrada' }, 404);
    const hoy = hoyLocal();
    const mia = (await listPreparacion(ctx, mesa.id, hoy, b.tipo)).find((p) => p.usuario_id === yo);
    const listoAhora = b.listo === true && !mia?.listo_at;
    await guardarPreparacion(ctx, yo, mesa.id, hoy, b.tipo, {
      notas: b.notas ?? mia?.notas ?? [],
      listo_at: b.listo === undefined ? (mia?.listo_at ?? null) : b.listo ? (mia?.listo_at ?? new Date().toISOString()) : null,
    });
    const estado = await estadoDaily(ctx, mesa, b.tipo, hoy);
    if (listoAhora) {
      const quien = c.get('auth').nombre ?? 'Alguien';
      await notificar(
        ctx,
        {
          tipo: 'daily_listo',
          titulo: `${quien} terminó su parte ${b.tipo === 'apertura' ? 'de la apertura' : 'del cierre'}`,
          cuerpo: `${mesa.nombre}: ya puedes revisar y publicar, o sumar lo tuyo.`,
          ruta: `/daily?mesa=${mesa.id}`,
        },
        { usuarioIds: estado.personas.map((p) => p.usuario_id).filter((id) => id !== yo) },
        { soloCampana: true },
      );
    }
    return c.json({ ...estado, yo });
  },
);

/** El mensaje real antes de publicar, con lo que conviene saber. Un solo clic después. */
semanas.post(
  '/daily/vista-previa',
  requireScope('write:actas'),
  zValidator(
    'json',
    z.object({
      mesa_id: z.string().uuid(),
      tipo: TIPO_DAILY,
      notas: z.array(z.string()).default([]),
      narrativa: z.string().max(4000).optional(),
    }),
  ),
  async (c) => {
    const ctx = ctxOf(c);
    const auth = c.get('auth');
    const b = c.req.valid('json');
    const mesa = await getMesa(ctx, b.mesa_id);
    if (!mesa) return c.json({ error: 'Mesa no encontrada' }, 404);
    const quien = auth.nombre ?? 'BackIO';
    try {
      const { m, previas, agregado } = await armarDailyCompartido(ctx, mesa, b.tipo, b, quien);
      if (previas.length) {
        return c.json({
          modo: 'agregar',
          asunto: tituloDaily(m, mesa),
          html: agregado.vacio ? '' : cuerpoAgregado(agregado, b.tipo, quien),
          nada_nuevo: agregado.vacio,
          avisos: [],
          avisados: null,
          hora_publicada: horaLocal(previas[previas.length - 1]!.created_at),
        });
      }
      const [avisos, estado, avisados] = await Promise.all([
        avisosDelDaily(ctx, auth, mesa, b.tipo, m.hoy.length),
        estadoDaily(ctx, mesa, b.tipo),
        personasDelProyectoDaily(ctx, mesa),
      ]);
      return c.json({
        modo: 'publicar',
        asunto: tituloDaily(m, mesa),
        html: cuerpoDaily(m),
        nada_nuevo: false,
        avisos: [...avisos, ...faltanEnDaily(estado.personas, ctx.usuarioId)],
        avisados,
      });
    } catch (err) {
      if (err instanceof DailySinResponsable) return c.json({ error: err.message, tareas: err.tareas }, 422);
      throw err;
    }
  },
);

/**
 * Publica apertura o cierre de mesa en el board Daily. Si ya salió hoy, `agregar` suma lo nuevo como comentario en el mismo
 * mensaje; sin `agregar` responde 409, y así dos personas publicando a la vez no duplican el mensaje.
 */
semanas.post(
  '/daily/publicar',
  requireScope('write:actas'),
  zValidator(
    'json',
    z.object({
      mesa_id: z.string().uuid(),
      tipo: TIPO_DAILY,
      notas: z.array(z.string()).default([]),
      responsable: z.string().optional(),
      narrativa: z.string().max(4000).optional(),
      agregar: z.boolean().default(false),
      // Publicar un mensaje nuevo aunque ya haya uno hoy.
      repetir: z.boolean().default(false),
    }),
  ),
  async (c) => {
    const ctx = ctxOf(c);
    const b = c.req.valid('json');
    const mesa = await getMesa(ctx, b.mesa_id);
    if (!mesa) return c.json({ error: 'Mesa no encontrada' }, 404);
    // Una publicación por mesa, día y tipo: dos pestañas o un reintento ya no la duplican (revisión del 29/10/2026).
    // El candado ordena las llamadas simultáneas; la auditoría dice si ya salió hoy.
    return conCandado(`daily|${ctx.tenantId}|${mesa.id}|${b.tipo}`, async () => {
      const quien = c.get('auth').nombre ?? 'BackIO';
      let armado: Awaited<ReturnType<typeof armarDailyCompartido>>;
      try {
        armado = await armarDailyCompartido(ctx, mesa, b.tipo, b, quien);
      } catch (err) {
        if (err instanceof DailySinResponsable) return c.json({ error: err.message, tareas: err.tareas }, 422);
        throw err;
      }
      const { m, previas, agregado } = armado;
      const resumen = {
        hoy: m.hoy.length,
        vencen: m.vencen.length,
        atrasadas: m.atrasadas.length,
        bloqueos: m.bloqueos.length,
        cambios: m.cambios.length,
        completadas: (m.completadas?.length ?? 0) + (m.completadas_fuera?.length ?? 0),
      };
      if (previas.length && b.agregar) {
        const messageId = previas[previas.length - 1]!.detalle.message_id;
        if (!messageId) return c.json({ error: 'No se encontró el mensaje publicado para comentar en él.' }, 422);
        if (agregado.vacio) return c.json({ error: 'No hay nada nuevo que agregar: todo ya salió en el mensaje.' }, 422);
        try {
          const r = await comentarDailyEnBasecamp(ctx, mesa, messageId, (men) => cuerpoAgregado(agregado, b.tipo, quien, men));
          await audit(ctx, {
            accion: `agregar_daily_${b.tipo}`,
            entidad: 'mesa',
            entidad_id: mesa.id,
            detalle: { message_id: messageId, comment_id: r.id, url: r.url, ...huellaDaily(m) },
          });
          return c.json({ ...r, agregado: true, resumen });
        } catch (err) {
          return c.json({ error: err instanceof Error ? err.message : String(err) }, 422);
        }
      }
      if (previas.length && !b.repetir) {
        const hora = horaLocal(previas[previas.length - 1]!.created_at);
        return c.json({ error: `La ${b.tipo} de ${mesa.nombre} ya se publicó hoy a las ${hora}.`, ya_publicado: true, hora }, 409);
      }
      try {
        const r = await publicarDailyEnBasecamp(ctx, mesa, m);
        await audit(ctx, {
          accion: `publicar_daily_${b.tipo}`,
          entidad: 'mesa',
          entidad_id: mesa.id,
          detalle: { message_id: r.id, url: r.url, ...huellaDaily(m) },
        });
        // Evolutivo: el cierre publicado deja la foto del día (no bloquea la respuesta si falla).
        if (b.tipo === 'cierre')
          await fotoDaily({ ...ctx, db: serviceClient() }, mesa, undefined, 'cierre').catch((e: Error) =>
            log.error('[evolutivo] foto del cierre', e.message),
          );
        return c.json({ ...r, resumen });
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 422);
      }
    });
  },
);
