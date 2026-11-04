/**
 * Daily compartido (docs/05): una mesa puede tener varias ejecutivas. Cada una deja sus notas y, si quiere, marca su parte
 * como lista: es información, nadie queda esperando a nadie. Lo que se suma después de publicar va como comentario en el
 * mismo mensaje, para que el daily quede unificado.
 */
import { hoyLocal, horaLocal, inicioDiaLocal, nombrePersona } from '@backio/shared';
import type { Cliente, Mesa, Usuario } from '@backio/shared';
import type { DbCtx } from '../db/client';
import { listClientes, listMesas, listBacklog, listUsuarios } from '../db';
import { alcanceMesa } from '../db/mesas';
import { listAgregadosDaily, listPublicacionesDaily } from '../db/evolutivo';
import { listPreparacion, type FilaPreparacion, type TipoDaily } from '../db/daily_preparacion';
import { idsClientesDePrueba } from '../db/clientes';
import { notificar } from '../notificaciones';
import type { DailyItem, DailyMensaje } from '../mcp/publish';
import { env } from '../../config/env';

const primerNombre = (s: string) => s.split(' ')[0] ?? s;

/** Notas de todas para el mensaje. Con una sola autora van tal cual; con varias, cada nota dice de quién es. */
export function notasUnificadas(prep: FilaPreparacion[], nombre: (id: string) => string, extra: string[] = []): string[] {
  const conNotas = prep.filter((p) => p.notas.length);
  const varias = conNotas.length > 1 || (conNotas.length === 1 && extra.length > 0);
  return [...conNotas.flatMap((p) => p.notas.map((n) => (varias ? `${primerNombre(nombre(p.usuario_id))}: ${n}` : n))), ...extra];
}

/** «Carolina y Grace»: quienes prepararon (notas o «lista») y quien publica, sin repetir. */
export function responsablesDaily(prep: FilaPreparacion[], nombre: (id: string) => string, quienPublica: string): string {
  const nombres = [...new Set([...prep.filter((p) => p.notas.length || p.listo_at).map((p) => nombre(p.usuario_id)), quienPublica])];
  return nombres.length > 1 ? `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}` : (nombres[0] ?? quienPublica);
}

const itemsDe = (m: Pick<DailyMensaje, 'hoy' | 'completadas' | 'completadas_fuera'>) => [
  ...m.hoy,
  ...(m.completadas ?? []),
  ...(m.completadas_fuera ?? []),
];

/** Lo que quedó registrado de una publicación: permite saber qué falta sumar después. */
export function huellaDaily(m: DailyMensaje): { ids: string[]; notas: string[] } {
  return { ids: itemsDe(m).flatMap((i) => (i.id ? [i.id] : [])), notas: m.notas };
}

export interface AgregadoDaily {
  notas: string[];
  hoy: DailyItem[];
  completadas: DailyItem[];
  completadas_fuera: DailyItem[];
  vacio: boolean;
}

/** Lo que el mensaje de ahora tiene y lo publicado todavía no: tareas y notas nuevas. Pura. */
export function pendienteDeAgregar(m: DailyMensaje, ya: { ids?: string[]; notas?: string[] }[]): AgregadoDaily {
  const ids = new Set(ya.flatMap((x) => x.ids ?? []));
  const notas = new Set(ya.flatMap((x) => x.notas ?? []));
  const nuevas = (xs: DailyItem[] = []) => xs.filter((i) => !i.id || !ids.has(i.id));
  // La misma nota puede volver con o sin autora: al publicar sola salía «x» y ahora, con otra autora, «Ana: x».
  const sinAutora = new Set([...notas].map((n) => n.replace(/^[^:]+: /, '')));
  const a = {
    notas: m.notas.filter((n) => !notas.has(n) && !sinAutora.has(n.replace(/^[^:]+: /, ''))),
    hoy: nuevas(m.hoy),
    completadas: nuevas(m.completadas),
    completadas_fuera: nuevas(m.completadas_fuera),
  };
  return { ...a, vacio: !a.notas.length && !a.hoy.length && !a.completadas.length && !a.completadas_fuera.length };
}

export interface PersonaDaily {
  usuario_id: string;
  nombre: string;
  cuentas: number;
  tareas_hoy: number;
  notas: string[];
  listo_at: string | null;
}

/** Quién participa en el daily de la mesa: ejecutivas de sus cuentas y quien ya dejó algo. Pura. */
export function personasDaily(
  clientes: Pick<Cliente, 'id' | 'ejecutiva_id'>[],
  tareasHoy: { cliente_id: string }[],
  prep: FilaPreparacion[],
  nombre: (id: string) => string,
): PersonaDaily[] {
  const ids = new Set<string>([...clientes.flatMap((c) => (c.ejecutiva_id ? [c.ejecutiva_id] : [])), ...prep.map((p) => p.usuario_id)]);
  const ejecutivaDe = new Map(clientes.map((c) => [c.id, c.ejecutiva_id]));
  return [...ids]
    .map((id) => {
      const p = prep.find((x) => x.usuario_id === id);
      return {
        usuario_id: id,
        nombre: nombre(id),
        cuentas: clientes.filter((c) => c.ejecutiva_id === id).length,
        tareas_hoy: tareasHoy.filter((t) => ejecutivaDe.get(t.cliente_id) === id).length,
        notas: p?.notas ?? [],
        listo_at: p?.listo_at ?? null,
      };
    })
    .sort((a, b) => b.cuentas - a.cuentas || a.nombre.localeCompare(b.nombre, 'es'));
}

