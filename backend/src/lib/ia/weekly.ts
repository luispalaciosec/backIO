/**
 * Weekly narrado: status en prosa + agenda agrupada por causa con una pregunta de decisión por grupo.
 * La agrupación por causa es determinista (no la decide la IA); la IA redacta la narrativa y las preguntas.
 */
import type { Senal, TipoSenal, WeeklyIA, AgendaIA } from '@backio/shared';
import type { DbCtx } from '../db/client';
import { getSemana, listSenales, listAcuerdosAbiertos } from '../db/semanas';
import { listUsuarios } from '../db/usuarios';
import { getMesa } from '../db/mesas';
import { buildDashboard } from '../dashboard';
import { fechaLocal } from '../rituals/daily';
import { generarTexto } from './index';

export const CAUSAS: Record<TipoSenal, string> = {
  bloqueo_cliente: 'Dependencias del cliente',
  cuenta_silenciosa: 'Relación con cuentas',
  concentracion_carga: 'Capacidad del equipo',
  sobrecarga_proyectada: 'Capacidad del equipo',
  arrastre_reincidente: 'Ejecución y arrastre',
  sin_movimiento: 'Ejecución y arrastre',
  atraso_critico: 'Ejecución y arrastre',
  compromiso_vencido: 'Compromisos internos',
  reproceso_reincidente: 'Calidad y reprocesos',
  reprogramacion_sin_motivo: 'Causas pendientes de registrar',
  reproceso_sin_motivo: 'Causas pendientes de registrar',
};

export function agruparPorCausa(senales: Senal[], compromisosVencidos: string[]): { causa: string; items: string[]; severidad_max: string }[] {
  const orden = { critica: 3, alta: 2, media: 1 } as Record<string, number>;
  const grupos = new Map<string, { items: string[]; sev: number }>();
  for (const s of senales) {
    if (s.atendida) continue;
    const causa = CAUSAS[s.tipo] ?? 'Otros';
    const g = grupos.get(causa) ?? { items: [], sev: 0 };
    g.items.push(`[${s.severidad}] ${s.titulo}`);
    g.sev = Math.max(g.sev, orden[s.severidad] ?? 0);
    grupos.set(causa, g);
  }
  if (compromisosVencidos.length) {
    const g = grupos.get('Compromisos internos') ?? { items: [], sev: 2 };
    g.items.push(...compromisosVencidos.map((c) => `[vencido] ${c}`));
    grupos.set('Compromisos internos', g);
  }
  return [...grupos.entries()]
    .map(([causa, g]) => ({ causa, items: g.items, severidad_max: g.sev === 3 ? 'critica' : g.sev === 2 ? 'alta' : 'media' }))
    .sort((a, b) => (b.severidad_max === 'critica' ? 3 : b.severidad_max === 'alta' ? 2 : 1) - (a.severidad_max === 'critica' ? 3 : a.severidad_max === 'alta' ? 2 : 1));
}

const SYSTEM_WEEKLY = `Eres el analista de operaciones de la agencia. Preparas el weekly que dirige la jefa de operaciones.
Responde en TEXTO PLANO con exactamente este formato (sin JSON, sin markdown, sin comillas especiales):

NARRATIVA:
(2 a 4 párrafos cortos, máximo 1200 caracteres en total, separados por línea en blanco. Estado real de la semana: qué se entregó, qué se arrastra y por qué, dónde está la presión (clientes, personas), qué cambió respecto a los números. Nombra personas y clientes cuando estén en los datos. Sin listas.)

AGENDA:
causa :: pregunta
causa :: pregunta

En AGENDA escribe una línea por cada entrada de "grupos", en el mismo orden y copiando el texto de "causa" tal cual; después de " :: " va UNA pregunta concreta de una sola frase que la mesa debe decidir hoy (qué se reprograma, quién asume, a quién se escala, qué se le dice al cliente). Nada de preguntas genéricas.`;

