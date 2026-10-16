/**
 * Salida de un colaborador (docs/20-salida.md). Quien se va se desactiva, nunca se borra: su historia sigue siendo
 * suya y lo abierto pasa a otras personas con rastro por tarea.
 *
 * Dos pasos, como Mantenimiento:
 * 1. `inventarioSalida`: todo lo que la persona tiene abierto, con un destino propuesto (el líder de la mesa de
 *    cada cliente). No escribe nada.
 * 2. `aplicarSalida`: recibe el plan confirmado y lo aplica en una transacción (RPC salida_colaborador, que falla si
 *    algo abierto quedó fuera del plan). Después, fuera de la transacción: bloqueo en Supabase Auth, cambio de
 *    responsable en Basecamp (lotes de 50) y auditoría por tarea.
 */
import { esHeredada, hoyLocal, nombrePersona } from '@backio/shared';
import { serviceClient, DbError, type DbCtx } from './db/client';
import { borrarCredencialesPersona } from './db/credenciales';
import { audit } from './db/audit';
import { listUsuarios } from './db/usuarios';
import { listClientes } from './db/clientes';
import { listMesas } from './db/mesas';
import { listRecurrencias } from './db/recurrencias';
import {
  acuerdosPendientesDe,
  contarApiKeysDe,
  proyectosParaSalida,
  registrarSalida,
  tareasAbiertasDe,
  type ResultadoSalidaRpc,
  type TareaDeSalida,
} from './db/salida';
import { LIMITE_TODOS_POR_OPERACION, reemplazarResponsableEnTodos, type CambioResponsableBasecamp } from './basecamp/write';
import { BasecampClient } from './basecamp/client';
import { log } from './logger';

export interface InventarioSalida {
  persona: { id: string; nombre: string; rol: string };
  /** Personas activas a las que se puede pasar lo suyo. */
  destinos: { id: string; nombre: string }[];
  clientes: {
    cliente_id: string;
    cliente: string;
    propuesto: string | null;
    tareas: {
      id: string;
      titulo: string;
      proyecto: string | null;
      fecha_entrega: string | null;
      estado: string;
      en_daily: boolean;
      en_basecamp: boolean;
      heredada: boolean;
      otros_responsables: string[];
      propuesto: string | null;
    }[];
  }[];
  proyectos: { id: string; nombre: string; cliente: string; propuesto: string | null }[];
  mesas: { id: string; nombre: string; propuesto: string | null }[];
  acuerdos: { id: string; descripcion: string; fecha_compromiso: string; propuesto: string | null }[];
  recurrencias: { id: string; nombre: string; cliente: string; propuesto: string | null }[];
  api_keys: number;
}

/** Recurrencias donde la persona es la ejecutiva o responsable de algún bloque. */
function esDeRecurrencia(r: { owner_ejecutiva: string | null; bloques: unknown[] }, usuarioId: string): boolean {
  return r.owner_ejecutiva === usuarioId || r.bloques.some((b) => (b as { owner_id?: unknown } | null)?.owner_id === usuarioId);
}

