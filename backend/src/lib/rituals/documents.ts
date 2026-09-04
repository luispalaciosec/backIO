/**
 * Generación de Plan Operativo (lunes) y Acta de Cierre (viernes).
 * El markdown replica el formato actual de las actas de Geeks.
 */
import type { RequerimientoMetricas, Semana, Senal, Acuerdo, Usuario, Cliente, CapacidadPersona } from '@backio/shared';
import { temaAgenda } from './signals';

export interface PlanOperativoData {
  semana: Semana;
  mesa?: string | null;
  capacidad: CapacidadPersona[];
  prioridades: RequerimientoMetricas[];
  riesgos: Senal[];
  pendientes_anteriores: Acuerdo[];
  usuarios: Usuario[];
  clientes: Pick<Cliente, 'id' | 'nombre'>[];
}

export interface ActaCierreData extends PlanOperativoData {
  senales: Senal[];
  acuerdos_semana: Acuerdo[];
}

const fmt = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

const PRIO = { alta: 'Alta', media: 'Media', baja: 'Baja' } as const;
const ESTADO: Record<string, string> = {
  backlog: 'Backlog', priorizado: 'Priorizado', en_ejecucion: 'En ejecución', en_revision: 'En revisión',
  reprogramado: 'Reprogramado', bloqueado: 'Bloqueado', completado: 'Completado', cancelado: 'Cancelado',
};

export function calcularCapacidad(reqs: RequerimientoMetricas[], usuarios: Usuario[]): CapacidadPersona[] {
  const total = reqs.length || 1;
  return usuarios
    .filter((u) => u.activo)
    .map((u) => {
      const n = reqs.filter((r) => r.owner_agencia.includes(u.id)).length;
      return { usuario_id: u.id, nombre: u.nombre, capacidad_semanal: u.capacidad_semanal, tareas: n, pct_del_total: Math.round((n / total) * 100) };
    })
    .filter((c) => c.tareas > 0)
    .sort((a, b) => b.tareas - a.tareas);
}

function tablaTareas(reqs: RequerimientoMetricas[], d: PlanOperativoData, conEstado: boolean): string {
  const nombre = (id: string | undefined) => (id ? d.usuarios.find((u) => u.id === id)?.nombre ?? '—' : '—');
  const cliente = (id: string) => d.clientes.find((c) => c.id === id)?.nombre ?? '—';
  const head = conEstado
    ? '| # | Cliente | Tarea | Responsable | Prioridad | Fecha | Estado |\n|---|---|---|---|---|---|---|'
    : '| # | Cliente | Tarea | Responsable | Prioridad | Fecha |\n|---|---|---|---|---|---|';
  const rows = reqs.map((r, i) => {
    const base = `| ${i + 1} | ${cliente(r.cliente_id)} | ${r.titulo_interno} | ${nombre(r.owner_agencia[0])} | ${PRIO[r.prioridad]} | ${fmt(r.fecha_entrega)} |`;
    return conEstado ? `${base} ${ESTADO[r.estado_operativo] ?? r.estado_operativo}${r.dias_atraso > 0 ? ` (+${r.dias_atraso}d)` : ''} |` : base;
  });
  return [head, ...rows].join('\n');
}

export function renderPlanOperativo(d: PlanOperativoData): string {
  const s = d.semana;
  const lineas: string[] = [];
  lineas.push(`# Plan Operativo Semanal${d.mesa ? ` · ${d.mesa}` : ''} · Semana ${s.numero_iso} (${fmt(s.fecha_inicio)} – ${fmt(s.fecha_fin)})`, '');
  lineas.push('## 1. Compromisos pendientes de semanas anteriores', '');
  lineas.push(d.pendientes_anteriores.length
    ? d.pendientes_anteriores.map((a) => `- [ ] ${a.descripcion} — **${d.usuarios.find((u) => u.id === a.responsable_id)?.nombre ?? '—'}** · ${fmt(a.fecha_compromiso)}`).join('\n')
    : '_Sin pendientes._');
  lineas.push('', '## 2. Capacidad por persona', '');
  lineas.push('| Persona | Tareas | % del total | Capacidad (h) |', '|---|---|---|---|');
  lineas.push(...d.capacidad.map((c) => `| ${c.nombre} | ${c.tareas} | ${c.pct_del_total}% | ${c.capacidad_semanal} |`));
  lineas.push('', `## 3. Prioridades de la semana (${d.prioridades.length} tareas)`, '');
  lineas.push(tablaTareas(d.prioridades, d, false));
  lineas.push('', '## 4. Riesgos y dependencias', '');
  lineas.push(d.riesgos.length ? d.riesgos.map((r) => `- **${r.severidad.toUpperCase()}** · ${r.titulo} → _${temaAgenda(r.tipo)}_`).join('\n') : '_Sin riesgos detectados._');
  lineas.push('', '---', `_Generado por BackIO el ${fmt(new Date().toISOString())}._`);
  return lineas.join('\n');
}

export function renderActaCierre(d: ActaCierreData): string {
  const s = d.semana;
  const completadas = d.prioridades.filter((r) => r.estado_operativo === 'completado');
  const noCompletadas = d.prioridades.filter((r) => r.estado_operativo !== 'completado');
  const lineas: string[] = [];
  lineas.push(`# Acta de Cierre${d.mesa ? ` · ${d.mesa}` : ''} · Semana ${s.numero_iso} (${fmt(s.fecha_inicio)} – ${fmt(s.fecha_fin)})`, '');
  lineas.push(`**Resultado:** ${completadas.length} de ${d.prioridades.length} tareas completadas (${d.prioridades.length ? Math.round((completadas.length / d.prioridades.length) * 100) : 0}%).`, '');
  lineas.push('## 1. Estado de las prioridades', '');
  lineas.push(tablaTareas(d.prioridades, d, true));
  lineas.push('', `## 2. Arrastre a la siguiente semana (${noCompletadas.length})`, '');
  lineas.push(noCompletadas.length ? noCompletadas.map((r) => `- ${r.titulo_interno} · ${ESTADO[r.estado_operativo]} · reprogramado ${r.veces_reprogramado}×`).join('\n') : '_Sin arrastre._');
  lineas.push('', '## 3. Señales de la semana', '');
  lineas.push(d.senales.length ? d.senales.map((x) => `- ${x.atendida ? '✅' : '⚠️'} **${x.severidad.toUpperCase()}** · ${x.titulo}`).join('\n') : '_Sin señales._');
  lineas.push('', '## 4. Acuerdos', '');
  lineas.push('| Acuerdo | Responsable | Fecha compromiso | Estado |', '|---|---|---|---|');
  lineas.push(...d.acuerdos_semana.map((a) => `| ${a.descripcion} | ${d.usuarios.find((u) => u.id === a.responsable_id)?.nombre ?? '—'} | ${fmt(a.fecha_compromiso)} | ${a.estado} |`));
  lineas.push('', '---', `_Generado por BackIO el ${fmt(new Date().toISOString())}._`);
  return lineas.join('\n');
}
