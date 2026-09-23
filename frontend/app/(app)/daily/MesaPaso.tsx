'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const KEY = 'backio:daily:mesa';

/** Paso 1 del daily: elegir la mesa. La mesa vive en la URL (?mesa=) y se recuerda en el navegador. */
export function MesaPaso({ mesas, mesa, todas }: { mesas: { id: string; nombre: string }[]; mesa: string; todas: boolean }) {
  const router = useRouter();
  const ir = (id: string) => { try { localStorage.setItem(KEY, id); } catch { /* sin storage */ } router.replace(id ? `/daily?mesa=${id}` : '/daily?mesa=todas'); router.refresh(); };
  useEffect(() => {
    if (mesa || todas) return;
    let ultima: string | null = null;
    try { ultima = localStorage.getItem(KEY); } catch { /* sin storage */ }
    if (ultima && (ultima === '' || mesas.some((m) => m.id === ultima))) router.replace(ultima ? `/daily?mesa=${ultima}` : '/daily?mesa=todas');
  }, [mesa, todas, mesas, router]);
  if (!mesa && !todas) {
    return (
      <div className="card p-8 max-w-2xl mx-auto text-center space-y-4">
        <div className="text-3xl">🎯</div>
        <h2 className="text-xl font-semibold">¿De qué mesa es este daily?</h2>
        <p className="text-sm text-gray-500">Las cuatro columnas, la selección de tareas y la apertura o cierre que se publica en Basecamp se arman solo con los clientes y proyectos de la mesa elegida.</p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          {mesas.map((m) => <button key={m.id} className="btn-primary px-6 py-3 text-base" onClick={() => ir(m.id)}>{m.nombre}</button>)}
        </div>
        <button className="text-xs text-gray-400 underline" onClick={() => ir('')}>Ver toda la agencia sin filtrar</button>
      </div>
    );
  }
  return (
    <select className="input w-44" value={mesa} onChange={(e) => ir(e.target.value)} title="Cambiar de mesa rearma todo el daily">
      <option value="">Toda la agencia</option>
      {mesas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
    </select>
  );
}
