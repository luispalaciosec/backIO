/** Publica un acta como Documento de Basecamp en el proyecto de operaciones (tenants.config.basecamp_docs_project_id). */
import type { Acta } from '@backio/shared';
import type { DbCtx } from '../db/client';
import { throwIf } from '../db/client';
import { BasecampClient } from '../basecamp/client';

export async function publicarActaEnBasecamp(ctx: DbCtx, acta: Acta): Promise<{ acta_id: string; basecamp_doc_id: number; url: string }> {
  const { data, error } = await ctx.db.from('tenants').select('config').eq('id', ctx.tenantId).single();
  throwIf(error);
  const cfg = (data as { config: { basecamp_docs_project_id?: number } }).config;
  if (!cfg.basecamp_docs_project_id) throw new Error('Falta tenants.config.basecamp_docs_project_id (proyecto Basecamp donde viven las actas)');
  const bc = await BasecampClient.forTenant(ctx.tenantId);
  const proyecto = await bc.request<{ dock: { name: string; id: number }[] }>('GET', `/projects/${cfg.basecamp_docs_project_id}.json`);
  const vault = proyecto.dock.find((d) => d.name === 'vault');
  if (!vault) throw new Error('El proyecto de actas no tiene Docs & Files habilitado');
  const titulo = `${acta.tipo === 'plan_operativo' ? 'Plan Operativo' : 'Acta de Cierre'} · ${acta.markdown.split('\n')[0]?.replace(/^#\s*/, '') ?? acta.id}`;
  const html = markdownBasico(acta.markdown);
  const doc = await bc.createDocument(cfg.basecamp_docs_project_id, vault.id, { title: titulo, content: html });
  const { error: e2 } = await ctx.db.from('actas').update({ publicado_at: new Date().toISOString(), publicado_por: ctx.usuarioId, basecamp_doc_id: doc.id }).eq('id', acta.id);
  throwIf(e2);
  const col = acta.tipo === 'plan_operativo' ? 'plan_publicado_at' : 'acta_publicada_at';
  await ctx.db.from('semanas').update({ [col]: new Date().toISOString() }).eq('id', acta.semana_id);
  return { acta_id: acta.id, basecamp_doc_id: doc.id, url: doc.app_url };
}

/** Conversión mínima markdown → HTML (títulos, listas, tablas, negritas). Basecamp acepta HTML simple. */
export function markdownBasico(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