/** Avisos informativos sobre quién no ha terminado: nunca impiden publicar. */
export function faltanEnDaily(personas: PersonaDaily[], yo: string | null): string[] {
  return personas
    .filter((p) => p.usuario_id !== yo && p.cuentas > 0 && !p.listo_at && !p.notas.length)
    .map(
      (p) =>
        `${primerNombre(p.nombre)} no ha marcado su parte: ${p.cuentas} ${p.cuentas === 1 ? 'cuenta' : 'cuentas'}, ${p.tareas_hoy} ${p.tareas_hoy === 1 ? 'tarea' : 'tareas'} para hoy.`,
    );
}

const enlaceMensaje = (mesa: Pick<Mesa, 'basecamp_project_id'>, id: number) =>
  `https://3.basecamp.com/${env().BASECAMP_ACCOUNT_ID}/buckets/${mesa.basecamp_project_id}/messages/${id}`;

export interface EstadoDaily {
  personas: PersonaDaily[];
  publicacion: { hora: string; por: string; url: string | null; agregados: number } | null;
}

/** Cómo va el daily de la mesa hoy: quién preparó qué y si ya se publicó. */
export async function estadoDaily(ctx: DbCtx, mesa: Mesa, tipo: TipoDaily, hoy = hoyLocal()): Promise<EstadoDaily> {
  const inicio = inicioDiaLocal(hoy);
  const [prep, clientes, usuarios, prueba, alcance, publicadas, agregados] = await Promise.all([
    listPreparacion(ctx, mesa.id, hoy, tipo),
    listClientes(ctx),
    listUsuarios(ctx, { incluirInactivos: true }),
    idsClientesDePrueba(ctx),
    alcanceMesa(ctx, mesa.id, { sinPrueba: true }),
    listPublicacionesDaily(ctx, mesa.id, inicio),
    listAgregadosDaily(ctx, mesa.id, inicio),
  ]);
  const nombre = nombreDe(usuarios);
  const activos = await listBacklog(ctx, { solo_activos: true, mesa: alcance });
  const previas = publicadas.filter((x) => x.accion === `publicar_daily_${tipo}`);
  const ultima = previas[previas.length - 1];
  return {
    personas: personasDaily(
      clientes.filter((c) => c.activo && c.mesa_id === mesa.id && !prueba.has(c.id)),
      activos.filter((r) => r.daily_fecha === hoy),
      prep,
      nombre,
    ),
    publicacion: ultima
      ? {
          hora: horaLocal(ultima.created_at),
          por: ultima.usuario_id ? nombre(ultima.usuario_id) : 'BackIO',
          url: ultima.detalle.url ?? (ultima.detalle.message_id ? enlaceMensaje(mesa, ultima.detalle.message_id) : null),
          agregados: agregados.filter((x) => x.accion === `agregar_daily_${tipo}`).length,
        }
      : null,
  };
}

export function nombreDe(usuarios: Pick<Usuario, 'id' | 'nombre' | 'activo'>[]): (id: string) => string {
  return (id) => {
    const u = usuarios.find((x) => x.id === id);
    return u ? nombrePersona(u) : 'Alguien';
  };
}

/** Quién recibe el recordatorio: ejecutivas de las cuentas de la mesa y su líder. Pura. */
export function destinatariosRecordatorio(
  mesa: Pick<Mesa, 'id' | 'lider_id'>,
  clientes: Pick<Cliente, 'mesa_id' | 'ejecutiva_id'>[],
): string[] {
  return [
    ...new Set([
      ...clientes.flatMap((c) => (c.mesa_id === mesa.id && c.ejecutiva_id ? [c.ejecutiva_id] : [])),
      ...(mesa.lider_id ? [mesa.lider_id] : []),
    ]),
  ];
}

/** Si a esa hora la mesa no publicó, recuerda por la campana. No publica nada ni manda correo. */
export async function recordarDaily(ctx: DbCtx, tipo: TipoDaily, hoy = hoyLocal()): Promise<{ mesas: number; avisados: number }> {
  const [mesas, clientes, prueba] = await Promise.all([listMesas(ctx), listClientes(ctx), idsClientesDePrueba(ctx)]);
  const reales = clientes.filter((c) => c.activo && !prueba.has(c.id));
  let n = 0,
    avisados = 0;
  for (const mesa of mesas.filter((m) => m.activa && m.basecamp_board_daily_id)) {
    const publicadas = await listPublicacionesDaily(ctx, mesa.id, inicioDiaLocal(hoy));
    if (publicadas.some((x) => x.accion === `publicar_daily_${tipo}`)) continue;
    const destino = destinatariosRecordatorio(mesa, reales);
    if (!destino.length) continue;
    n += 1;
    avisados += await notificar(
      ctx,
      {
        tipo: 'daily_recordatorio',
        titulo: `Falta ${tipo === 'apertura' ? 'la apertura' : 'el cierre'} de ${mesa.nombre}`,
        cuerpo: `Hoy no se ha publicado ${tipo === 'apertura' ? 'la apertura' : 'el cierre'}. Cualquiera de la mesa puede hacerlo.`,
        ruta: `/daily?mesa=${mesa.id}`,
      },
      { usuarioIds: destino },
      { soloCampana: true },
    );
  }
  return { mesas: n, avisados };
}
