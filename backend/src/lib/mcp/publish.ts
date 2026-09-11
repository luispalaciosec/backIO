/**
 * Publicación en Basecamp. Las mesas trabajan con Message Boards ("Daily (apertura/cierre)" y
 * "Weekly (Status Semanal)"): Plan Operativo y Acta de Cierre van como MENSAJE en el board Weekly de la
 * mesa, con el título que el equipo ya usa. Apertura y cierre van al board Daily.
 * Sin mesa (documento de toda la agencia) se usa tenants.config.basecamp_docs_project_id como Doc.
 */
import type { Acta, Mesa } from '@backio/shared';
import type { DbCtx } from '../db/client';
import { throwIf } from '../db/client';
import { BasecampClient } from '../basecamp/client';
import { getMesa } from '../db/mesas';
import { getSemana } from '../db/semanas';

const fmtFecha = (iso: string) => iso.slice(0, 10);
const fmtCorta = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${Number(d)}/${m}/${y}`; };

export function tituloWeekly(acta: Acta, semana: { numero_iso: number; fecha_inicio: string; fecha_fin: string }): string {
  if (acta.tipo === 'informe_mensual') return `${fmtFecha(semana.fecha_fin)} || ${acta.markdown.split('\n')[0]?.replace(/^#\s*/, '') ?? 'Informe mensual'}`;
  return acta.tipo === 'plan_operativo'
    ? `${fmtFecha(semana.fecha_inicio)} || Status Semanal Operativo - Semana ${semana.numero_iso}`
    : `${fmtFecha(semana.fecha_fin)} || Acta de Cierre - Semana ${semana.numero_iso}`;
}

export async function publicarActaEnBasecamp(ctx: DbCtx, acta: Acta): Promise<{ acta_id: string; basecamp_doc_id: number; url: string }> {
  const bc = await BasecampClient.forTenant(ctx.tenantId);
  const html = markdownBasico(acta.markdown);
  let doc: { id: number; app_url: string };

  if (acta.mesa_id) {
    const mesa = await getMesa(ctx, acta.mesa_id);
    if (!mesa?.basecamp_project_id) throw new Error(`La mesa ${mesa?.nombre ?? acta.mesa_id} no tiene proyecto Basecamp configurado`);
    if (!mesa.basecamp_board_weekly_id) throw new Error(`La mesa ${mesa.nombre} no tiene board Weekly configurado (Admin → Mesas → Detectar boards)`);
    const semana = await getSemana(ctx, acta.semana_id);
    if (!semana) throw new Error('Semana no encontrada');
    doc = await bc.createMessage(mesa.basecamp_project_id, mesa.basecamp_board_weekly_id, { subject: tituloWeekly(acta, semana), content: html });
  } else {
    const { data, error } = await ctx.db.from('tenants').select('config').eq('id', ctx.tenantId).single();
    throwIf(error);
    const projectId = (data as { config: { basecamp_docs_project_id?: number } }).config.basecamp_docs_project_id ?? null;
    if (!projectId) throw new Error('El acta no es de una mesa y falta tenants.config.basecamp_docs_project_id');
    const dock = await bc.getDock(projectId);
    const vault = dock.find((d) => d.name === 'vault');
    if (!vault) throw new Error('El proyecto de actas no tiene Docs & Files habilitado');
    const titulo = `${acta.tipo === 'plan_operativo' ? 'Plan Operativo' : acta.tipo === 'cierre' ? 'Acta de Cierre' : 'Informe mensual'} · ${acta.markdown.split('\n')[0]?.replace(/^#\s*/, '') ?? acta.id}`;
    doc = await bc.createDocument(projectId, vault.id, { title: titulo, content: html });
  }

  const { error: e2 } = await ctx.db.from('actas').update({ publicado_at: new Date().toISOString(), publicado_por: ctx.usuarioId, basecamp_doc_id: doc.id }).eq('id', acta.id);
  throwIf(e2);
  if (acta.tipo !== 'informe_mensual') {
    const col = acta.tipo === 'plan_operativo' ? 'plan_publicado_at' : 'acta_publicada_at';
    await ctx.db.from('semanas').update({ [col]: new Date().toISOString() }).eq('id', acta.semana_id);
  }
  return { acta_id: acta.id, basecamp_doc_id: doc.id, url: doc.app_url };
}

/** Línea del daily: título enlazado al to-do de Basecamp cuando existe. */
export interface DailyItem { cliente: string; titulo: string; owner: string; fecha: string | null; url: string | null; atraso_dias?: number }
export interface DailyMensaje { tipo: 'apertura' | 'cierre'; responsable: string; fecha: string; notas: string[]; hoy: DailyItem[]; vencen: DailyItem[]; bloqueos: DailyItem[]; cambios: DailyItem[]; narrativa?: string }

export function dailyItemTexto(i: DailyItem): string {
  return `${i.cliente} · ${i.titulo} · ${i.owner}${i.fecha ? ` · ${i.fecha}` : ''}${i.atraso_dias ? ` (${i.atraso_dias} días de atraso)` : ''}`;
}

export function tituloDaily(m: DailyMensaje, mesa: Mesa): string {
  return `${m.tipo === 'apertura' ? '🟢APERTURA' : '🔴CIERRE'} DE MESA - ${fmtCorta(m.fecha)} - ${mesa.nombre.toUpperCase()}`;
}

export function cuerpoDaily(m: DailyMensaje): string {
  const item = (i: DailyItem) => {
    const titulo = i.url ? `<a href="${esc(i.url)}">${esc(i.titulo)}</a>` : esc(i.titulo);
    const atraso = i.atraso_dias ? ` <span style="color:#c0392b">(${i.atraso_dias} d de atraso)</span>` : '';
    return `<li><strong>${esc(i.cliente)}</strong> · ${titulo} · ${esc(i.owner)}${i.fecha ? ` · ${esc(fmtCorta(i.fecha))}` : ''}${atraso}</li>`;
  };
  const li = (xs: DailyItem[]) => (xs.length ? `<ul>${xs.map(item).join('')}</ul>` : '<p><em>Nada.</em></p>');
  return [
    `<p><strong>RESPONSABLE:</strong> ${esc(m.responsable)} · <strong>Hora:</strong> ${m.tipo === 'apertura' ? '9H00 AM' : '6H00 PM'}</p>`,
    ...(m.narrativa ? m.narrativa.split(/\n+/).map((p) => `<p>${esc(p)}</p>`) : []),
    `<p>📌 <strong>Notas clave del día</strong></p>`, m.notas.length ? `<ul>${m.notas.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '<p><em>Nada.</em></p>',
    `<p>🎯 <strong>Hoy se trabaja</strong></p>`, li(m.hoy),
    `<p>⏰ <strong>Vence hoy o mañana sin iniciar</strong></p>`, li(m.vencen),
    `<p>⛔ <strong>Bloqueos nuevos</strong></p>`, li(m.bloqueos),
    `<p>📅 <strong>Fechas cambiadas</strong></p>`, li(m.cambios),
    `<p style="color:#888;font-size:12px">${m.narrativa ? `Redactado por BackIO, publicado por ${esc(m.responsable)}` : 'Generado por BackIO'}</p>`,
  ].join('\n');
}

export async function publicarDailyEnBasecamp(ctx: DbCtx, mesa: Mesa, m: DailyMensaje): Promise<{ id: number; url: string }> {
  if (!mesa.basecamp_project_id || !mesa.basecamp_board_daily_id) throw new Error(`La mesa ${mesa.nombre} no tiene board Daily configurado`);
  const bc = await BasecampClient.forTenant(ctx.tenantId);
  const r = await bc.createMessage(mesa.basecamp_project_id, mesa.basecamp_board_daily_id, { subject: tituloDaily(m, mesa), content: cuerpoDaily(m) });
  return { id: r.id, url: r.app_url };
}

/** Descubre en el dock del proyecto de la mesa los boards Daily y Weekly por título. */
export async function detectarBoardsMesa(ctx: DbCtx, mesa: Mesa): Promise<{ daily: number | null; weekly: number | null; boards: { id: number; title: string }[] }> {
  if (!mesa.basecamp_project_id) throw new Error('Mesa sin proyecto Basecamp');
  const bc = await BasecampClient.forTenant(ctx.tenantId);
  const dock = await bc.getDock(mesa.basecamp_project_id);
  const boards = dock.filter((d) => d.name === 'message_board' && d.enabled).map((d) => ({ id: d.id, title: d.title }));
  const daily = boards.find((b) => /daily|apertura/i.test(b.title))?.id ?? null;
  const weekly = boards.find((b) => /weekly|semanal|status/i.test(b.title))?.id ?? null;
  return { daily, weekly, boards };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Conversión mínima markdown → HTML (títulos, listas, tablas, negritas). Basecamp acepta HTML simple. */
export function markdownBasico(md: string): string {
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/_(.+?)_/g, '<em>$1</em>');
  const out: string[] = [];
  const lineas = md.split('\n');
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i]!;
    if (/^\|/.test(l)) {
      const filas: string[] = [];
      while (i < lineas.length && /^\|/.test(lineas[i]!)) { filas.push(lineas[i]!); i++; }
      i--;
      const celdas = (f: string) => f.split('|').slice(1, -1).map((c) => c.trim());
      const [head, , ...body] = filas;
      out.push('<table><thead><tr>' + celdas(head!).map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' + body.map((f) => '<tr>' + celdas(f).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(l);
    if (h) { out.push(`<h${h[1]!.length}>${inline(h[2]!)}</h${h[1]!.length}>`); continue; }
    if (/^- /.test(l)) {
      const items: string[] = [];
      while (i < lineas.length && /^- /.test(lineas[i]!)) { items.push(lineas[i]!.slice(2)); i++; }
      i--;
      out.push('<ul>' + items.map((x) => `<li>${inline(x.replace(/^\[ \] /, '☐ ').replace(/^\[x\] /, '☑ '))}</li>`).join('') + '</ul>');
      continue;
    }
    if (l.trim() === '---' || l.trim() === '') continue;
    out.push(`<p>${inline(l)}</p>`);
  }
  return out.join('\n');
}
