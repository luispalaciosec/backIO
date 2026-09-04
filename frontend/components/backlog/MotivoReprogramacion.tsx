'use client';
import { useState } from 'react';
import type { MotivoReprogramacion } from '@backio/shared';
import { MOTIVOS_REPROGRAMACION } from '@backio/shared';
import { fecha } from '@/lib/format';

/** Toda reprogramación desde la UI exige motivo (decidido 04/09). La fecha original nunca se pierde. */
export function MotivoReprogramacionModal({ titulo, fechaOriginal, fechaAnterior, fechaNueva, veces, onConfirmar, onCancelar }: {
  titulo: string; fechaOriginal: string | null; fechaAnterior: string | null; fechaNueva: string | null; veces: number;
  onConfirmar: (motivo: MotivoReprogramacion) => void | Promise<void>; onCancelar: () => void;
}) {
  const [motivo, setMotivo] = useState<MotivoReprogramacion | ''>('');
  const [busy, setBusy] = useState(false);
  const info = MOTIVOS_REPROGRAMACION.find((m) => m.valor === motivo);
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={onCancelar}>
      <div className="card w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <div className="font-semibold">Reprogramar entrega</div>
          <div className="text-sm text-gray-600 mt-1">{titulo}</div>
        </div>
        <div className="text-sm grid grid-cols-3 gap-2 rounded-md bg-gray-50 p-3">
          <div><div className="text-xs text-gray-500">Comprometida</div><div className="font-medium">{fecha(fechaOriginal)}</div></div>
          <div><div className="text-xs text-gray-500">Actual</div><div className="line-through text-gray-500">{fecha(fechaAnterior)}</div></div>
          <div><div className="text-xs text-gray-500">Nueva</div><div className="font-semibold text-brand">{fecha(fechaNueva)}</div></div>
          {veces > 0 && <div className="col-span-3 text-xs text-amber-700">Ya se reprogramó {veces} {veces === 1 ? 'vez' : 'veces'}. Con 2 o más sale como señal crítica en el Weekly.</div>}
        </div>
        <div>
          <label className="label">Motivo *</label>
          <select className="input" value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoReprogramacion)} autoFocus>
            <option value="">Selecciona…</option>
            {MOTIVOS_REPROGRAMACION.map((m) => <option key={m.valor} value={m.valor}>{m.label}</option>)}
          </select>
          {info && <p className="text-xs text-gray-500 mt-1">{info.atribuible === 'equipo' ? 'Cuenta como reprogramación del equipo en los indicadores.' : info.atribuible === 'cliente' ? 'No descuenta al equipo: la causa es del cliente.' : 'Neutro: no se atribuye a nadie.'}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onCancelar}>Cancelar</button>
          <button type="button" className="btn-primary" disabled={!motivo || busy} onClick={async () => { if (!motivo) return; setBusy(true); await onConfirmar(motivo); setBusy(false); }}>{busy ? 'Guardando…' : 'Reprogramar'}</button>
        </div>
      </div>
    </div>
  );
}