export async function inventarioSalida(ctx: DbCtx, usuarioId: string): Promise<InventarioSalida> {
  const usuarios = await listUsuarios(ctx, { incluirInactivos: true });
  const persona = usuarios.find((u) => u.id === usuarioId);
  if (!persona) throw new DbError('Usuario no encontrado', 404);
  if (!persona.activo) throw new DbError(`${persona.nombre} ya no tiene acceso`, 422);
  if (usuarioId === ctx.usuarioId) throw new DbError('No puedes registrar tu propia salida', 422);

  const [tareas, clientes, mesas, recurrencias, acuerdos, apiKeys] = await Promise.all([
    tareasAbiertasDe(ctx, usuarioId),
    listClientes(ctx, { incluirInactivos: true }),
    listMesas(ctx),
    listRecurrencias(ctx),
    acuerdosPendientesDe(ctx, usuarioId),
    contarApiKeysDe(ctx, usuarioId),
  ]);
  const proyectos = await proyectosParaSalida(ctx, usuarioId, [...new Set(tareas.flatMap((t) => (t.proyecto_id ? [t.proyecto_id] : [])))]);

  const activos = new Map(usuarios.filter((u) => u.activo && u.id !== usuarioId).map((u) => [u.id, u]));
  const nombre = (id: string) => {
    const u = usuarios.find((x) => x.id === id);
    return u ? nombrePersona(u) : '—';
  };
  const cliente = new Map(clientes.map((c) => [c.id, c]));
  const proyecto = new Map(proyectos.map((p) => [p.id, p]));
  const mesa = new Map(mesas.map((m) => [m.id, m]));
  // Propuesta: el líder de la mesa (la del proyecto si la declara, si no la del cliente), si sigue activo.
  const liderDe = (mesaId: string | null | undefined) => {
    const l = mesaId ? mesa.get(mesaId)?.lider_id : null;
    return l && activos.has(l) ? l : null;
  };
  const mesaDeCliente = (clienteId: string) => cliente.get(clienteId)?.mesa_id ?? null;
  const hoy = hoyLocal();

  const grupos = new Map<string, InventarioSalida['clientes'][number]>();
  for (const t of tareas) {
    const p = t.proyecto_id ? proyecto.get(t.proyecto_id) : undefined;
    const g = grupos.get(t.cliente_id) ?? {
      cliente_id: t.cliente_id,
      cliente: cliente.get(t.cliente_id)?.nombre ?? '—',
      propuesto: liderDe(mesaDeCliente(t.cliente_id)),
      tareas: [],
    };
    g.tareas.push({
      id: t.id,
      titulo: t.titulo_interno,
      proyecto: p?.nombre ?? null,
      fecha_entrega: t.fecha_entrega,
      estado: t.estado_operativo,
      en_daily: !!t.daily_fecha,
      en_basecamp: !!t.basecamp_todo_id,
      heredada: esHeredada(t.fecha_entrega, hoy),
      otros_responsables: t.owner_agencia.filter((o) => o !== usuarioId).map(nombre),
      propuesto: liderDe(p?.mesa_id ?? mesaDeCliente(t.cliente_id)),
    });
    grupos.set(t.cliente_id, g);
  }

  return {
    persona: { id: persona.id, nombre: persona.nombre, rol: persona.rol },
    destinos: [...activos.values()].map((u) => ({ id: u.id, nombre: u.nombre })),
    clientes: [...grupos.values()].sort((a, b) => a.cliente.localeCompare(b.cliente)),
    proyectos: proyectos
      .filter((p) => p.owner_ejecutiva === usuarioId && p.estado !== 'completado' && p.estado !== 'cancelado')
      .map((p) => ({
        id: p.id,
        nombre: p.nombre,
        cliente: cliente.get(p.cliente_id)?.nombre ?? '—',
        propuesto: liderDe(p.mesa_id ?? mesaDeCliente(p.cliente_id)),
      })),
    mesas: mesas.filter((m) => m.lider_id === usuarioId).map((m) => ({ id: m.id, nombre: m.nombre, propuesto: null })),
    acuerdos: acuerdos.map((a) => ({ ...a, propuesto: null })),
    recurrencias: recurrencias
      .filter((r) => esDeRecurrencia(r, usuarioId))
      .map((r) => ({
        id: r.id,
        nombre: r.nombre_patron,
        cliente: cliente.get(r.cliente_id)?.nombre ?? '—',
        propuesto: liderDe(mesaDeCliente(r.cliente_id)),
      })),
    api_keys: apiKeys,
  };
}

export interface PlanSalida {
  fecha_salida: string;
  motivo?: string | null;
  tareas: { id: string; a: string | null }[];
  proyectos: { id: string; a: string | null }[];
  mesas: { id: string; a: string | null }[];
  acuerdos: { id: string; a: string }[];
  recurrencias: { id: string; a: string | null }[];
}

export interface ResultadoSalida extends ResultadoSalidaRpc {
  heredadas: number;
  auth_bloqueado: boolean;
  auth_error: string | null;
  basecamp: { actualizados: number; sin_cambios: number; errores: { requerimientoId: string; error: string }[] };
}

/**
 * Bloquea el ingreso en Supabase Auth. Devuelve el error, o null si salió bien.
 * No hace falta cerrar sesiones aparte: un usuario bloqueado no puede renovar su sesión, y BackIO rechaza a los
 * inactivos en cada petición (middleware). `auth.admin.signOut` recibe el JWT de la persona, no su id: llamarlo con el
 * id fallaba siempre («invalid JWT»).
 */
export async function bloquearEnAuth(usuarioId: string): Promise<string | null> {
  try {
    const ban = await serviceClient().auth.admin.updateUserById(usuarioId, { ban_duration: '876600h' });
    return ban.error ? ban.error.message : null;
  } catch (err) {
    return err instanceof Error ? err.message : 'error';
  }
}