export async function narrarWeekly(ctx: DbCtx, semanaId: string, mesaId?: string | null): Promise<WeeklyIA> {
  const semana = await getSemana(ctx, semanaId);
  if (!semana) throw new Error('Semana no encontrada');
  const mesa = mesaId ? await getMesa(ctx, mesaId) : null;
  const [senales, abiertos, usuarios, dash] = await Promise.all([listSenales(ctx, semanaId), listAcuerdosAbiertos(ctx), listUsuarios(ctx), buildDashboard(ctx, mesaId ?? null)]);
  const hoy = fechaLocal();
  const nombre = (id: string) => usuarios.find((u) => u.id === id)?.nombre ?? '—';
  const vencidos = abiertos.filter((a) => a.fecha_compromiso < hoy).map((a) => `${a.descripcion} · ${nombre(a.responsable_id)} · ${a.fecha_compromiso}`);
  const grupos = agruparPorCausa(senales, vencidos);
  const payload = {
    semana: { numero_iso: semana.numero_iso, inicio: semana.fecha_inicio, fin: semana.fecha_fin },
    mesa: mesa?.nombre ?? 'toda la agencia',
    kpis: dash.kpis,
    por_cliente: dash.por_cliente.map((c) => ({ cliente: c.cliente, salud: c.salud, activos: c.activos, atrasados: c.atrasados, esperando_cliente: c.esperando_cliente, completados_30d: c.completados_30d, horas_30d: c.horas_30d })),
    por_persona: dash.por_persona.map((p) => ({ persona: p.nombre, activos: p.activos, esta_semana: p.semana_actual, pct_capacidad: p.pct_semana, atrasados: p.atrasados, horas_30d: p.horas_30d })),
    ultimas_semanas: dash.ultimas_8_semanas.slice(-4),
    arrastre: dash.arrastre.slice(0, 12).map((a) => ({ tarea: a.titulo, cliente: a.cliente, owner: a.owner, reprogramada_veces: a.veces_reprogramado, dias_arrastre: a.dias_arrastre })),
    grupos,
  };
  const g = await generarTexto(ctx, { tipo: 'weekly', entidad: { tipo: 'semana', id: semanaId }, payload, system: SYSTEM_WEEKLY, maxTokens: 4000, cacheMs: 15 * 60_000 });
  const out = parsearWeekly(g.texto);
  const norm = (x: string) => x.toLowerCase().replace(/[^a-záéíóúñ ]/g, '').trim();
  const agenda: AgendaIA[] = grupos.map((gr) => ({ causa: gr.causa, items: gr.items, pregunta: out.agenda.find((a) => norm(a.causa) === norm(gr.causa))?.pregunta ?? out.agenda.find((a) => norm(gr.causa).includes(norm(a.causa)) || norm(a.causa).includes(norm(gr.causa)))?.pregunta ?? '¿Qué decidimos hoy sobre esto?' }));
  return { narrativa: out.narrativa, agenda, generado_at: new Date().toISOString() };
}

/** Formato de texto plano NARRATIVA: / AGENDA: (más robusto que JSON con títulos que traen comillas). */
export function parsearWeekly(texto: string): { narrativa: string; agenda: { causa: string; pregunta: string }[] } {
  // Compatibilidad: si llega JSON (respuestas antiguas en caché), se intenta leer.
  const posibleJson = texto.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (posibleJson.startsWith('{')) {
    try { const j = JSON.parse(posibleJson) as { narrativa?: string; agenda?: { causa: string; pregunta: string }[] }; if (j.narrativa) return { narrativa: j.narrativa, agenda: j.agenda ?? [] }; } catch { /* sigue al formato de texto */ }
  }
  const t = texto.replace(/\r/g, '');
  const iN = t.search(/NARRATIVA\s*:/i); const iA = t.search(/\nAGENDA\s*:/i);
  const narrativa = (iN >= 0 ? t.slice(t.indexOf(':', iN) + 1, iA >= 0 ? iA : undefined) : (iA >= 0 ? t.slice(0, iA) : t)).trim();
  const agenda: { causa: string; pregunta: string }[] = [];
  if (iA >= 0) {
    for (const linea of t.slice(t.indexOf(':', iA) + 1).split('\n')) {
      const m = /^\s*[-•*]?\s*(.+?)\s*::\s*(.+?)\s*$/.exec(linea);
      if (m) agenda.push({ causa: m[1]!, pregunta: m[2]! });
    }
  }
  return { narrativa: narrativa || texto.trim(), agenda };
}

export function renderWeeklyIA(w: WeeklyIA): string {
  const l = ['## Resumen ejecutivo', '', w.narrativa.trim(), ''];
  if (w.agenda.length) {
    l.push('## Agenda por causa', '');
    for (const a of w.agenda) {
      l.push(`### ${a.causa}`, ...a.items.map((i) => `- ${i}`), `**Decisión:** ${a.pregunta}`, '');
    }
  }
  return l.join('\n');
}
