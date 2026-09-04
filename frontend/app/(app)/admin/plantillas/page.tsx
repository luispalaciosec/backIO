'use client';
import { useEffect, useState } from 'react';
import type { Plantilla, PlantillaArbol, Cliente } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';

type Tarea = { titulo_interno: string; etiqueta_cliente: string | null; visible_cliente_default: boolean; peso_relativo: number; dias_offset: number; rol_sugerido: string | null };
type Bloque = { nombre: string; peso: number; opcional: boolean; tareas: Tarea[] };
type Form = { id?: string; nombre: string; descripcion: string; tipo: Plantilla['tipo']; pilar: string; familia: string; unidad: string; precio_referencia: string; cliente_id: string; recurrente: boolean; patron_nombre: string; activa: boolean; bloques: Bloque[] };

const PILARES = ['Marca', 'Crecimiento', 'Transformación', 'Transversal', 'Medios'];
const COLOR: Record<string, string> = { Marca: '#A25DDC', Crecimiento: '#00C875', Transformación: '#579BFC', Transversal: '#FDAB3D', Medios: '#808080', '': '#9CA3AF' };
const BLOQUE_COLORES = ['#0073EA', '#A25DDC', '#00C875', '#FDAB3D', '#579BFC', '#FF642E', '#0086C0', '#9CD326'];
const UNIDAD: Record<string, string> = { proyecto: 'Proyecto', mes: 'Fee mensual', pieza: 'Por pieza' };
const TIPOS: Plantilla['tipo'][] = ['campana', 'lanzamiento', 'fee_mensual', 'pieza_suelta', 'trade'];
const T0: Tarea = { titulo_interno: '', etiqueta_cliente: null, visible_cliente_default: false, peso_relativo: 1, dias_offset: 0, rol_sugerido: '' };
const F0: Form = { nombre: '', descripcion: '', tipo: 'campana', pilar: 'Transversal', familia: '', unidad: 'proyecto', precio_referencia: '', cliente_id: '', recurrente: false, patron_nombre: '', activa: true, bloques: [{ nombre: 'Brief', peso: 20, opcional: false, tareas: [{ ...T0, titulo_interno: 'Brief', dias_offset: 10 }] }, { nombre: 'Producción', peso: 60, opcional: false, tareas: [] }, { nombre: 'Entrega', peso: 20, opcional: false, tareas: [{ ...T0, titulo_interno: 'Entrega', etiqueta_cliente: 'Entrega', visible_cliente_default: true }] }] };

