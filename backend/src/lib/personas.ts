/**
 * Personas: rendimiento por integrante en un periodo (día, semana, mes) + serie de 30 días.
 * Todo sale de datos estructurados: requerimientos, horas del timesheet, reprogramaciones y reprocesos.
 */
import type { RequerimientoMetricas, Usuario } from '@backio/shared';
import type { DbCtx } from './db/client';
import { throwIf } from './db/client';
import { listUsuarios } from './db/usuarios';
import { listClientes } from './db/clientes';
import { listBacklog } from './db/requerimientos';
import { listCumplimientoDesde } from './db/historial';
import { resumirCumplimiento } from './cumplimiento';
import { fechaLocal, sumarDias } from './rituals/daily';

export type Periodo = 'dia' | 'semana' | 'mes';

export interface PersonaResumen {
  usuario_id: string; nombre: string; email: string; rol: string; avatar_url: string | null; capacidad_semanal: number; basecamp_user_id: number | null;
  activos: number; atrasados: number; en_ejecucion: number; bloqueados: number; esperando_cliente: number; sin_movimiento_7: number;
  entregados: number; piezas: number; pct_a_tiempo_original: number | null; pct_a_tiempo_vigente: number | null; desvio_mediana_dias: number | null;
  horas: number; horas_por_entrega: number | null; pct_capacidad: number | null;
  reprogramaciones_equipo: number; reprocesos: number; horas_reproceso: number;
  clientes: { cliente: string; activos: number; entregados: number }[];
  serie_30d: { fecha: string; entregados: number; horas: number }[];
  /** Timesheet: días laborables del periodo (hasta hoy) y cuántos tienen horas registradas. */
  dias_laborables: number; dias_con_horas: number; dias_sin_horas: string[]; horas_esperadas: number;
  dias: { fecha: string; horas: number; esperado: number; entregados: number }[];
  puntaje: number; // 0-100 orientativo
}

export function rangoPeriodo(periodo: Periodo, hoy = fechaLocal()): { desde: string; hasta: string; etiqueta: string; dias: number } {
  if (periodo === 'dia') return { desde: hoy, hasta: hoy, etiqueta: 'Hoy', dias: 1 };
  if (periodo === 'semana') {
    const d = new Date(`${hoy}T12:00:00Z`); const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
    const lunes = sumarDias(hoy, -dow);
    return { desde: lunes, hasta: sumarDias(lunes, 6), etiqueta: 'Esta semana', dias: 7 };
  }
  const desde = `${hoy.slice(0, 7)}-01`;
  const [y, m] = hoy.split('-').map(Number);
  const ultimo = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { desde, hasta: `${hoy.slice(0, 7)}-${String(ultimo).padStart(2, '0')}`, etiqueta: 'Este mes', dias: ultimo };
}

