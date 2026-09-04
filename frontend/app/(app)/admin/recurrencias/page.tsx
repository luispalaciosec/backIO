'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Recurrencia, Cliente, Plantilla, Usuario } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';

type Fila = Recurrencia & { proximo_periodo: string; proximo_nombre: string; pendiente: boolean };

export default function RecurrenciasPage() {
  const [items, setItems] = useState<Fila[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const cargar = () => Promise.all([api<{ items: Fila[] }>('/recurrencias'), api<{ items: Cliente[] }>('/clientes?todos=1'), api<{ items: Plantilla[] }>('/plantillas?todas=1'), api<{ items: Usuario[] }>('/usuarios')])
    .then(([r, c, p, u]) => { setItems(r.items); setClientes(c.items); setPlantillas(p.items); setUsuarios(u.items); })
    .catch((e) => setError(e instanceof ApiError ? e.message : 'Error'));
  useEffect(() => { void cargar(); }, []);
  const nc = (id: string) => clientes.find((c) => c.id === id)?.nombre ?? '—';
  const np = (id: string) => plantillas.find((p) => p.id === id)?.nombre ?? '—';
  const nu = (id: string | null) => usuarios.find((u) => u.id === id)?.nombre ?? '—';

  async function patch(id: string, body: Partial<Recurrencia>) {
    setError(null);
    try { await api(`/recurrencias/${id}`, { method: 'PATCH', json: body }); await cargar(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
  }
  async function generar(r: Fila) {
    if (!confirm(`Generar ahora "${r.proximo_nombre}" (${r.proximo_periodo}) para ${nc(r.cliente_id)}. Se crea el proyecto, sus tareas y la estructura en Basecamp. ¿Continuar?`)) return;
    setBusy(r.id); setError(null); setOk(null);
    try { const g = await api<{ proyecto_id: string; creado: boolean; nombre: string }>(`/recurrencias/${r.id}/generar`, { method: 'POST', json: {} }); setOk(g.creado ? `Creado "${g.nombre}".` : `"${g.nombre}" ya existía para ese periodo.`); await cargar(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
    setBusy(null);
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Recurrencias</h1>
        <p className="text-sm text-gray-500">Fees mensuales que BackIO genera solos. Cada día (08:05) revisa las activas: si ya llegó su día de generación y el mes siguiente no existe, crea el proyecto con la configuración guardada, lo envía a Basecamp y avisa a la ejecutiva. Se crean desde el Builder («Repetir cada mes») o desde un proyecto («↻ Repetir cada mes»).</p>
      </header>
      {error && <Alert tipo="error">{error}</Alert>}
      {ok && <Alert tipo="ok">{ok}</Alert>}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[1000px]">
          <thead><tr><th className="th">Cliente</th><th className="th">Plantilla</th><th className="th">Patrón de nombre</th><th className="th">Ejecutiva</th><th className="th">Día</th><th className="th">Último mes</th><th className="th">Próximo</th><th className="th">Activa</th><th className="th"></th></tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className={!r.activa ? 'opacity-60' : ''}>
                <td className="td font-medium whitespace-nowrap">{nc(r.cliente_id)}</td>
                <td className="td">{np(r.plantilla_id)}</td>
                <td className="td"><input className="input w-64" defaultValue={r.nombre_patron} onBlur={(e) => e.target.value !== r.nombre_patron && patch(r.id, { nombre_patron: e.target.value })} /></td>
                <td className="td"><select className="input w-40" value={r.owner_ejecutiva ?? ''} onChange={(e) => patch(r.id, { owner_ejecutiva: e.target.value || null })}><option value="">—</option>{usuarios.filter((u) => u.activo).map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></td>
                <td className="td"><input className="input w-16" type="number" min={1} max={28} defaultValue={r.dia_generacion} onBlur={(e) => Number(e.target.value) !== r.dia_generacion && patch(r.id, { dia_generacion: Number(e.target.value) })} /></td>
                <td className="td whitespace-nowrap">{r.ultimo_proyecto_id ? <Link className="link-action" href={`/proyectos/${r.ultimo_proyecto_id}`}>{r.ultimo_mes_generado ?? 'ver'}</Link> : r.ultimo_mes_generado ?? '—'}</td>
                <td className="td whitespace-nowrap"><span className={r.pendiente ? 'text-amber-700' : 'text-gray-500'}>{r.proximo_periodo}</span><div className="text-[11px] text-gray-400 truncate max-w-56" title={r.proximo_nombre}>{r.proximo_nombre}</div></td>
                <td className="td"><input type="checkbox" checked={r.activa} onChange={(e) => patch(r.id, { activa: e.target.checked })} /></td>
                <td className="td whitespace-nowrap"><button className="btn-secondary text-xs py-1" disabled={busy === r.id || !r.pendiente} title={r.pendiente ? 'Crear ya el proyecto del mes siguiente' : 'El mes siguiente ya existe'} onClick={() => generar(r)}>{busy === r.id ? 'Generando…' : 'Generar ahora'}</button></td>
              </tr>
            ))}
            {items.length === 0 && <tr><td className="td text-gray-400" colSpan={9}>Sin recurrencias. Marca «Repetir cada mes» al crear un fee en el Builder, o «↻ Repetir cada mes» en un proyecto existente.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">Nombre del periodo: el patrón admite {'{mes}'} y {'{año}'}. Fechas: inicio el día 1, entrega el último día del mes; las tareas se reparten según los offsets de la plantilla. Si el cliente no tiene proyecto en Basecamp, el proyecto se crea igual y queda marcado para reintentar.</p>
    </div>
  );
}
