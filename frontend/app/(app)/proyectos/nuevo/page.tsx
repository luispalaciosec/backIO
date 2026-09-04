'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Plantilla, PlantillaArbol, Cliente, Usuario } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';
import { ESTADO_INICIAL, guardarBorrador, leerBorrador, limpiarBorrador, toInput, type WizardState, type Catalogo } from './wizard';
import { Step1Plantilla } from './_steps/Step1Plantilla';
import { Step2Brief } from './_steps/Step2Brief';
import { Step3Alcance } from './_steps/Step3Alcance';
import { Step4EquipoFechas } from './_steps/Step4EquipoFechas';
import { Step5Revision } from './_steps/Step5Revision';
import { Borradores, type Borrador } from './_components/Borradores';

const PASOS = ['Tipo de trabajo', 'Brief', 'Alcance', 'Equipo y fechas', 'Revisión'];

export default function NuevoProyectoPage() {
  const router = useRouter();
  const [s, setS] = useState<WizardState>(ESTADO_INICIAL);
  const [cat, setCat] = useState<Catalogo>({ plantillas: [], clientes: [], usuarios: [] });
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [borradores, setBorradores] = useState<Borrador[]>([]);
  const [pendiente, setPendiente] = useState<WizardState | null>(null);

  useEffect(() => {
    // Siempre se arranca en el paso 1. Si había un proyecto a medio crear, se ofrece continuar.
    const b = leerBorrador();
    if (b && b.paso > 1 && b.plantilla) setPendiente(b);
    Promise.all([
      api<{ items: Plantilla[] }>('/plantillas'),
      api<{ items: Cliente[] }>('/clientes'),
      api<{ items: Usuario[] }>('/usuarios'),
    ])
      .then(([p, c, u]) => setCat({ plantillas: p.items, clientes: c.items, usuarios: u.items }))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo cargar el catálogo'));
    api<{ items: Borrador[] }>('/proyectos/borradores').then((r) => setBorradores(r.items)).catch(() => {});
  }, []);
  useEffect(() => { guardarBorrador(s); }, [s]);

  const set = (patch: Partial<WizardState>) => setS((prev) => ({ ...prev, ...patch }));

  async function elegirPlantilla(id: string, extra: Partial<WizardState> = {}) {
    const arbol = await api<PlantillaArbol>(`/plantillas/${id}`);
    const bloques = Object.fromEntries(arbol.bloques.map((b) => [b.id, { bloque_id: b.id, activo: true, owner_id: null, piezas_por_canal: {} }]));
    set({ plantilla: arbol, bloques, paso: 2, ...extra });
  }

  /** Desde un borrador de PrometIO: cliente, cotización, nombre y plantilla sugerida ya vienen; la ejecutiva completa el brief. */
  async function usarBorrador(b: Borrador) {
    const p = b.payload;
    const extra: Partial<WizardState> = {
      cliente_id: b.cliente_id,
      prometio_cotizacion_id: b.prometio_cotizacion_id,
      nombre: p.lineas?.[0]?.servicio ? `${p.lineas[0].servicio} - ${p.empresa?.nombre ?? ''}`.trim() : `Cotización ${p.numero ?? ''}`.trim(),
      fecha_entrega: p.valido_hasta ?? '',
      brief: { ...s.brief, objetivo_negocio: `Cotización ${p.numero ?? ''} aprobada en PrometIO${p.valor ? ` por USD ${p.valor}` : ''}. Líneas: ${(p.lineas ?? []).map((l) => `${l.servicio} ×${l.cantidad}`).join(', ')}.` },
    };
    if (b.plantilla_sugerida_id) await elegirPlantilla(b.plantilla_sugerida_id, extra);
    else set({ ...extra, paso: 1 });
  }

  async function crear() {
    setCreando(true);
    setError(null);
    try {
      const r = await api<{ proyecto: { id: string } }>('/proyectos', { method: 'POST', json: toInput(s) });
      limpiarBorrador();
      router.push(`/proyectos/${r.proyecto.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo crear el proyecto');
      setCreando(false);
    }
  }

  const puedeAvanzar2 = s.cliente_id && s.nombre.length >= 3 && s.brief.objetivo_negocio && s.brief.publico_objetivo && s.brief.canales.length > 0 && s.fecha_entrega;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Nuevo proyecto</h1>
        <ol className="flex gap-2 mt-3 text-sm">
          {PASOS.map((p, i) => {
            const n = (i + 1) as WizardState['paso'];
            const activo = s.paso === n;
            const hecho = s.paso > n;
            return (
              <li key={p} className={`flex items-center gap-2 rounded-full px-3 py-1 ${activo ? 'bg-brand text-white' : hecho ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                <span className="font-semibold">{n}</span> {p}
              </li>
            );
          })}
        </ol>
      </header>

      {error && <Alert tipo="error">{error}</Alert>}
      {pendiente && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm flex items-center justify-between gap-3">
          <span className="text-blue-900">Dejaste un proyecto a medio crear{pendiente.nombre ? `: "${pendiente.nombre}"` : ''} (paso {pendiente.paso}).</span>
          <span className="flex gap-2">
            <button className="btn-primary" onClick={() => { setS(pendiente); setPendiente(null); }}>Continuar</button>
            <button className="btn-ghost" onClick={() => { limpiarBorrador(); setPendiente(null); }}>Descartar</button>
          </span>
        </div>
      )}

      {borradores.length > 0 && s.paso === 1 && (
        <Borradores items={borradores} clientes={cat.clientes} plantillas={cat.plantillas} onUsar={usarBorrador} onDescartar={async (id) => { await api(`/proyectos/borradores/${id}/descartar`, { method: 'POST' }); setBorradores((b) => b.filter((x) => x.id !== id)); }} />
      )}
      {borradores.length > 0 && s.paso > 1 && !s.prometio_cotizacion_id && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm flex items-center justify-between gap-3">
          <span className="text-amber-900">Hay {borradores.length} {borradores.length === 1 ? 'cotización ganada' : 'cotizaciones ganadas'} en PrometIO esperando convertirse en proyecto.</span>
          <button className="btn-secondary" onClick={() => { limpiarBorrador(); setS({ ...ESTADO_INICIAL }); }}>Ver cotizaciones</button>
        </div>
      )}
      {s.paso === 1 && <Step1Plantilla plantillas={cat.plantillas} onSelect={(id) => elegirPlantilla(id)} seleccionada={s.plantilla?.id ?? null} />}
      {s.paso === 2 && s.plantilla && <Step2Brief state={s} set={set} clientes={cat.clientes} />}
      {s.paso === 3 && s.plantilla && <Step3Alcance state={s} set={set} />}
      {s.paso === 4 && s.plantilla && <Step4EquipoFechas state={s} set={set} usuarios={cat.usuarios} />}
      {s.paso === 5 && s.plantilla && <Step5Revision state={s} usuarios={cat.usuarios} clientes={cat.clientes} />}

      <footer className="flex justify-between border-t border-gray-200 pt-4">
        <button className="btn-secondary" disabled={s.paso === 1} onClick={() => set({ paso: (s.paso - 1) as WizardState['paso'] })}>Volver</button>
        {s.paso < 5 && s.paso > 1 && (
          <button className="btn-primary" disabled={s.paso === 2 && !puedeAvanzar2} onClick={() => set({ paso: (s.paso + 1) as WizardState['paso'] })}>Continuar</button>
        )}
        {s.paso === 5 && <button className="btn-primary" disabled={creando} onClick={crear}>{creando ? 'Creando…' : 'Crear proyecto'}</button>}
      </footer>
    </div>
  );
}
