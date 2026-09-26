/**
 * Día a día: línea de tiempo de lo que cada persona hizo en BackIO. Sale de audit_log (acciones de
 * usuarios) y, para fechas anteriores al 21/09/2026 (cuando la auditoría de UI no se guardaba),
 * de reprogramaciones y reprocesos, que sí registraban a la persona.
 */
import type { DbCtx } from './db/client';
import { serviceClient, throwIf } from './db/client';
import { MOTIVOS_REPROGRAMACION, MOTIVOS_REPROCESO } from '@backio/shared';

export interface EventoActividad {
  id: string; fecha: string; usuario_id: string; nombre: string; avatar_url: string | null; rol: string;
  accion: string; texto: string; entidad: string; entidad_id: string | null; titulo: string | null; cliente: string | null; ruta: string | null; origen: string;
}

const FIX_AUDITORIA = '2026-09-21T00:00:00-05:00';
const ESTADO: Record<string, string> = { backlog: 'Backlog', priorizado: 'Priorizado', en_ejecucion: 'En proceso', en_revision: 'En revisión', reprogramado: 'Reprogramado', bloqueado: 'Bloqueado', completado: 'Completado', cancelado: 'Cancelado' };
const APROB: Record<string, string> = { no_aplica: 'Sin estado', pendiente_interno: 'Pendiente interno', pendiente_cliente: 'Pendiente cliente', aprobado: 'Aprobado', rechazado: 'Cambios solicitados' };
const fmt = (iso: unknown) => (typeof iso === 'string' && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');

function describir(accion: string, d: Record<string, unknown>): string {
  switch (accion) {
    case 'crear': return 'creó la tarea';
    case 'eliminar': return 'eliminó la tarea';
    case 'reprogramar': return `movió la entrega del ${fmt(d.de)} al ${fmt(d.a)}${d.motivo_reprogramacion ? ` · ${MOTIVOS_REPROGRAMACION.find((m) => m.valor === d.motivo_reprogramacion)?.label ?? d.motivo_reprogramacion}` : ''}`;
    case 'actualizar': {
      const p: string[] = [];
      if (d.estado_operativo) p.push(`estado → ${ESTADO[String(d.estado_operativo)] ?? d.estado_operativo}`);
      if (d.estado_aprobacion) p.push(`aprobación → ${APROB[String(d.estado_aprobacion)] ?? d.estado_aprobacion}`);
      if (d.prioridad) p.push(`prioridad → ${d.prioridad}`);
      if (d.planificacion) p.push(`planificación → ${String(d.planificacion).replace('_', ' ')}`);
      if (d.owner_agencia) p.push('cambió responsables');
      if (d.titulo_interno) p.push('renombró la tarea');
      if ('daily_fecha' in d) p.push(d.daily_fecha ? 'la marcó para el daily de hoy' : 'la quitó del daily');
      if (d.entregable_urls) p.push('actualizó entregables');
      if (d.piezas !== undefined) p.push(`piezas → ${d.piezas}`);
      if (d.peso !== undefined) p.push(`peso → ${d.peso}`);
      if (d.fecha_pedido !== undefined) p.push('cambió la fecha de pedido');
      return p.length ? p.join(' · ') : 'actualizó la tarea';
    }
    case 'reproceso': return `registró un reproceso (${d.origen ?? ''}${d.motivo ? ` · ${MOTIVOS_REPROCESO.find((m) => m.valor === d.motivo)?.label ?? d.motivo}` : ''})`;
    case 'reproceso_cerrado': return 'cerró el reproceso (entregado de nuevo)';
    case 'crear_proyecto': return `creó el proyecto (${d.requerimientos ?? 0} tareas)`;
    case 'recurrencia_guardar': return 'configuró la recurrencia mensual';
    case 'recurrencia_generar': return `generó el fee de ${d.periodo ?? ''}`;
    case 'generar_plan_operativo': return 'generó el Plan Operativo';
    case 'generar_acta_cierre': return 'generó el Acta de Cierre';
    case 'generar_informe_mensual': return `generó el informe mensual ${d.mes ?? ''}`;
    case 'publicar_acta': return 'publicó el documento en Basecamp';
    case 'publicar_daily_apertura': return 'publicó la apertura de mesa en Basecamp';
    case 'publicar_daily_cierre': return 'publicó el cierre de mesa en Basecamp';
    case 'basecamp_importar': return `sincronizó con Basecamp (${d.requerimientos_creados ?? 0} nuevas · ${d.titulos_actualizados ?? 0} títulos · ${d.eliminados_en_basecamp ?? 0} eliminadas)`;
    case 'adoptar_huerfano': return 'adoptó un huérfano de Basecamp';
    case 'basecamp_entrada': return `entró desde Basecamp${d.lista ? ` · lista ${d.lista}` : ''}${d.creador ? ` · creada por ${d.creador}` : ''}`;
    case 'revisar_entrada': return 'revisó la entrada desde Basecamp';
    case 'respondido': return 'marcó la primera respuesta al cliente';
    case 'respondido_deshacer': return 'deshizo la marca de primera respuesta';
    case 'kpi_medicion': return `registró el KPI ${d.codigo ?? ''} (${d.periodo ?? ''})${d.origen === 'ajustado' ? ' con ajuste' : ''}`;
    case 'kpi_definicion': return `editó la definición del KPI ${d.codigo ?? ''}`;
    case 'bitacora': return `anotó en la bitácora${d.visible_cliente ? ' (visible al cliente)' : ''}: “${String(d.nota ?? '').slice(0, 120)}”`;
    case 'bitacora_eliminar': return 'borró una nota de la bitácora';
    case 'ia_brief': return 'usó la IA para extraer un brief';
    case 'ia_recordatorio': return 'redactó un recordatorio al cliente con IA';
    case 'crear_cliente': return `dio de alta al cliente ${d.nombre ?? ''}`;
    case 'actualizar_usuario': return 'actualizó un usuario';
    case 'quitar_acceso': return `quitó el acceso a ${d.email ?? 'un usuario'}`;
    case 'restaurar_acceso': return `restauró el acceso a ${d.email ?? 'un usuario'}`;
    case 'vincular_basecamp_usuarios': return `vinculó usuarios con Basecamp (${d.vinculados ?? 0})`;
    case 'crear_api_key': return 'creó una API key';
    case 'revocar_api_key': return 'revocó una API key';
    case 'mcp_confirm': return 'confirmó un plan de un agente (MCP)';
    default: return accion.replace(/_/g, ' ');
  }
}

export async function actividadDelDia(ctx: DbCtx, fecha: string, usuarioId?: string | null): Promise<{ fecha: string; eventos: EventoActividad[]; por_persona: { usuario_id: string; nombre: string; avatar_url: string | null; acciones: number; primera: string; ultima: string }[] }> {
  const db = serviceClient();
  const desde = `${fecha}T00:00:00-05:00`; const hasta = `${fecha}T23:59:59-05:00`;
  let q = db.from('audit_log').select('id, usuario_id, origen, accion, entidad, entidad_id, detalle, created_at').eq('tenant_id', ctx.tenantId).not('usuario_id', 'is', null).gte('created_at', desde).lte('created_at', hasta).order('created_at', { ascending: false }).limit(1000);
  if (usuarioId) q = q.eq('usuario_id', usuarioId);
  const { data: au, error } = await q; throwIf(error);
  type A = { id: number; usuario_id: string; origen: string; accion: string; entidad: string; entidad_id: string | null; detalle: Record<string, unknown> | null; created_at: string };
  const crudos: { id: string; usuario_id: string; origen: string; accion: string; entidad: string; entidad_id: string | null; detalle: Record<string, unknown>; created_at: string }[] =
    ((au ?? []) as A[]).map((a) => ({ ...a, id: `a${a.id}`, detalle: a.detalle ?? {} }));

  // Antes del arreglo de auditoría: reconstruir desde reprogramaciones y reprocesos.
  if (desde < FIX_AUDITORIA) {
    let r1 = db.from('reprogramaciones').select('id, requerimiento_id, fecha_anterior, fecha_nueva, motivo, usuario_id, created_at').eq('tenant_id', ctx.tenantId).not('usuario_id', 'is', null).gte('created_at', desde).lte('created_at', hasta);
    let r2 = db.from('reprocesos').select('id, requerimiento_id, origen, motivo, usuario_id, abierto_at').eq('tenant_id', ctx.tenantId).not('usuario_id', 'is', null).gte('abierto_at', desde).lte('abierto_at', hasta);
    if (usuarioId) { r1 = r1.eq('usuario_id', usuarioId); r2 = r2.eq('usuario_id', usuarioId); }
    const [a, b] = await Promise.all([r1, r2]);
    for (const x of (a.data ?? []) as { id: string; requerimiento_id: string; fecha_anterior: string | null; fecha_nueva: string | null; motivo: string | null; usuario_id: string; created_at: string }[]) crudos.push({ id: `rp${x.id}`, usuario_id: x.usuario_id, origen: 'ui', accion: 'reprogramar', entidad: 'requerimiento', entidad_id: x.requerimiento_id, detalle: { de: x.fecha_anterior, a: x.fecha_nueva, motivo_reprogramacion: x.motivo }, created_at: x.created_at });
    for (const x of (b.data ?? []) as { id: string; requerimiento_id: string; origen: string; motivo: string | null; usuario_id: string; abierto_at: string }[]) crudos.push({ id: `rc${x.id}`, usuario_id: x.usuario_id, origen: 'ui', accion: 'reproceso', entidad: 'requerimiento', entidad_id: x.requerimiento_id, detalle: { origen: x.origen, motivo: x.motivo }, created_at: x.abierto_at });
  }
  crudos.sort((x, y) => y.created_at.localeCompare(x.created_at));

  const ids = (ent: string) => [...new Set(crudos.filter((c) => c.entidad === ent && c.entidad_id).map((c) => c.entidad_id as string))];
  const [us, rq, pr, cl] = await Promise.all([
    db.from('usuarios').select('id, nombre, avatar_url, rol').eq('tenant_id', ctx.tenantId),
    ids('requerimiento').length ? db.from('requerimientos').select('id, titulo_interno, cliente_id, proyecto_id').in('id', ids('requerimiento')) : Promise.resolve({ data: [] }),
    ids('proyecto').length ? db.from('proyectos').select('id, nombre, cliente_id').in('id', ids('proyecto')) : Promise.resolve({ data: [] }),
    db.from('clientes').select('id, nombre').eq('tenant_id', ctx.tenantId),
  ]);
  const U = new Map(((us.data ?? []) as { id: string; nombre: string; avatar_url: string | null; rol: string }[]).map((u) => [u.id, u]));
  const RQ = new Map(((rq.data ?? []) as { id: string; titulo_interno: string; cliente_id: string; proyecto_id: string | null }[]).map((r) => [r.id, r]));
  const PR = new Map(((pr.data ?? []) as { id: string; nombre: string; cliente_id: string }[]).map((p) => [p.id, p]));
  const CL = new Map(((cl.data ?? []) as { id: string; nombre: string }[]).map((c) => [c.id, c.nombre]));

  const eventos: EventoActividad[] = crudos.map((c) => {
    const u = U.get(c.usuario_id);
    const r = c.entidad === 'requerimiento' && c.entidad_id ? RQ.get(c.entidad_id) : undefined;
    const p = c.entidad === 'proyecto' && c.entidad_id ? PR.get(c.entidad_id) : undefined;
    const clienteId = r?.cliente_id ?? p?.cliente_id ?? (c.entidad === 'cliente' ? c.entidad_id : null);
    return {
      id: c.id, fecha: c.created_at, usuario_id: c.usuario_id, nombre: u?.nombre ?? 'Usuario', avatar_url: u?.avatar_url ?? null, rol: u?.rol ?? '',
      accion: c.accion, texto: describir(c.accion, c.detalle), entidad: c.entidad, entidad_id: c.entidad_id,
      titulo: r?.titulo_interno ?? p?.nombre ?? (typeof c.detalle.titulo === 'string' ? c.detalle.titulo : null), cliente: clienteId ? CL.get(clienteId) ?? null : null,
      ruta: p ? `/proyectos/${p.id}` : r?.proyecto_id ? `/proyectos/${r.proyecto_id}` : null, origen: c.origen,
    };
  });
  const pp = new Map<string, { usuario_id: string; nombre: string; avatar_url: string | null; acciones: number; primera: string; ultima: string }>();
  for (const e of eventos) { const x = pp.get(e.usuario_id) ?? { usuario_id: e.usuario_id, nombre: e.nombre, avatar_url: e.avatar_url, acciones: 0, primera: e.fecha, ultima: e.fecha }; x.acciones += 1; if (e.fecha < x.primera) x.primera = e.fecha; if (e.fecha > x.ultima) x.ultima = e.fecha; pp.set(e.usuario_id, x); }
  return { fecha, eventos, por_persona: [...pp.values()].sort((a, b) => b.acciones - a.acciones) };
}
