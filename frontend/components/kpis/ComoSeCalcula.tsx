'use client';
/**
 * «¿Cómo se calcula?»: explicación lúdica y personalizada de cada KPI para la persona medida.
 * Usa sus propios números: fichas que se llenan, la cuenta en palabras, cuánto le falta y cómo sumar.
 */
import type { CalculoKpi, KpiDefinicion, KpiValor } from '@backio/shared';

interface Guia { emoji: string; ficha: string; regla: string; suma: string; sumaPl: string; resta: string; restaPl: string; tip: string }
const GUIA: Record<CalculoKpi, Guia> = {
  a_tiempo: { emoji: '⏱️', ficha: 'entrega', regla: 'Cada tarea que terminas en la fecha que se comprometió (o antes) es una ficha verde. Si el cliente movió la fecha, vale la nueva; si la movimos nosotros, cuenta la original.', suma: 'entregada a tiempo', sumaPl: 'entregadas a tiempo', resta: 'entregada tarde', restaPl: 'entregadas tarde', tip: 'Si ves que no llegas, avisa antes y reprograma con el motivo correcto: si es por el cliente, no te resta.' },
  retrabajo: { emoji: '🔁', ficha: 'entrega', regla: 'Cada tarea que tuvo que volver por un error nuestro es una ficha roja. Si el cambio lo pidió el cliente, no cuenta.', suma: 'bien a la primera', sumaPl: 'bien a la primera', resta: 'con retrabajo del equipo', restaPl: 'con retrabajo del equipo', tip: 'Revisa el brief y la checklist antes de entregar: un minuto de revisión ahorra una ronda completa.' },
  levantamiento: { emoji: '📋', ficha: 'requerimiento', regla: 'Cada requerimiento que llegó completo al equipo es una ficha verde. Si tuvo que volver porque faltaba información del levantamiento, es roja.', suma: 'bien levantado', sumaPl: 'bien levantados', resta: 'volvió por info incompleta', restaPl: 'volvieron por info incompleta', tip: 'Antes de pasar un requerimiento, confirma objetivo, formato, fecha y materiales del cliente.' },
  aprobacion_primera: { emoji: '🎯', ficha: 'propuesta', regla: 'Cada pieza que el cliente aprobó en la primera revisión es una ficha verde. Si pasó por un rechazo antes, es gris.', suma: 'aprobada a la primera', sumaPl: 'aprobadas a la primera', resta: 'necesitó otra ronda', restaPl: 'necesitaron otra ronda', tip: 'Muestra avances tempranos al líder: los ajustes internos salen más baratos que un rechazo del cliente.' },
  propuestas_aprobadas: { emoji: '🏆', ficha: 'propuesta', regla: 'Cada propuesta (marcada como Propuesta) que el cliente aprueba es una ficha verde; las rechazadas son grises.', suma: 'aprobada por el cliente', sumaPl: 'aprobadas por el cliente', resta: 'rechazada', restaPl: 'rechazadas', tip: 'Marca tus tareas como «Propuesta» en el backlog para que cuenten.' },
  sla_respuesta: { emoji: '⚡', ficha: 'requerimiento', regla: 'Cada requerimiento nuevo que respondes dentro del tiempo de su prioridad (Alta 30 min, Media 1,5 h, Baja 8 h, en horario laboral) es una ficha verde.', suma: 'respondido a tiempo', sumaPl: 'respondidos a tiempo', resta: 'respondido tarde o sin marcar', restaPl: 'respondidos tarde o sin marcar', tip: 'Pulsa «Respondido» en la tarea apenas contestes al cliente: si no lo marcas, cuenta como tarde.' },
  sla_incidencia: { emoji: '🚑', ficha: 'incidencia', regla: 'Cada incidencia resuelta dentro del tiempo de su prioridad (en horario laboral) es una ficha verde.', suma: 'resuelta a tiempo', sumaPl: 'resueltas a tiempo', resta: 'resuelta tarde', restaPl: 'resueltas tarde', tip: 'Marca las urgencias como «Incidencia» y dales prioridad Alta para que el reloj sea el correcto.' },
  proactividad: { emoji: '💡', ficha: 'idea', regla: 'Cada propuesta que haces sin que el cliente la pida (marcada con ✦) enciende una ficha. La meta es llenar todas las del mes.', suma: 'idea proactiva', sumaPl: 'ideas proactivas', resta: 'por encender', restaPl: 'por encender', tip: 'Márcala con ✦ en el backlog o escribe [PROACTIVA] al inicio del título en Basecamp.' },
  manual: { emoji: '✍️', ficha: 'punto', regla: 'Este indicador no sale de las tareas: lo registra gestión cada periodo con su fuente (encuesta o dato financiero).', suma: 'obtenido', sumaPl: 'obtenidos', resta: 'posible', restaPl: 'posibles', tip: 'Pregunta a tu líder cómo va este indicador y qué lo mueve.' },
};

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;

