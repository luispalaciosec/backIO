'use client';
import { RecordatorioIA } from './RecordatorioIA';
import { useState } from 'react';
import Link from 'next/link';
import type { RequerimientoMetricas, Cliente, Usuario, ActualizarRequerimientoInput } from '@backio/shared';
import { CeldaSelect, CeldaFecha, CeldaTexto, CeldaOwners } from './Celdas';
import { COLOR_ESTADO, COLOR_APROBACION, COLOR_PRIORIDAD, COLOR_TIPO, colorGrupo } from './colores';
import { ESTADO_LABEL, APROBACION_LABEL, PRIORIDAD_LABEL, TIPO_LABEL, haceCuanto } from '@/lib/format';

const ESTADOS = Object.keys(ESTADO_LABEL);
const APROB = Object.keys(APROBACION_LABEL);
const PRIOS = Object.keys(PRIORIDAD_LABEL);
const TIPOS = Object.keys(TIPO_LABEL);

export interface BacklogTableProps {
  items: RequerimientoMetricas[];
  clientes: Cliente[];
  usuarios: Usuario[];
  onPatch: (id: string, patch: ActualizarRequerimientoInput) => Promise<void>;
  onCrear?: (clienteId: string, titulo: string) => Promise<void>;
  horas?: Record<string, number>;
  /** Si devuelve false, la fila se muestra sin editores (colaborador viendo tareas ajenas). */
  puedeEditar?: (r: RequerimientoMetricas) => boolean;
}

const COLS = 'grid-cols-[minmax(260px,2fr)_120px_120px_110px_110px_110px_130px_150px_90px_80px_80px_70px_120px_120px]';