export default function AdminPlantillasPage() {
  const [lista, setLista] = useState<Plantilla[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [f, setF] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const cargar = () => Promise.all([api<{ items: Plantilla[] }>('/plantillas?todas=1'), api<{ items: Cliente[] }>('/clientes?todos=1')]).then(([p, c]) => { setLista(p.items); setClientes(c.items); }).catch((e) => setError(e instanceof ApiError ? e.message : 'Error'));
  useEffect(() => { void cargar(); }, []);

  async function abrir(id: string) {
    const a = await api<PlantillaArbol>(`/plantillas/${id}`);
    setF({ id: a.id, nombre: a.nombre, descripcion: a.descripcion ?? '', tipo: a.tipo, pilar: a.pilar ?? '', familia: a.familia ?? '', unidad: a.unidad ?? '', precio_referencia: a.precio_referencia ?? '', cliente_id: a.cliente_id ?? '', recurrente: a.recurrente, patron_nombre: a.patron_nombre ?? '', activa: a.activa,
      bloques: a.bloques.map((b) => ({ nombre: b.nombre, peso: b.peso, opcional: b.opcional, tareas: b.tareas.map((t) => ({ titulo_interno: t.titulo_interno, etiqueta_cliente: t.etiqueta_cliente, visible_cliente_default: t.visible_cliente_default, peso_relativo: t.peso_relativo, dias_offset: t.dias_offset, rol_sugerido: t.rol_sugerido ?? '' })) })) });
  }
  async function guardar() {
    if (!f) return; setError(null); setOk(null);
    try {
      const p = await api<PlantillaArbol>('/plantillas', { method: 'PUT', json: { ...f, pilar: f.pilar || null, familia: f.familia || null, unidad: f.unidad || null, precio_referencia: f.precio_referencia || null, cliente_id: f.cliente_id || null, patron_nombre: f.patron_nombre || null, descripcion: f.descripcion || null, bloques: f.bloques.map((b) => ({ ...b, tareas: b.tareas.map((t) => ({ ...t, rol_sugerido: t.rol_sugerido || null, etiqueta_cliente: t.etiqueta_cliente || null })) })) } });
      setOk(`"${p.nombre}" guardada`); setF({ ...f, id: p.id }); await cargar();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
  }
  const setB = (i: number, patch: Partial<Bloque>) => f && setF({ ...f, bloques: f.bloques.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const setT = (i: number, k: number, patch: Partial<Tarea>) => f && setB(i, { tareas: f.bloques[i]!.tareas.map((t, l) => (l === k ? { ...t, ...patch } : t)) });
  const suma = f ? f.bloques.reduce((s, b) => s + (Number(b.peso) || 0), 0) : 0;
  const filtradas = lista.filter((p) => !q || `${p.nombre} ${p.familia ?? ''} ${p.pilar ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Plantillas</h1>
          <p className="text-sm text-gray-500">Una por familia del catálogo, agrupadas por pilar. Bloques → grupos de Basecamp; tareas → to-dos. Los pesos de bloques suman 100; los días son antes de la entrega. Las cantidades de piezas (post, carrusel, reel) se piden en el Builder, no aquí.</p>
        </div>
        <button className="btn-primary" onClick={() => setF({ ...F0 })}>+ Nueva plantilla</button>
      </header>
      {error && <Alert tipo="error">{error}</Alert>}
      {ok && <Alert tipo="ok">{ok}</Alert>}
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="card p-3 space-y-3 max-h-[78vh] overflow-auto">
          <input className="input" placeholder="Buscar plantilla…" value={q} onChange={(e) => setQ(e.target.value)} />
          {PILARES.concat(['']).map((pl) => {
            const items = filtradas.filter((p) => (pl ? p.pilar === pl : !p.pilar));
            if (!items.length) return null;
            return (
              <div key={pl || 'sin'}>
                <div className="flex items-center gap-2 px-1 mb-1">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLOR[pl] }} />
                  <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: COLOR[pl] }}>{pl || 'Sin pilar'}</span>
                  <span className="text-[11px] text-gray-400">{items.length}</span>
                </div>
                {items.map((p) => (
                  <button key={p.id} onClick={() => abrir(p.id)} className={`w-full text-left pl-3 pr-2 py-1.5 rounded-md text-sm border-l-4 mb-0.5 transition ${f?.id === p.id ? 'bg-gray-100 font-semibold' : 'hover:bg-gray-50'} ${!p.activa ? 'opacity-50' : ''}`} style={{ borderLeftColor: COLOR[pl] }}>
                    <span className="block leading-snug">{p.nombre}</span>
                    <span className="block text-[10px] text-gray-500">{UNIDAD[p.unidad ?? ''] ?? p.tipo}{p.recurrente ? ' · ↻ mensual' : ''}{p.cliente_id ? ' · del cliente' : ''}{!p.activa ? ' · inactiva' : ''}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </aside>
        {f ? (
          <section className="card overflow-hidden">
            <div className="px-5 py-4 text-white" style={{ backgroundColor: COLOR[f.pilar] }}>
              <div className="text-[11px] uppercase tracking-wide opacity-90">{f.pilar || 'Sin pilar'}{f.familia ? ` · ${f.familia}` : ''}</div>
              <div className="text-xl font-bold leading-tight">{f.nombre || 'Nueva plantilla'}</div>
              <div className="text-xs opacity-90 mt-1">{f.bloques.length} bloques · {f.bloques.reduce((n, b) => n + b.tareas.length, 0)} tareas · {f.bloques.reduce((n, b) => n + b.tareas.filter((t) => t.visible_cliente_default).length, 0)} visibles al cliente{f.precio_referencia ? ` · ref. ${f.precio_referencia}` : ''}</div>
            </div>
            <div className="p-4 space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="md:col-span-2"><label className="label">Nombre</label><input className="input" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></div>
              <div><label className="label">Tipo</label><select className="input" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as Plantilla['tipo'] })}>{TIPOS.map((t) => <option key={t}>{t}</option>)}</select></div>
              <div><label className="label">Pilar</label><select className="input" value={f.pilar} onChange={(e) => setF({ ...f, pilar: e.target.value })}><option value="">—</option>{PILARES.map((p) => <option key={p}>{p}</option>)}</select></div>
              <div><label className="label">Familia</label><input className="input" value={f.familia} onChange={(e) => setF({ ...f, familia: e.target.value })} /></div>
              <div><label className="label">Unidad</label><select className="input" value={f.unidad} onChange={(e) => setF({ ...f, unidad: e.target.value })}><option value="">—</option><option value="proyecto">proyecto</option><option value="mes">mes</option><option value="pieza">pieza</option></select></div>
              <div><label className="label">Precio de referencia</label><input className="input" value={f.precio_referencia} onChange={(e) => setF({ ...f, precio_referencia: e.target.value })} /></div>
              <div><label className="label">Solo para el cliente</label><select className="input" value={f.cliente_id} onChange={(e) => setF({ ...f, cliente_id: e.target.value })}><option value="">General (todos)</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></div>
              <div className="flex items-end gap-4 pb-2 text-sm">
                <label className="flex items-center gap-1"><input type="checkbox" checked={f.recurrente} onChange={(e) => setF({ ...f, recurrente: e.target.checked })} /> recurrente mensual</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={f.activa} onChange={(e) => setF({ ...f, activa: e.target.checked })} /> activa</label>
              </div>
              {f.recurrente && <div className="md:col-span-3"><label className="label">Patrón de nombre mensual</label><input className="input" placeholder="Cronograma de contenido - {mes} {año}" value={f.patron_nombre} onChange={(e) => setF({ ...f, patron_nombre: e.target.value })} /></div>}
              <div className="md:col-span-3"><label className="label">Descripción</label><input className="input" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between"><div className="font-semibold">Bloques <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-semibold ${Math.abs(suma - 100) > 0.5 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{Math.abs(suma - 100) > 0.5 ? `suman ${Math.round(suma * 10) / 10}, deben ser 100` : 'suman 100'}</span></div><button className="btn-secondary" onClick={() => setF({ ...f, bloques: [...f.bloques, { nombre: 'Nuevo bloque', peso: 0, opcional: false, tareas: [] }] })}>+ Bloque</button></div>
              <div className="flex h-2 rounded-full overflow-hidden bg-gray-100" title="Distribución de peso por bloque">
                {f.bloques.map((b, i) => <div key={i} style={{ width: `${Math.max(0, Number(b.peso) || 0)}%`, backgroundColor: BLOQUE_COLORES[i % BLOQUE_COLORES.length] }} title={`${b.nombre}: ${b.peso}%`} />)}
              </div>
              {f.bloques.map((b, i) => (
                <div key={i} className="rounded-md border border-gray-200 overflow-hidden">
                  <div className="flex flex-wrap gap-2 items-center px-3 py-2 border-l-4" style={{ borderLeftColor: BLOQUE_COLORES[i % BLOQUE_COLORES.length], backgroundColor: `${BLOQUE_COLORES[i % BLOQUE_COLORES.length]}14` }}>
                    <input className="input max-w-xs font-semibold" value={b.nombre} onChange={(e) => setB(i, { nombre: e.target.value })} />
                    <label className="text-sm flex items-center gap-1">peso <input className="input w-20" type="number" value={b.peso} onChange={(e) => setB(i, { peso: Number(e.target.value) })} /> %</label>
                    <label className="text-sm flex items-center gap-1"><input type="checkbox" checked={b.opcional} onChange={(e) => setB(i, { opcional: e.target.checked })} /> opcional</label>
                    <span className="flex-1" />
                    <button className="btn-secondary px-3 py-1 text-xs" onClick={() => setB(i, { tareas: [...b.tareas, { ...T0 }] })}>+ Tarea</button>
                    <button className="btn-danger px-3 py-1 text-xs" onClick={() => setF({ ...f, bloques: f.bloques.filter((_, j) => j !== i) })}>Quitar bloque</button>
                  </div>
                  <div className="p-2">
                  {b.tareas.length > 0 && (
                    <table className="w-full text-sm">
                      <thead><tr><th className="th">Tarea</th><th className="th">Rol</th><th className="th">Días antes</th><th className="th">Peso rel.</th><th className="th">Cliente ve</th><th className="th">Etiqueta</th><th className="th"></th></tr></thead>
                      <tbody>{b.tareas.map((t, k) => (
                        <tr key={k}>
                          <td className="td"><input className="input" value={t.titulo_interno} onChange={(e) => setT(i, k, { titulo_interno: e.target.value })} /></td>
                          <td className="td"><input className="input" value={t.rol_sugerido ?? ''} onChange={(e) => setT(i, k, { rol_sugerido: e.target.value })} /></td>
                          <td className="td"><input className="input w-20" type="number" value={t.dias_offset} onChange={(e) => setT(i, k, { dias_offset: Number(e.target.value) })} /></td>
                          <td className="td"><input className="input w-20" type="number" step={0.5} value={t.peso_relativo} onChange={(e) => setT(i, k, { peso_relativo: Number(e.target.value) })} /></td>
                          <td className="td text-center"><input type="checkbox" checked={t.visible_cliente_default} onChange={(e) => setT(i, k, { visible_cliente_default: e.target.checked })} /></td>
                          <td className="td"><input className="input" disabled={!t.visible_cliente_default} placeholder={t.visible_cliente_default ? 'obligatoria' : ''} value={t.etiqueta_cliente ?? ''} onChange={(e) => setT(i, k, { etiqueta_cliente: e.target.value })} /></td>
                          <td className="td"><button className="link-danger" onClick={() => setB(i, { tareas: b.tareas.filter((_, l) => l !== k) })}>quitar</button></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  )}
                  {b.tareas.length === 0 && <div className="text-xs text-gray-400 px-2 py-1">Sin tareas fijas: aquí van las piezas (post, carrusel, reel) que se piden en el Builder.</div>}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-2 border-t border-gray-100"><button className="btn-primary" onClick={guardar}>Guardar plantilla</button><button className="btn-ghost" onClick={() => setF(null)}>Cerrar</button></div>
            </div>
          </section>
        ) : <div className="card p-8 text-gray-500">Elige una plantilla o crea una nueva.</div>}
      </div>
    </div>
  );
}