function Fichas({ a, b, menosEsMejor }: { a: number; b: number; menosEsMejor: boolean }) {
  const escala = b > 60 ? Math.ceil(b / 60) : 1;
  const total = Math.ceil(b / escala), llenas = Math.round(a / escala);
  return (
    <div className="flex flex-wrap gap-1" aria-label={`${a} de ${b}`}>
      {Array.from({ length: total }, (_, i) => {
        const marcada = i < llenas;
        const color = marcada ? (menosEsMejor ? 'bg-red-500' : 'bg-emerald-500') : (menosEsMejor ? 'bg-emerald-200' : 'bg-gray-200');
        return <span key={i} className={`h-3.5 w-3.5 rounded-sm ${color} transition-colors`} style={{ transitionDelay: `${i * 12}ms` }} />;
      })}
      {escala > 1 && <span className="text-[10px] text-gray-400 self-center ml-1">cada cuadro = {escala}</span>}
    </div>
  );
}

/** Cuánto falta para la meta (o cuánto margen queda), en unidades concretas. */
function proximoPaso(def: KpiDefinicion, v: KpiValor, g: Guia): { texto: string; logro: boolean } {
  const a = v.dato_a ?? 0, b = v.dato_b ?? 0;
  if (def.operador === '>=') {
    const necesarias = Math.ceil(v.meta * b - 1e-9);
    const faltan = Math.max(0, necesarias - a);
    if (faltan === 0) return { texto: `¡Meta cumplida! Llevas ${a} ${a === 1 ? g.suma : g.sumaPl} y necesitabas ${necesarias}. 🎉`, logro: true };
    return { texto: `Te ${faltan === 1 ? 'falta' : 'faltan'} ${faltan} ${faltan === 1 ? g.suma : g.sumaPl} más para llegar al ${pct(v.meta)}.`, logro: false };
  }
  const permitidas = Math.floor(v.meta * b + 1e-9);
  const margen = permitidas - a;
  if (margen >= 0) return { texto: v.meta === 0 ? (a === 0 ? '¡Cero! Justo lo que pide la meta. 🎉' : '') : `Vas bien: te ${margen === 1 ? 'queda' : 'quedan'} ${margen} de margen antes de pasar el ${pct(v.meta)}. 🎉`, logro: true };
  return { texto: `Te pasaste por ${-margen}: la meta permite hasta ${permitidas} ${permitidas === 1 ? g.resta : g.restaPl} de ${b}.`, logro: false };
}

export function ComoSeCalcula({ def, v, equipo }: { def: KpiDefinicion; v: KpiValor; equipo: KpiValor }) {
  const g = GUIA[def.calculo];
  const menosEsMejor = def.operador === '<=';
  const hay = v.dato_a !== null && v.dato_b !== null && v.dato_b > 0;
  const paso = hay ? proximoPaso(def, v, g) : null;
  const avance = v.resultado === null ? 0 : Math.min(1, v.resultado);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-3xl leading-none" aria-hidden>{g.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold">{def.indicador}</div>
          <div className="text-xs text-gray-500">{menosEsMejor ? 'Aquí menos es mejor' : 'Aquí más es mejor'} · meta {menosEsMejor ? '≤' : '≥'} {pct(v.meta)}</div>
        </div>
      </div>
      <p className="text-sm text-gray-700">{g.regla}</p>
      {!hay && <p className="text-sm text-gray-400 italic">{def.calculo === 'manual' ? 'Todavía no se registra este periodo.' : 'Este mes aún no tienes tareas que cuenten para este indicador.'}</p>}
      {hay && (
        <>
          <Fichas a={v.dato_a!} b={v.dato_b!} menosEsMejor={menosEsMejor} />
          <div className="text-sm">
            <span className="text-gray-500">De {v.dato_b} {def.calculo === 'proactividad' ? 'que pide la meta del mes' : `${g.ficha}${v.dato_b === 1 ? '' : 's'}`}, </span>
            <span className={`font-bold ${menosEsMejor ? 'text-red-600' : 'text-emerald-700'}`}>{v.dato_a} {menosEsMejor ? (v.dato_a === 1 ? g.resta : g.restaPl) : (v.dato_a === 1 ? g.suma : g.sumaPl)}</span>
            <span className="text-gray-500"> = </span>
            <span className="font-bold text-gray-900">{pct(v.resultado ?? 0)}</span>
          </div>
          {/* Barra con la meta marcada */}
          <div className="relative h-3 rounded-full bg-gray-100">
            <div className={`absolute inset-y-0 left-0 rounded-full ${v.estado === 'cumple' ? 'bg-emerald-500' : 'bg-red-400'}`} style={{ width: `${avance * 100}%` }} />
            <div className="absolute -top-1 -bottom-1 w-0.5 bg-gray-800" style={{ left: `${Math.min(100, v.meta * 100)}%` }} title={`Meta ${pct(v.meta)}`} />
          </div>
          <div className="flex justify-between text-[10px] text-gray-400"><span>0%</span><span>meta {pct(v.meta)}</span><span>100%</span></div>
          {paso && paso.texto && <p className={`text-sm rounded-md px-3 py-2 ${paso.logro ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>{paso.texto}</p>}
          {equipo.resultado !== null && <p className="text-xs text-gray-500">Tu equipo va en <b>{pct(equipo.resultado)}</b>. Tu aporte suma a ese número.</p>}
        </>
      )}
      <p className="text-xs text-gray-600 border-t border-gray-100 pt-2">💬 {g.tip}</p>
    </div>
  );
}
