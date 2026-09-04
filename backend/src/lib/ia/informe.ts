/**
 * Informe ejecutivo mensual por mesa: números del mes (entregas, piezas, horas, cotizado, señales,
 * arrastre) + narrativa de la IA. Se guarda como acta tipo informe_mensual y se publica en el board Weekly.
 */
import type { Acta, RequerimientoMetricas } from '@backio/shared';
import type { DbCtx } from '../db/client';
import { throwIf } from '../db/client';
import { getMesa, alcanceMesa } from '../db/mesas';
import { ensureSemana, insertActa } from '../db/semanas';
import { listClientes } from '../db/clientes';
import { listUsuarios } from '../db/usuarios';
import { listBacklog } from '../db/requerimientos';
import { resumenHoras } from '../horas';
import { generarTexto } from './index';

export function rangoMes(mes: string): { desde: string; hasta: string; etiqueta: string } {
  const [y, m] = mes.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) throw new Error('Mes inválido, usa YYYY-MM');
  const desde = `${mes}-01`;
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const hasta = `${mes}-${String(ultimo).padStart(2, '0')}`;
  const etiqueta = new Intl.DateTimeFormat('es-EC', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${desde}T12:00:00Z`));
  return { desde, hasta, etiqueta: etiqueta.charAt(0).toUpperCase() + etiqueta.slice(1) };
}

const SYSTEM_INFORME = `Redacta el informe ejecutivo mensual de una mesa de la agencia para la gerencia general.
Devuelve texto en markdown con estas secciones y nada más:
## Lectura del mes
2 a 3 párrafos: qué se entregó, cómo cerró cada cliente (salud, atrasos, espera del cliente), dónde se fue el esfuerzo (horas vs. valor cotizado, nombra los clientes con peor relación), qué se arrastró y por qué.
## Lo que hay que decidir
3 a 5 viñetas, cada una una decisión concreta para el mes siguiente con responsable sugerido si está en los datos.
Sin cifras inventadas; puedes citar las del JSON.`;

export async function generarInformeMensual(ctx: DbCtx, mesaId: string, mes: string): Promise<Acta> {
  const mesa = await getMesa(ctx, mesaId);
  if (!mesa) throw new Error('Mesa no encontrada');
  const { desde, hasta, etiqueta } = rangoMes(mes);
  const alcance = await alcanceMesa(ctx, mesaId);
  const [clientes, usuarios, activos, horas] = await Promise.all([listClientes(ctx, { incluirInactivos: true }), listUsuarios(ctx), listBacklog(ctx, { solo_activos: true, mesa: alcance }), resumenHoras(ctx, `${desde}T00:00:00Z`, { clienteIds: alcance.clienteIds })]);
  let q = ctx.db.from('v_requerimientos_metricas').select('*').eq('tenant_id', ctx.tenantId).eq('estado_operativo', 'completado').gte('completado_at', `${desde}T00:00:00Z`).lte('completado_at', `${hasta}T23:59:59Z`);
  const partes: string[] = [];
  if (alcance.clienteIds.length) partes.push(`cliente_id.in.(${alcance.clienteIds.join(',')})`);
  if (alcance.proyectoIds.length) partes.push(`proyecto_id.in.(${alcance.proyectoIds.join(',')})`);
  if (partes.length) q = q.or(partes.join(','));
  const { data: comp, error } = await q; throwIf(error);
  const completados = (comp ?? []) as RequerimientoMetricas[];
  const { data: sen } = await ctx.db.from('senales').select('tipo, severidad, semanas!inner(fecha_inicio)').eq('tenant_id', ctx.tenantId).gte('semanas.fecha_inicio', desde).lte('semanas.fecha_inicio', hasta);
  const senales = (sen ?? []) as { tipo: string; severidad: string }[];
  const { data: proys } = await ctx.db.from('proyectos').select('cliente_id, valor_cotizado').eq('tenant_id', ctx.tenantId).is('deleted_at', null).neq('estado', 'cerrado');
  const cotizado = new Map<string, number>();
  for (const p of (proys ?? []) as { cliente_id: string; valor_cotizado: number | null }[]) cotizado.set(p.cliente_id, (cotizado.get(p.cliente_id) ?? 0) + Number(p.valor_cotizado ?? 0));

  const nombreC = (id: string) => clientes.find((c) => c.id === id)?.nombre ?? id;
  const nombreU = (id: string) => usuarios.find((u) => u.id === id)?.nombre ?? id;
  const idsCliente = new Set([...alcance.clienteIds, ...activos.map((r) => r.cliente_id), ...completados.map((r) => r.cliente_id)]);
  const porCliente = [...idsCliente].map((id) => {
    const act = activos.filter((r) => r.cliente_id === id);
    const comp = completados.filter((r) => r.cliente_id === id);
    return {
      cliente: nombreC(id), entregados: comp.length, piezas_entregadas: comp.reduce((n, r) => n + (r.piezas ?? 0), 0), a_tiempo: comp.filter((r) => !r.fecha_entrega || (r.completado_at ?? '') <= `${r.fecha_entrega}T23:59:59Z`).length,
      activos: act.length, atrasados: act.filter((r) => r.dias_atraso > 0).length, esperando_cliente: act.filter((r) => r.estado_aprobacion === 'pendiente_cliente').length,
      reprogramados_2mas: act.filter((r) => r.veces_reprogramado >= 2).length,
      horas_mes: Math.round((horas.por_cliente[id] ?? 0) * 10) / 10, valor_cotizado_activo: cotizado.get(id) ?? 0,
      usd_por_hora: horas.por_cliente[id] ? Math.round((cotizado.get(id) ?? 0) / horas.por_cliente[id]!) : null,
    };
  }).filter((c) => c.entregados || c.activos).sort((a, b) => b.horas_mes - a.horas_mes);
  const porPersona = Object.entries(horas.por_usuario).map(([id, h]) => ({ persona: nombreU(id), horas_mes: Math.round(h * 10) / 10, activos: activos.filter((r) => r.owner_agencia.includes(id)).length })).sort((a, b) => b.horas_mes - a.horas_mes);
  const senalesPorTipo = senales.reduce<Record<string, number>>((acc, s) => { acc[s.tipo] = (acc[s.tipo] ?? 0) + 1; return acc; }, {});
  const totales = { entregados: completados.length, piezas: porCliente.reduce((n, c) => n + c.piezas_entregadas, 0), a_tiempo: porCliente.reduce((n, c) => n + c.a_tiempo, 0), horas: Math.round(horas.total * 10) / 10, activos_al_cierre: activos.length, atrasados_al_cierre: activos.filter((r) => r.dias_atraso > 0).length, senales_criticas: senales.filter((s) => s.severidad === 'critica').length };
  const payload = { mesa: mesa.nombre, mes: etiqueta, desde, hasta, totales, por_cliente: porCliente, por_persona: porPersona, senales_por_tipo: senalesPorTipo, arrastre_top: activos.filter((r) => r.veces_reprogramado >= 2).slice(0, 10).map((r) => ({ tarea: r.titulo_interno, cliente: nombreC(r.cliente_id), veces: r.veces_reprogramado, owner: r.owner_agencia[0] ? nombreU(r.owner_agencia[0]) : null })) };
  const g = await generarTexto(ctx, { tipo: 'informe_mensual', entidad: { tipo: 'mesa', id: mesa.id }, payload, system: SYSTEM_INFORME, maxTokens: 1800, cacheMs: 6 * 3600_000 });

  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const md = [
    `# Informe mensual · ${mesa.nombre} · ${etiqueta}`, '',
    `**Entregas:** ${totales.entregados} requerimientos (${totales.piezas} piezas), ${pct(totales.a_tiempo, totales.entregados)} a tiempo · **Horas:** ${totales.horas} · **Abiertos al cierre:** ${totales.activos_al_cierre} (${totales.atrasados_al_cierre} atrasados) · **Señales críticas:** ${totales.senales_criticas}`, '',
    g.texto.trim(), '',
    '## Clientes', '',
    '| Cliente | Entregados | Piezas | A tiempo | Activos | Atrasados | Espera cliente | Horas | Cotizado | USD/h |', '|---|---|---|---|---|---|---|---|---|---|',
    ...porCliente.map((c) => `| ${c.cliente} | ${c.entregados} | ${c.piezas_entregadas} | ${pct(c.a_tiempo, c.entregados)} | ${c.activos} | ${c.atrasados} | ${c.esperando_cliente} | ${c.horas_mes} | ${c.valor_cotizado_activo ? `$${c.valor_cotizado_activo.toLocaleString('en-US')}` : '—'} | ${c.usd_por_hora ?? '—'} |`),
    '', '## Personas', '', '| Persona | Horas | Activos |', '|---|---|---|', ...porPersona.map((p) => `| ${p.persona} | ${p.horas_mes} | ${p.activos} |`),
    '', '---', `_Redactado por BackIO con datos de BackIO y horas de Basecamp. Publicado por ${ctx.usuarioId ? 'la persona que lo publique' : 'BackIO'}._`,
  ].join('\n');
  const semana = await ensureSemana(ctx, hasta);
  return insertActa(ctx, { semana_id: semana.id, tipo: 'informe_mensual', mesa_id: mesa.id, contenido: payload, markdown: md });
}
