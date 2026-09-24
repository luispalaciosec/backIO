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
import { listUsuarios } from '../db/usuarios';

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
export interface DailyItem { cliente: string; titulo: string; owner: string; owners?: string[]; fecha: string | null; url: string | null; atraso_dias?: number }
export interface DailyMensaje {
  tipo: 'apertura' | 'cierre'; responsable: string; fecha: string; notas: string[];
  hoy: DailyItem[]; vencen: DailyItem[]; bloqueos: DailyItem[]; cambios: DailyItem[]; narrativa?: string;
  /** Solo en el cierre: completadas hoy que estaban en el daily, y completadas hoy que no estaban. */
  completadas?: DailyItem[]; completadas_fuera?: DailyItem[];
  /** Solo en el cierre: indicadores del día. */
  kpis?: DailyKpis;
}
export interface DailyKpis {
  planificadas: number; cerradas_planificadas: number; cumplimiento_pct: number | null;
  cerradas_fuera: number; cerradas_total: number;
  nuevas_hoy: number; nuevas_no_planificadas: number; nuevas_urgentes: number;
  reprocesos_hoy: number; reprogramaciones_24h: number; bloqueos_nuevos: number; vencidas_abiertas: number;
  por_persona: { nombre: string; planificadas: number; cerradas: number; fuera: number }[];
}

/** Bloque de métricas del cierre. Lista, no tabla: Basecamp no admite tablas en mensajes. */
export function kpisDaily(k: DailyKpis, men?: Menciones): string {
  const pct = k.cumplimiento_pct === null ? 'sin plan' : `${k.cumplimiento_pct}%`;
  const color = k.cumplimiento_pct === null ? '#888' : k.cumplimiento_pct >= 80 ? '#1e8449' : k.cumplimiento_pct >= 50 ? '#b9770e' : '#c0392b';
  const fila = (etiqueta: string, valor: string) => `<li>${etiqueta}: <strong>${valor}</strong></li>`;
  const general = `<ul>${[
    fila('Cumplimiento del plan del día', `${k.cerradas_planificadas} de ${k.planificadas} · <span style="color:${color}">${pct}</span>`),
    fila('Cerradas fuera del daily', String(k.cerradas_fuera)),
    fila('Total cerradas hoy', String(k.cerradas_total)),
    fila('Entraron hoy fuera de planificación', `${k.nuevas_no_planificadas + k.nuevas_urgentes} de ${k.nuevas_hoy} nuevas${k.nuevas_urgentes ? ` (${k.nuevas_urgentes} urgente${k.nuevas_urgentes === 1 ? '' : 's'})` : ''}`),
    fila('Reprocesos abiertos hoy', String(k.reprocesos_hoy)),
    fila('Reprogramaciones (24 h)', String(k.reprogramaciones_24h)),
    fila('Bloqueos nuevos', String(k.bloqueos_nuevos)),
    fila('Vencidas que siguen abiertas', String(k.vencidas_abiertas)),
  ].join('')}</ul>`;
  if (!k.por_persona.length) return general;
  const personas = `<p><em>Por persona · cerradas / planificadas</em></p><ul>${k.por_persona.map((p) => {
    const pp = p.planificadas ? ` · ${Math.round((p.cerradas / p.planificadas) * 100)}%` : '';
    return `<li>${mencion(p.nombre, men)}: <strong>${p.cerradas} / ${p.planificadas}</strong>${pp}${p.fuera ? ` · +${p.fuera} fuera del daily` : ''}</li>`;
  }).join('')}</ul>`;
  return general + personas;
}

export function dailyItemTexto(i: DailyItem): string {
  return `${i.cliente} · ${i.titulo} · ${i.owner}${i.fecha ? ` · ${i.fecha}` : ''}${i.atraso_dias ? ` (${i.atraso_dias} días de atraso)` : ''}`;
}

export function tituloDaily(m: DailyMensaje, mesa: Mesa): string {
  return `${m.tipo === 'apertura' ? '🟢APERTURA' : '🔴CIERRE'} DE MESA - ${fmtCorta(m.fecha)} - ${mesa.nombre.toUpperCase()}`;
}