export async function resumenPersonas(ctx: DbCtx, periodo: Periodo): Promise<{ periodo: Periodo; desde: string; hasta: string; etiqueta: string; personas: PersonaResumen[] }> {
  const hoy = fechaLocal();
  const { desde, hasta, etiqueta, dias } = rangoPeriodo(periodo, hoy);
  const desde30 = sumarDias(hoy, -29);
  const desdeIso = `${desde}T00:00:00-05:00`; const hastaIso = `${hasta}T23:59:59-05:00`;
  const [usuarios, clientes, activos, cumpl] = await Promise.all([listUsuarios(ctx), listClientes(ctx, { incluirInactivos: true }), listBacklog(ctx, { solo_activos: true }), listCumplimientoDesde(ctx, desdeIso)]);
  const { data: comp, error } = await ctx.db.from('v_requerimientos_metricas').select('*').eq('tenant_id', ctx.tenantId).eq('estado_operativo', 'completado').gte('completado_at', `${desde30 < desde ? desde30 : desde}T00:00:00-05:00`);
  throwIf(error);
  const completados = ((comp ?? []) as RequerimientoMetricas[]).map((r) => ({ ...r, peso: Number(r.peso) }));
  const { data: hrs, error: eh } = await ctx.db.from('horas').select('usuario_id, fecha, horas').eq('tenant_id', ctx.tenantId).gte('fecha', desde30 < desde ? desde30 : desde);
  throwIf(eh);
  const horas = (hrs ?? []) as { usuario_id: string | null; fecha: string; horas: number }[];
  const nombreC = (id: string) => clientes.find((c) => c.id === id)?.nombre ?? '—';
  const reqPorId = new Map([...activos, ...completados].map((r) => [r.id, r]));
  const enPeriodo = (iso: string | null) => !!iso && iso >= desdeIso && iso <= hastaIso;
  const capacidadPeriodo = (u: Usuario) => (periodo === 'dia' ? u.capacidad_semanal / 5 : periodo === 'semana' ? u.capacidad_semanal : (u.capacidad_semanal / 5) * (dias * 5 / 7));

  // Admin y gerencia no ejecutan tareas: no se miden aquí (pedido de Luis 08/09/2026).
  const personas: PersonaResumen[] = usuarios.filter((u) => u.activo && u.rol !== 'admin' && u.rol !== 'gerencia').map((u) => {
    const mios = activos.filter((r) => r.owner_agencia.includes(u.id));
    const entregados = completados.filter((r) => r.owner_agencia.includes(u.id) && enPeriodo(r.completado_at));
    const esMio = (id: string) => reqPorId.get(id)?.owner_agencia.includes(u.id) ?? false;
    const cu = resumirCumplimiento(entregados, cumpl.reprogramaciones.filter((x) => esMio(x.requerimiento_id) && x.created_at <= hastaIso), cumpl.reprocesos.filter((x) => esMio(x.requerimiento_id) && x.abierto_at <= hastaIso));
    const hMias = horas.filter((h) => h.usuario_id === u.id);
    const hPeriodo = hMias.filter((h) => h.fecha >= desde && h.fecha <= hasta).reduce((s, h) => s + Number(h.horas), 0);
    const cap = capacidadPeriodo(u);
    const serie_30d = Array.from({ length: 30 }, (_, i) => { const f = sumarDias(desde30, i); return { fecha: f, entregados: completados.filter((r) => r.owner_agencia.includes(u.id) && (r.completado_at ?? '').slice(0, 10) === f).length, horas: Math.round(hMias.filter((h) => h.fecha === f).reduce((s, h) => s + Number(h.horas), 0) * 10) / 10 }; });
    // Timesheet día a día dentro del periodo (solo hasta hoy, lunes a viernes).
    const esperadoDia = u.capacidad_semanal / 5;
    const diasPeriodo: { fecha: string; horas: number; esperado: number; entregados: number }[] = [];
    for (let f = desde; f <= (hasta < hoy ? hasta : hoy); f = sumarDias(f, 1)) {
      const dow = new Date(`${f}T12:00:00Z`).getUTCDay();
      const laborable = dow >= 1 && dow <= 5;
      diasPeriodo.push({ fecha: f, horas: Math.round(hMias.filter((h) => h.fecha === f).reduce((s2, h) => s2 + Number(h.horas), 0) * 10) / 10, esperado: laborable ? Math.round(esperadoDia * 10) / 10 : 0, entregados: completados.filter((r) => r.owner_agencia.includes(u.id) && (r.completado_at ?? '').slice(0, 10) === f).length });
    }
    const laborables = diasPeriodo.filter((d) => d.esperado > 0);
    const diasSinHoras = laborables.filter((d) => d.horas === 0).map((d) => d.fecha);
    const porCliente = new Map<string, { activos: number; entregados: number }>();
    for (const r of mios) { const c = porCliente.get(r.cliente_id) ?? { activos: 0, entregados: 0 }; c.activos += 1; porCliente.set(r.cliente_id, c); }
    for (const r of entregados) { const c = porCliente.get(r.cliente_id) ?? { activos: 0, entregados: 0 }; c.entregados += 1; porCliente.set(r.cliente_id, c); }
    const atrasados = mios.filter((r) => r.dias_atraso > 0).length;
    // Puntaje orientativo: a tiempo (40) + sin atraso relativo (30) + bien a la primera (20) + movimiento (10).
    const pctAt = cu.pct_original ?? (entregados.length ? 100 : 50);
    const pctSinAtraso = mios.length ? Math.round(100 * (1 - atrasados / mios.length)) : 100;
    const pctPrimera = entregados.length ? Math.round(100 * (1 - Math.min(cu.reprocesos, entregados.length) / entregados.length)) : 100;
    const pctMov = mios.length ? Math.round(100 * (1 - mios.filter((r) => r.dias_sin_movimiento > 7).length / mios.length)) : 100;
    const puntaje = Math.round(pctAt * 0.4 + pctSinAtraso * 0.3 + pctPrimera * 0.2 + pctMov * 0.1);
    return {
      usuario_id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, avatar_url: u.avatar_url, capacidad_semanal: u.capacidad_semanal, basecamp_user_id: u.basecamp_user_id,
      activos: mios.length, atrasados, en_ejecucion: mios.filter((r) => r.estado_operativo === 'en_ejecucion').length, bloqueados: mios.filter((r) => r.estado_operativo === 'bloqueado').length,
      esperando_cliente: mios.filter((r) => r.estado_aprobacion === 'pendiente_cliente').length, sin_movimiento_7: mios.filter((r) => r.dias_sin_movimiento > 7).length,
      entregados: entregados.length, piezas: entregados.reduce((s, r) => s + (r.piezas || 0), 0), pct_a_tiempo_original: cu.pct_original, pct_a_tiempo_vigente: cu.pct_vigente, desvio_mediana_dias: cu.desvio_mediana_dias,
      horas: Math.round(hPeriodo * 10) / 10, horas_por_entrega: entregados.length && hPeriodo ? Math.round((hPeriodo / entregados.length) * 10) / 10 : null, pct_capacidad: cap ? Math.round((hPeriodo / cap) * 100) : null,
      reprogramaciones_equipo: cu.reprogramaciones_equipo, reprocesos: cu.reprocesos, horas_reproceso: cu.horas_reproceso,
      clientes: [...porCliente.entries()].map(([id, c]) => ({ cliente: nombreC(id), ...c })).sort((a, b) => b.activos + b.entregados - (a.activos + a.entregados)).slice(0, 6),
      serie_30d, dias_laborables: laborables.length, dias_con_horas: laborables.length - diasSinHoras.length, dias_sin_horas: diasSinHoras, horas_esperadas: Math.round(laborables.reduce((s2, d) => s2 + d.esperado, 0) * 10) / 10, dias: diasPeriodo, puntaje,
    };
  }).filter((p) => p.activos > 0 || p.entregados > 0 || p.horas > 0 || p.rol === 'colaborador' || p.rol === 'lider').sort((a, b) => b.activos - a.activos);
  return { periodo, desde, hasta, etiqueta, personas };
}
