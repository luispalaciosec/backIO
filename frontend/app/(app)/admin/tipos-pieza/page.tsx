'use client';
import { useEffect, useState } from 'react';
import type { TipoPieza, PasoPieza } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';

const VACIO: PasoPieza = { titulo: '', rol: '', dias_offset: 0, peso: 1, visible: false, etiqueta: '', aprobacion_cliente: false };

export default function AdminTiposPiezaPage() {
  const [tipos, setTipos] = useState<TipoPieza[]>([]);
  const [sel, setSel] = useState<TipoPieza | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const cargar = () => api<{ items: TipoPieza[] }>('/tipos-pieza?todos=1').then((r) => { setTipos(r.items); if (!sel && r.items[0]) setSel(r.items[0]); }).catch((e) => setError(e instanceof ApiError ? e.message : 'Error'));
  useEffect(() => { void cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const setPaso = (i: number, patch: Partial<PasoPieza>) => sel && setSel({ ...sel, pasos: sel.pasos.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const mover = (i: number, d: -1 | 1) => { if (!sel) return; const p = [...sel.pasos]; const j = i + d; if (j < 0 || j >= p.length) return; [p[i], p[j]] = [p[j]!, p[i]!]; setSel({ ...sel, pasos: p }); };

  async function guardar() {
    if (!sel) return; setError(null); setOk(null);
    try {
      const t = await api<TipoPieza>(`/tipos-pieza/${sel.slug || 'nuevo'}`, { method: 'PUT', json: { nombre: sel.nombre, esfuerzo: sel.esfuerzo, pasos: sel.pasos.map((p) => ({ ...p, rol: p.rol || null, etiqueta: p.etiqueta || null })), activo: sel.activo } });
      setOk(`${t.nombre} guardado`); setSel(t); await cargar();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
  }

  return (
    <div className="max-w-5xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Tipos de pieza</h1>
        <p className="text-sm text-gray-500">Cada tipo tiene su flujo de pasos. En el Builder se piden cantidades por tipo y BackIO genera un to-do por paso. Los días son antes del posteo o entrega; el esfuerzo pondera el peso (un reel de 4 pesa como 4 posts).</p>
      </header>
      {error && <Alert tipo="error">{error}</Alert>}
      {ok && <Alert tipo="ok">{ok}</Alert>}
      <div className="flex flex-wrap gap-2">
        {tipos.map((t) => <button key={t.id} className={sel?.id === t.id ? 'btn-primary' : 'btn-secondary'} onClick={() => setSel(t)}>{t.nombre}{!t.activo && ' (inactivo)'}</button>)}
        <button className="btn-ghost" onClick={() => setSel({ id: '', tenant_id: '', nombre: '', slug: '', esfuerzo: 1, activo: true, pasos: [{ ...VACIO, titulo: 'Diseño' }, { ...VACIO, titulo: 'Posteo', visible: true, etiqueta: 'Publicación' }] })}>+ Nuevo tipo</button>
      </div>
      {sel && (
        <section className="card p-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
            <div><label className="label">Nombre</label><input className="input" value={sel.nombre} onChange={(e) => setSel({ ...sel, nombre: e.target.value })} /></div>
            <div><label className="label">Esfuerzo por unidad</label><input className="input" type="number" min={0.1} step={0.5} value={sel.esfuerzo} onChange={(e) => setSel({ ...sel, esfuerzo: Number(e.target.value) })} /></div>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={sel.activo} onChange={(e) => setSel({ ...sel, activo: e.target.checked })} /> activo</label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead><tr><th className="th"></th><th className="th">Paso</th><th className="th">Rol</th><th className="th">Días antes</th><th className="th">Peso</th><th className="th">Cliente ve</th><th className="th">Etiqueta cliente</th><th className="th">Aprobación</th><th className="th"></th></tr></thead>
              <tbody>
                {sel.pasos.map((p, i) => (
                  <tr key={i}>
                    <td className="td whitespace-nowrap"><button className="text-gray-400 hover:text-gray-700" onClick={() => mover(i, -1)}>↑</button> <button className="text-gray-400 hover:text-gray-700" onClick={() => mover(i, 1)}>↓</button></td>
                    <td className="td"><input className="input" value={p.titulo} onChange={(e) => setPaso(i, { titulo: e.target.value })} /></td>
                    <td className="td"><input className="input" value={p.rol ?? ''} onChange={(e) => setPaso(i, { rol: e.target.value })} /></td>
                    <td className="td"><input className="input w-20" type="number" value={p.dias_offset} onChange={(e) => setPaso(i, { dias_offset: Number(e.target.value) })} /></td>
                    <td className="td"><input className="input w-20" type="number" step={0.5} min={0} value={p.peso} onChange={(e) => setPaso(i, { peso: Number(e.target.value) })} /></td>
                    <td className="td text-center"><input type="checkbox" checked={p.visible} onChange={(e) => setPaso(i, { visible: e.target.checked })} /></td>
                    <td className="td"><input className="input" value={p.etiqueta ?? ''} disabled={!p.visible} placeholder={p.visible ? 'obligatoria' : ''} onChange={(e) => setPaso(i, { etiqueta: e.target.value })} /></td>
                    <td className="td text-center"><input type="checkbox" checked={p.aprobacion_cliente ?? false} onChange={(e) => setPaso(i, { aprobacion_cliente: e.target.checked })} /></td>
                    <td className="td"><button className="text-xs text-red-600" onClick={() => setSel({ ...sel, pasos: sel.pasos.filter((_, j) => j !== i) })}>quitar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setSel({ ...sel, pasos: [...sel.pasos, { ...VACIO }] })}>+ Paso</button>
            <button className="btn-primary" onClick={guardar}>Guardar</button>
          </div>
        </section>
      )}
    </div>
  );
}