export async function aplicarSalida(ctx: DbCtx, usuarioId: string, plan: PlanSalida): Promise<ResultadoSalida> {
  // Se vuelve a leer todo: el plan solo decide destinos; qué está abierto y qué es «heredada» lo calcula el backend.
  const [inv, abiertas] = await Promise.all([inventarioSalida(ctx, usuarioId), tareasAbiertasDe(ctx, usuarioId)]);
  const tareas = new Map(inv.clientes.flatMap((g) => g.tareas).map((t) => [t.id, t]));
  for (const t of plan.tareas) {
    if (t.a === null && tareas.get(t.id)?.en_daily) {
      throw new DbError(`«${tareas.get(t.id)!.titulo}» está en el daily: necesita un responsable`, 422);
    }
  }
  const planRpc = {
    tareas: plan.tareas.map((t) => ({ id: t.id, a: t.a, heredada: t.a !== null && (tareas.get(t.id)?.heredada ?? false) })),
    proyectos: plan.proyectos,
    mesas: plan.mesas,
    acuerdos: plan.acuerdos,
    recurrencias: plan.recurrencias,
  };
  // Los cambios de responsable en Basecamp van a nombre del admin que registra la salida (su cuenta). Se pide antes de
  // la transacción: si no conectó su Basecamp, no se aplica nada (migración 33).
  const bc = abiertas.some((t) => t.basecamp_todo_id) ? await BasecampClient.forActor(ctx) : undefined;
  const r = await registrarSalida(ctx, usuarioId, { fecha: plan.fecha_salida, motivo: plan.motivo ?? null, plan: planRpc });

  // Fuera de la transacción: la persona ya está inactiva en BackIO (el middleware la rechaza) aunque esto falle.
  const authError = await bloquearEnAuth(usuarioId);
  // Su cuenta de Basecamp deja de estar conectada a BackIO.
  await borrarCredencialesPersona(usuarioId).catch((e) => log.error('[salida] no se borró su conexión con Basecamp', e));
  const basecamp = bc
    ? await cambiarEnBasecamp(ctx, usuarioId, abiertas, plan.tareas, bc)
    : { actualizados: 0, sin_cambios: 0, errores: [] };

  const de = inv.persona.nombre;
  const nombreDestino = new Map(inv.destinos.map((d) => [d.id, d.nombre]));
  for (const t of planRpc.tareas) {
    await audit(ctx, {
      accion: 'salida_reasignacion',
      entidad: 'requerimiento',
      entidad_id: t.id,
      detalle: { de: usuarioId, de_nombre: de, a: t.a, a_nombre: t.a ? (nombreDestino.get(t.a) ?? null) : null, heredada: t.heredada },
    });
  }
  const resultado: ResultadoSalida = {
    ...r,
    heredadas: planRpc.tareas.filter((t) => t.heredada).length,
    auth_bloqueado: authError === null,
    auth_error: authError,
    basecamp,
  };
  await audit(ctx, {
    accion: 'salida_colaborador',
    entidad: 'usuario',
    entidad_id: usuarioId,
    detalle: { nombre: de, fecha_salida: plan.fecha_salida, motivo: plan.motivo ?? null, ...resultado },
  });
  return resultado;
}

/** Cambia al responsable en los to-dos abiertos enlazados, en lotes de 50. Un fallo no deshace lo hecho en BackIO. */
async function cambiarEnBasecamp(
  ctx: DbCtx,
  usuarioId: string,
  abiertas: TareaDeSalida[],
  plan: PlanSalida['tareas'],
  bc: BasecampClient,
): Promise<ResultadoSalida['basecamp']> {
  const out: ResultadoSalida['basecamp'] = { actualizados: 0, sin_cambios: 0, errores: [] };
  const [usuarios, clientes] = await Promise.all([
    listUsuarios(ctx, { incluirInactivos: true }),
    listClientes(ctx, { incluirInactivos: true }),
  ]);
  const bcDe = new Map(usuarios.flatMap((u) => (u.basecamp_user_id ? [[u.id, u.basecamp_user_id] as [string, number]] : [])));
  const sale = bcDe.get(usuarioId);
  if (!sale) return out; // sin cuenta de Basecamp vinculada no hay nada que cambiar allá
  const destino = new Map(plan.map((t) => [t.id, t.a]));
  const proyectoBc = new Map(clientes.map((c) => [c.id, c.basecamp_project_id]));
  // Solo las del plan: la RPC ya verificó que eran todas las abiertas de la persona.
  const cambios: CambioResponsableBasecamp[] = [];
  for (const t of abiertas.filter((x) => destino.has(x.id))) {
    const projectId = proyectoBc.get(t.cliente_id);
    if (!t.basecamp_todo_id || !projectId) continue;
    const a = destino.get(t.id) ?? null;
    cambios.push({ requerimientoId: t.id, projectId, todoId: t.basecamp_todo_id, sale, entra: a ? (bcDe.get(a) ?? null) : null });
  }
  if (!cambios.length) return out;
  for (let i = 0; i < cambios.length; i += LIMITE_TODOS_POR_OPERACION) {
    const r = await reemplazarResponsableEnTodos(ctx, cambios.slice(i, i + LIMITE_TODOS_POR_OPERACION), bc);
    out.actualizados += r.actualizados;
    out.sin_cambios += r.sin_cambios;
    out.errores.push(...r.errores);
  }
  if (out.errores.length) log.warn('[salida] to-dos de Basecamp sin actualizar', out.errores.length);
  return out;
}