/** Línea en blanco en un mensaje de Basecamp (Trix ignora <p> vacíos; <br> sí se respeta). */
const SALTO = '<div><br></div>';

/** nombre de usuario en BackIO → attachable_sgid de Basecamp. Con esto el nombre sale como @mención real. */
export type Menciones = Map<string, string>;
const mencion = (nombre: string, men?: Menciones) => {
  const sgid = men?.get(nombre);
  return sgid ? `<bc-attachment sgid="${esc(sgid)}" content-type="application/vnd.basecamp.mention"></bc-attachment>` : esc(nombre);
};
/** Reemplaza los nombres conocidos por @menciones en el HTML ya generado (solo en texto, nunca dentro de etiquetas). */
export function mencionarEnHtml(html: string, men?: Menciones): string {
  if (!men?.size) return html;
  const nombres = [...men.keys()].sort((a, b) => b.length - a.length);
  return html.split(/(<[^>]+>)/).map((parte) => {
    if (parte.startsWith('<')) return parte;
    let t = parte;
    for (const n of nombres) t = t.split(esc(n)).join(mencion(n, men));
    return t;
  }).join('');
}

export function cuerpoDaily(m: DailyMensaje, men?: Menciones): string {
  const item = (i: DailyItem) => {
    const titulo = i.url ? `<a href="${esc(i.url)}">${esc(i.titulo)}</a>` : esc(i.titulo);
    const atraso = i.atraso_dias ? ` <span style="color:#c0392b">(${i.atraso_dias} d de atraso)</span>` : '';
    return `<li><strong>${esc(i.cliente)}</strong> · ${titulo} · ${(i.owners?.length ? i.owners : [i.owner]).map((o) => mencion(o, men)).join(', ')}${i.fecha ? ` · ${esc(fmtCorta(i.fecha))}` : ''}${atraso}</li>`;
  };
  const li = (xs: DailyItem[]) => (xs.length ? `<ul>${xs.map(item).join('')}</ul>` : '<p><em>Nada.</em></p>');
  return [

    `<p><strong>RESPONSABLE:</strong> ${esc(m.responsable)} · <strong>Hora:</strong> ${m.tipo === 'apertura' ? '9H00 AM' : '6H00 PM'}</p>`,
    ...(m.narrativa ? [mencionarEnHtml(markdownBasico(m.narrativa, { saltos: true }), men), SALTO] : []),
    `<p>📌 <strong>Notas clave del día</strong></p>`, m.notas.length ? `<ul>${m.notas.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '<p><em>Nada.</em></p>',
    ...(m.tipo === 'cierre' && m.kpis ? [SALTO, `<p>📊 <strong>Métricas del día</strong></p>`, kpisDaily(m.kpis, men)] : []),
    ...(m.tipo === 'cierre' ? [
      SALTO, `<p>✅ <strong>Completado hoy</strong></p>`, ...(m.completadas?.length ? [`<p><em>Por persona</em></p>`, porPersonaDaily(m.completadas, men), `<p><em>Por tarea</em></p>`] : []), li(m.completadas ?? []),
      SALTO, `<p>➕ <strong>Completadas fuera del daily</strong></p>`, ...(m.completadas_fuera?.length ? [`<p><em>Por persona</em></p>`, porPersonaDaily(m.completadas_fuera, men), `<p><em>Por tarea</em></p>`] : []), li(m.completadas_fuera ?? []),
    ] : []),
    SALTO, `<p>🎯 <strong>${m.tipo === 'cierre' ? 'Quedó abierto de lo de hoy' : 'Hoy se trabaja'}</strong></p>`, ...(m.hoy.length ? [`<p><em>Por persona</em></p>`, porPersonaDaily(m.hoy, men), `<p><em>Por tarea</em></p>`] : []), li(m.hoy),
    SALTO, `<p>⏰ <strong>Vence hoy o mañana sin iniciar</strong></p>`, li(m.vencen),
    SALTO, `<p>⛔ <strong>Bloqueos nuevos</strong></p>`, li(m.bloqueos),
    SALTO, `<p>📅 <strong>Fechas cambiadas</strong></p>`, li(m.cambios),
    `<p style="color:#888;font-size:12px">${m.narrativa ? `Redactado por BackIO, publicado por ${esc(m.responsable)}` : 'Generado por BackIO'}</p>`,
  ].join('\n');
}

/**
 * Bloque "por persona" del daily: persona → board (cliente) → tareas. Basecamp no admite tablas en
 * mensajes, así que va como lista anidada. Una tarea con varios responsables aparece bajo cada uno.
 */
export function porPersonaDaily(hoy: DailyItem[], men?: Menciones): string {
  const porPersona = new Map<string, DailyItem[]>();
  for (const i of hoy) for (const o of (i.owners?.length ? i.owners : [i.owner])) porPersona.set(o, [...(porPersona.get(o) ?? []), i]);
  const personas = [...porPersona.keys()].sort((a, b) => a.localeCompare(b, 'es'));
  const tarea = (i: DailyItem) => `${i.url ? `<a href="${esc(i.url)}">${esc(i.titulo)}</a>` : esc(i.titulo)}${i.fecha ? ` · ${esc(fmtCorta(i.fecha))}` : ''}`;
  return `<ul>${personas.map((p) => {
    const xs = porPersona.get(p)!;
    const boards = new Map<string, DailyItem[]>();
    for (const i of xs) boards.set(i.cliente, [...(boards.get(i.cliente) ?? []), i]);
    return `<li><strong>👤 ${mencion(p, men)}</strong> · ${xs.length} ${xs.length === 1 ? 'tarea' : 'tareas'}<ul>${[...boards.entries()].map(([b, ys]) => `<li><strong>${esc(b)}</strong><ul>${ys.map((i) => `<li>${tarea(i)}</li>`).join('')}</ul></li>`).join('')}</ul></li>`;
  }).join('')}</ul>`;
}

export async function publicarDailyEnBasecamp(ctx: DbCtx, mesa: Mesa, m: DailyMensaje): Promise<{ id: number; url: string }> {
  if (!mesa.basecamp_project_id || !mesa.basecamp_board_daily_id) throw new Error(`La mesa ${mesa.nombre} no tiene board Daily configurado`);
  const bc = await BasecampClient.forTenant(ctx.tenantId);
  const r = await bc.createMessage(mesa.basecamp_project_id, mesa.basecamp_board_daily_id, { subject: tituloDaily(m, mesa), content: cuerpoDaily(m, await mencionesDailyBasecamp(ctx, bc)) });
  return { id: r.id, url: r.app_url };
}

/** Usuarios de BackIO con basecamp_user_id → sgid de mención. Si Basecamp falla, el mensaje sale con nombres sin etiqueta. */
export async function mencionesDailyBasecamp(ctx: DbCtx, bc: BasecampClient): Promise<Menciones> {
  const men: Menciones = new Map();
  try {
    const [usuarios, personas] = await Promise.all([listUsuarios(ctx), bc.listPeopleSafe()]);
    const sgidPorId = new Map(personas.filter((p) => p.sgid).map((p) => [p.id, p.sgid as string]));
    for (const u of usuarios) { const sgid = u.basecamp_user_id ? sgidPorId.get(u.basecamp_user_id) : undefined; if (sgid) men.set(u.nombre, sgid); }
  } catch (err) { console.error('[daily] menciones', err instanceof Error ? err.message : err); }
  return men;
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

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Conversión mínima markdown → HTML (títulos, listas, tablas, negritas). Basecamp acepta HTML simple. */
export function markdownBasico(md: string, opts: { saltos?: boolean } = {}): string {
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
    if (l.trim() === '---') continue;
    if (l.trim() === '') { const prev = out[out.length - 1]; if (opts.saltos && prev && prev !== SALTO && !/^<p><strong>[^<]*<\/strong><\/p>$/.test(prev)) out.push(SALTO); continue; }
    out.push(`<p>${inline(l)}</p>`);
  }
  return out.join('\n');
}
