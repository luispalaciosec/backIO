import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '../../lib/validacion';
import { requireScope, ctxOf } from '../../lib/auth/middleware';
import {
  ensureSemana,
  getSemana,
  listSenales,
  marcarSenalAtendida,
  insertAcuerdo,
  cerrarAcuerdo,
  listAcuerdosSemana,
  listAcuerdosAbiertos,
  getActa,
  audit,
} from '../../lib/db';
import { recalcularSenales, capacidadSemana, generarPlanOperativo, generarActaCierre, senalesDeMesa } from '../../lib/rituals/service';
import { getDaily, avisosAntesDePublicar, type MotivoConfirmacion } from '../../lib/rituals/daily';
import { listClientes, listMesas, listBacklog } from '../../lib/db';
import { usuarioDelTenant } from '../../lib/db/admin';
import { alcanceMesa } from '../../lib/db/mesas';
import { cargaDelDia } from '../../lib/carga';
import { escenariosDelDia, preguntarSiSiguenVivas } from '../../lib/rituals/escenarios';
import { publicarActaEnBasecamp, publicarDailyEnBasecamp, type DailyMensaje } from '../../lib/mcp/publish';
import { getMesa } from '../../lib/db';
import { armarDailyMensaje, DailySinResponsable } from '../../lib/ia/daily';
import { narrarWeekly, renderWeeklyIA } from '../../lib/ia/weekly';
import { fotoDaily } from '../../lib/evolutivo';
import { listPublicacionesDaily } from '../../lib/db/evolutivo';
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
});

// Tres campos: acuerdo, responsable, fecha. La fecha es un date picker real: sin "próxima weekly".
semanas.post('/:id/acuerdos', requireScope('write:actas'), zValidator('json', crearAcuerdoSchema), async (c) => {
  const ctx = ctxOf(c);
  const a = await insertAcuerdo(ctx, { semana_id: c.req.param('id'), ...c.req.valid('json') });
  await audit(ctx, { accion: 'crear_acuerdo', entidad: 'acuerdo', entidad_id: a.id });
  return c.json(a, 201);
});

semanas.post(
  '/:id/acuerdos/:acuerdoId/cerrar',
  requireScope('write:actas'),
  zValidator('json', z.object({ estado: z.enum(['cumplido', 'cancelado']) })),
  async (c) => {
    await cerrarAcuerdo(ctxOf(c), c.req.param('acuerdoId'), c.req.valid('json').estado);
    return c.body(null, 204);
  },
);

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

/** Publica apertura o cierre de mesa en el board Daily, con las tres señales del daily acotadas a la mesa. */
semanas.post(
  '/daily/publicar',
  requireScope('write:actas'),
  zValidator(
    'json',
    z.object({
      mesa_id: z.string().uuid(),
      tipo: z.enum(['apertura', 'cierre']),
      notas: z.array(z.string()).default([]),
      responsable: z.string().optional(),
      narrativa: z.string().max(4000).optional(),
      // Publicar otra vez lo que ya salió hoy (la pantalla lo pide tras confirmar).
      repetir: z.boolean().default(false),
      // Avisos que la persona ya confirmó en pantalla (otra mesa, apertura tarde, nada elegido para hoy).
      confirmado: z.array(z.enum(['ya_publicado', 'otra_mesa', 'tarde', 'sin_hoy'])).default([]),
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
      const hoy = hoyLocal();
      const previas = (await listPublicacionesDaily(ctx, mesa.id, inicioDiaLocal(hoy))).filter(
        (x) => x.accion === `publicar_daily_${b.tipo}`,
      );
      if (previas.length && !b.repetir && !b.confirmado.includes('ya_publicado')) {
        const hora = horaLocal(previas[previas.length - 1]!.created_at);
        return c.json(
          { error: `La ${b.tipo} de ${mesa.nombre} ya se publicó hoy a las ${hora}.`, ya_publicado: true, hora, motivos: ['ya_publicado'] },
          409,
        );
      }
      let m: DailyMensaje;
      try {
        m = {
          ...(await armarDailyMensaje(ctx, mesa, b.tipo, b.notas, b.responsable ?? c.get('auth').nombre)),
          narrativa: b.narrativa?.trim() || undefined,
        };
      } catch (err) {
        if (err instanceof DailySinResponsable) return c.json({ error: err.message, tareas: err.tareas }, 422);
        throw err;
      }
      // Antes de avisar a todo el equipo: ¿es tu mesa?, ¿es hora de apertura?, ¿hay algo elegido para hoy?
      const auth = c.get('auth');
      const [clientes, mesas, activosHoy, lider] = await Promise.all([
        listClientes(ctx, { incluirInactivos: true }),
        listMesas(ctx),
        b.tipo === 'apertura' ? listBacklog(ctx, { solo_activos: true }) : Promise.resolve([]),
        mesa.lider_id ? usuarioDelTenant(ctx, mesa.lider_id) : Promise.resolve(null),
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
      const publicoAntes = (await listPublicacionesDaily(ctx, mesa.id, inicioDiaLocal(sumarDias(hoy, -30)))).some(
        (x) => x.usuario_id === yo,
      );
      const avisos = avisosAntesDePublicar({
        tipo: b.tipo,
        mesa,
        usuarioId: yo,
        llevaTodas: auth.tipo !== 'usuario' || ['admin', 'gerencia', 'operaciones'].includes(auth.rol ?? ''),
        mesasDeSusCuentas: new Set(clientes.filter((x) => yo && x.ejecutiva_id === yo && x.mesa_id).map((x) => x.mesa_id!)),
        publicoAntes,
        hora: horaLocal(new Date().toISOString()),
        hoySeTrabaja: m.hoy.length,
        suHoyEnOtrasMesas,
        liderNombre: lider?.nombre ?? null,
      }).filter((a) => !b.confirmado.includes(a.motivo));
      if (avisos.length)
        return c.json(
          {
            error: `${avisos.map((a) => a.mensaje).join(' ')} La ${b.tipo} avisa a todo el equipo de ${mesa.nombre}.`,
            motivos: avisos.map((a) => a.motivo) satisfies MotivoConfirmacion[],
          },
          409,
        );
      try {
        const r = await publicarDailyEnBasecamp(ctx, mesa, m);
        await audit(ctx, { accion: `publicar_daily_${b.tipo}`, entidad: 'mesa', entidad_id: mesa.id, detalle: { message_id: r.id } });
        // Evolutivo: el cierre publicado deja la foto del día (no bloquea la respuesta si falla).
        if (b.tipo === 'cierre')
          await fotoDaily({ ...ctx, db: serviceClient() }, mesa, undefined, 'cierre').catch((e: Error) =>
            log.error('[evolutivo] foto del cierre', e.message),
          );
        return c.json({
          ...r,
          resumen: {
            hoy: m.hoy.length,
            vencen: m.vencen.length,
            atrasadas: m.atrasadas.length,
            bloqueos: m.bloqueos.length,
            cambios: m.cambios.length,
            completadas: (m.completadas?.length ?? 0) + (m.completadas_fuera?.length ?? 0),
          },
        });
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 422);
      }
    });
  },
);