export function BacklogTable({ items, clientes, usuarios, onPatch, onCrear, horas = {}, puedeEditar }: BacklogTableProps) {
  const [colapsados, setColapsados] = useState<Set<string>>(new Set());
  const grupos = clientes
    .map((c, i) => ({ cliente: c, color: colorGrupo(i, c.color_primario), reqs: items.filter((r) => r.cliente_id === c.id) }))
    .filter((g) => g.reqs.length > 0 || !colapsados.has(`vacio-${g.cliente.id}`));

  const toggle = (id: string) => setColapsados((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="space-y-6 min-w-[1700px]">
      {grupos.map(({ cliente, color, reqs }) => {
        const cerrado = colapsados.has(cliente.id);
        return (
          <section key={cliente.id}>
            <button type="button" onClick={() => toggle(cliente.id)} className="flex items-center gap-2 mb-1 text-lg font-semibold" style={{ color }}>
              <span className={`inline-block transition-transform ${cerrado ? '' : 'rotate-90'}`}>▸</span>
              {cliente.nombre} <span className="text-sm font-normal text-gray-400">{reqs.length} {reqs.length === 1 ? 'requerimiento' : 'requerimientos'}</span>
            </button>
            {!cerrado && (
              <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
                <div className={`grid ${COLS} text-xs font-medium text-gray-500 border-b border-gray-200 bg-gray-50`}>
                  <div className="flex"><span className="w-1.5 shrink-0" style={{ backgroundColor: color }} /><span className="px-3 py-2">Requerimiento</span></div>
                  {['Owner cliente', 'Owner agencia', 'Fecha pedido', 'Fecha entrega', 'Prioridad', 'Estado', 'Aprobación', 'Tipo', 'Atraso', 'Sin mov.', 'Horas', 'Basecamp', 'Última act.'].map((h) => (
                    <div key={h} className="px-2 py-2 text-center border-l border-gray-100 truncate">{h}</div>
                  ))}
                </div>
                {reqs.map((r) => (
                  <Fila key={r.id} r={r} color={color} usuarios={usuarios} onPatch={onPatch} horas={horas[r.id]} bloqueada={puedeEditar ? !puedeEditar(r) : false} />
                ))}
                {onCrear && <NuevaFila color={color} onCrear={(t) => onCrear(cliente.id, t)} />}
              </div>
            )}
          </section>
        );
      })}
      {grupos.length === 0 && <div className="card p-6 text-gray-500">Sin requerimientos con estos filtros.</div>}
    </div>
  );
}

function Fila({ r, color, usuarios, onPatch, horas, bloqueada }: { r: RequerimientoMetricas; color: string; usuarios: Usuario[]; onPatch: BacklogTableProps['onPatch']; horas?: number; bloqueada?: boolean }) {
  const p = (patch: ActualizarRequerimientoInput) => onPatch(r.id, patch);
  const hecho = r.estado_operativo === 'completado' || r.estado_operativo === 'cancelado';
  return (
    <div className={`grid ${COLS} border-b border-gray-100 hover:bg-gray-50/70 items-stretch ${hecho ? 'opacity-70' : ''} ${bloqueada ? 'pointer-events-none select-text bg-gray-50/40' : ''}`} title={bloqueada ? 'Tarea de otra persona: solo lectura' : undefined}>
      <div className="flex min-w-0">
        <span className="w-1.5 shrink-0" style={{ backgroundColor: color }} />
        <div className="flex-1 min-w-0 flex items-center gap-1 pl-1">
          <CeldaTexto valor={r.titulo_interno} onCommit={(v) => p({ titulo_interno: v })} className={hecho ? 'line-through text-gray-500' : ''} />
          {r.visible_cliente && <span className="text-xs shrink-0 pr-1" title={`El cliente ve: ${r.etiqueta_cliente}`}>👁</span>}
          {!hecho && (r.estado_aprobacion === 'pendiente_cliente' || r.estado_operativo === 'bloqueado') && <RecordatorioIA requerimientoId={r.id} titulo={r.titulo_interno} />}
          {r.proyecto_id && <Link href={`/proyectos/${r.proyecto_id}`} className="text-xs text-gray-400 hover:text-brand shrink-0 pr-2" title={r.bloque_nombre ?? 'proyecto'}>↗</Link>}
        </div>
      </div>
      <div className="border-l border-gray-100"><CeldaTexto valor={(r.owner_cliente ?? []).join(', ')} placeholder="—" onCommit={(v) => p({ owner_cliente: v ? v.split(',').map((s) => s.trim()).filter(Boolean) : null })} className="text-center text-xs" /></div>
      <div className="border-l border-gray-100"><CeldaOwners ids={r.owner_agencia} usuarios={usuarios} onChange={(ids) => p({ owner_agencia: ids })} /></div>
      <div className="border-l border-gray-100"><CeldaFecha valor={r.fecha_pedido} onChange={(v) => p({ fecha_pedido: v })} /></div>
      <div className="border-l border-gray-100"><CeldaFecha valor={r.fecha_entrega} onChange={(v) => p({ fecha_entrega: v })} alerta={r.dias_atraso > 0} /></div>
      <div className="border-l border-gray-100"><CeldaSelect valor={r.prioridad} opciones={PRIOS} colores={COLOR_PRIORIDAD} labels={PRIORIDAD_LABEL} onChange={(v) => p({ prioridad: v as RequerimientoMetricas['prioridad'] })} /></div>
      <div className="border-l border-gray-100"><CeldaSelect valor={r.estado_operativo} opciones={ESTADOS} colores={COLOR_ESTADO} labels={ESTADO_LABEL} disabledValues={r.basecamp_todo_id ? ['completado'] : []} onChange={(v) => p({ estado_operativo: v as RequerimientoMetricas['estado_operativo'] })} /></div>
      <div className="border-l border-gray-100"><CeldaSelect valor={r.estado_aprobacion} opciones={APROB} colores={COLOR_APROBACION} labels={APROBACION_LABEL} onChange={(v) => p({ estado_aprobacion: v as RequerimientoMetricas['estado_aprobacion'] })} /></div>
      <div className="border-l border-gray-100"><span className="h-9 flex items-center justify-center text-white text-xs font-medium" style={{ backgroundColor: COLOR_TIPO[r.tipo_trabajo] }}>{TIPO_LABEL[r.tipo_trabajo]}</span></div>
      <div className={`border-l border-gray-100 h-9 flex items-center justify-center text-sm tabular-nums ${r.dias_atraso > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>{r.dias_atraso || ''}</div>
      <div className={`border-l border-gray-100 h-9 flex items-center justify-center text-sm tabular-nums ${r.dias_sin_movimiento > 14 ? 'text-amber-600 font-semibold' : 'text-gray-500'}`}>{r.dias_sin_movimiento}</div>
      <div className="border-l border-gray-100 h-9 flex items-center justify-center text-sm tabular-nums text-gray-600" title="Horas registradas en Basecamp (últimos 90 días)">{horas ? horas.toFixed(1) : ''}</div>
      <div className="border-l border-gray-100 h-9 flex items-center justify-center text-xs">{r.basecamp_url ? <a href={r.basecamp_url} target="_blank" rel="noreferrer" className="text-brand underline truncate px-2">Basecamp</a> : <span className="text-gray-300">—</span>}</div>
      <div className="border-l border-gray-100 h-9 flex items-center justify-center text-xs text-gray-500" title={r.ultima_actualizacion}>{haceCuanto(r.ultima_actualizacion)}</div>
    </div>
  );
}

function NuevaFila({ color, onCrear }: { color: string; onCrear: (titulo: string) => Promise<void> }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center">
      <span className="w-1.5 self-stretch" style={{ backgroundColor: color, opacity: 0.4 }} />
      <input
        className="h-9 flex-1 bg-transparent text-sm px-3 placeholder:text-gray-400 focus:outline-none"
        placeholder="+ Agregar requerimiento"
        value={v}
        disabled={busy}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key === 'Enter' && v.trim()) { setBusy(true); await onCrear(v.trim()); setV(''); setBusy(false); }
        }}
      />
    </div>
  );
}
