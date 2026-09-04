'use client';
import { useState } from 'react';
import type { RequerimientoMetricas, Cliente, Usuario, EstadoOperativo } from '@backio/shared';
import { COLOR_ESTADO, COLOR_PRIORIDAD } from './colores';
import { ESTADO_LABEL, PRIORIDAD_LABEL, fechaCorta } from '@/lib/format';
import { Avatar } from './Celdas';

const COLUMNAS: EstadoOperativo[] = ['backlog', 'priorizado', 'en_ejecucion', 'en_revision', 'bloqueado', 'reprogramado', 'completado'];

export function KanbanBoard({ items, clientes, usuarios, onMover }: {
  items: RequerimientoMetricas[]; clientes: Cliente[]; usuarios: Usuario[];
  onMover: (id: string, estado: EstadoOperativo) => Promise<void>;
}) {
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<EstadoOperativo | null>(null);
  const cliente = (id: string) => clientes.find((c) => c.id === id)?.nombre ?? '';
  const nombre = (id?: string) => usuarios.find((u) => u.id === id)?.nombre;

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 min-h-[60vh]">
      {COLUMNAS.map((estado) => {
        const cards = items.filter((r) => r.estado_operativo === estado);
        return (
          <div
            key={estado}
            className={`w-72 shrink-0 rounded-lg bg-gray-100 flex flex-col transition ${sobre === estado ? 'ring-2 ring-brand/50' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setSobre(estado); }}
            onDragLeave={() => setSobre(null)}
            onDrop={async (e) => {
              e.preventDefault(); setSobre(null);
              const id = e.dataTransfer.getData('text/plain') || arrastrando;
              const r = items.find((x) => x.id === id);
              if (!r || r.estado_operativo === estado) return;
              if (estado === 'completado' && r.basecamp_todo_id) { alert('Este requerimiento se completa desde Basecamp.'); return; }
              await onMover(r.id, estado);
            }}
          >
            <div className="rounded-t-lg px-3 py-2 text-white text-sm font-semibold flex justify-between" style={{ backgroundColor: COLOR_ESTADO[estado] }}>
              <span>{ESTADO_LABEL[estado]}</span><span className="opacity-80">{cards.length}</span>
            </div>
            <div className="p-2 space-y-2 flex-1">
              {cards.map((r) => (
                <article
                  key={r.id}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', r.id); setArrastrando(r.id); }}
                  onDragEnd={() => setArrastrando(null)}
                  className={`card p-3 text-sm cursor-grab active:cursor-grabbing ${arrastrando === r.id ? 'opacity-50' : ''}`}
                >
                  <div className="text-[11px] text-gray-500 mb-1">{cliente(r.cliente_id)}</div>
                  <div className="font-medium leading-snug">{r.titulo_interno}</div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="rounded px-1.5 py-0.5 text-[10px] text-white font-semibold" style={{ backgroundColor: COLOR_PRIORIDAD[r.prioridad] }}>{PRIORIDAD_LABEL[r.prioridad]}</span>
                    <span className={`text-xs ${r.dias_atraso > 0 ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>{fechaCorta(r.fecha_entrega)}</span>
                    {nombre(r.owner_agencia[0]) ? <Avatar nombre={nombre(r.owner_agencia[0])!} size={22} /> : <span className="w-[22px]" />}
                  </div>
                </article>
              ))}
              {cards.length === 0 && <div className="text-xs text-gray-400 text-center py-6">Suelta aquí</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
