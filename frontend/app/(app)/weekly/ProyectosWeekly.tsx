'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  EstadoProyectoWeekly,
  GrupoTareaWeekly,
  MotivoReprogramacion,
  ProyectosWeekly,
  ProyectoWeekly,
  Senal,
  TareaWeekly,
} from '@backio/shared';
import { coincideBusqueda, hoyLocal } from '@backio/shared';
import { api, ApiError } from '@/lib/api';
import { fecha } from '@/lib/format';
import { hrefExterno } from '@/lib/url';
import { MotivoReprogramacionModal } from '@/components/backlog/MotivoReprogramacion';
import { AccionesTarea } from './AccionesTarea';
import { atenderSenal, FormAcuerdo } from './SenalesWeekly';

/** El color nunca va solo: cada estado dice en palabras qué le toca a la reunión. */
const ESTADO: Record<EstadoProyectoWeekly, { etiqueta: string; punto: string; pill: string; ayuda: string }> = {
  rojo: {
    etiqueta: 'Decidir',
    punto: 'bg-red-500',
    pill: 'bg-red-50 text-red-800',
    ayuda: 'Hay tareas bloqueadas o atrasadas que siguen en marcha',
  },
  amarillo: {
    etiqueta: 'Confirmar',
    punto: 'bg-amber-500',
    pill: 'bg-amber-50 text-amber-800',
    ayuda: 'Espera al cliente, no tiene responsable o lleva días sin movimiento',
  },
  verde: { etiqueta: 'En orden', punto: 'bg-green-500', pill: 'bg-green-50 text-green-800', ayuda: 'Va bien: no hace falta discutirlo' },
};
const GRUPOS: { id: GrupoTareaWeekly; titulo: string }[] = [
  { id: 'bloqueada', titulo: 'Bloqueadas' },
  { id: 'atrasada', titulo: 'Atrasadas y en marcha' },
  { id: 'sin_responsable', titulo: 'Sin responsable' },
  { id: 'espera_cliente', titulo: 'Esperan al cliente' },
  { id: 'quieta', titulo: 'Atrasadas y sin movimiento: ¿siguen vivas?' },
  { id: 'esta_semana', titulo: 'Salen esta semana' },
  { id: 'resto', titulo: 'Más adelante' },
];
type Filtro = 'atencion' | EstadoProyectoWeekly | 'todos';
const clave = (p: ProyectoWeekly) => `${p.cliente_id}|${p.proyecto_id ?? ''}`;

interface Comun {
  semanaId: string;
  nombres: Record<string, string>;
  usuarios: { id: string; nombre: string }[];
  escribe: boolean;
  /** La mesa donde queda un acuerdo creado desde aquí. */
  mesaDe: (clienteId: string) => string | null;
}

/** Acciones sobre varias tareas de un proyecto: nueva fecha (con motivo) o cancelar. Una a la vez, para respetar a Basecamp. */
function BarraSeleccion({ ids, tareas, limpiar }: { ids: string[]; tareas: TareaWeekly[]; limpiar: () => void }) {
  const router = useRouter();
  const [modo, setModo] = useState<'fecha' | 'cancelar' | null>(null);
  const [nueva, setNueva] = useState('');
  const [motivo, setMotivo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function aplicar(cuerpo: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    const fallas: string[] = [];
    for (const id of ids) {
      try {
        await api(`/requerimientos/${id}`, { method: 'PATCH', json: cuerpo });
      } catch (e) {
        fallas.push(`${tareas.find((t) => t.id === id)?.titulo ?? id}: ${e instanceof ApiError ? e.message : 'no se pudo'}`);
      }
    }
    setBusy(false);
    setMotivo(false);
    router.refresh();
    if (fallas.length) setMsg(`${ids.length - fallas.length} de ${ids.length} listas. Faltó: ${fallas.join(' · ')}`);
    else limpiar();
  }
  const n = ids.length;
  return (
    <div className="sticky bottom-0 z-10 rounded-md border border-brand/30 bg-blue-50 px-3 py-2 text-sm flex flex-wrap items-center gap-2">
      <b>
        {n} {n === 1 ? 'elegida' : 'elegidas'}
      </b>
      <button className="btn-secondary text-xs py-1" disabled={busy} onClick={() => setModo(modo === 'fecha' ? null : 'fecha')}>
        Nueva fecha
      </button>
      <button
        className="btn-ghost text-xs py-1 text-red-700"
        disabled={busy}
        onClick={() => setModo(modo === 'cancelar' ? null : 'cancelar')}
      >
        Cancelar tareas
      </button>
      <button className="btn-ghost text-xs py-1 ml-auto" disabled={busy} onClick={limpiar}>
        Quitar selección
      </button>
      {modo === 'fecha' && (
        <div className="w-full flex items-center gap-2">
          <input
            type="date"
            aria-label="Nueva fecha de las tareas elegidas"
            className="input w-40 text-xs py-1"
            min={hoyLocal()}
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
          />
          <button className="btn-primary text-xs py-1" disabled={!nueva || busy} onClick={() => setMotivo(true)}>
            Seguir
          </button>
        </div>
      )}
      {modo === 'cancelar' && (
        <div className="w-full flex flex-wrap items-center gap-2 text-red-800">
          <span>Se {n === 1 ? 'archiva' : `archivan ${n} to-dos`} también en Basecamp, a tu nombre.</span>
          <button className="btn-danger text-xs py-1" disabled={busy} onClick={() => aplicar({ estado_operativo: 'cancelado' })}>
            {busy ? 'Cancelando…' : `Sí, cancelar ${n}`}
          </button>
        </div>
      )}
      {msg && <p className="w-full text-xs text-red-700">{msg}</p>}
      {motivo && (
        <MotivoReprogramacionModal
          titulo={`${n} ${n === 1 ? 'tarea' : 'tareas'} de este proyecto`}
          fechaOriginal={null}
          fechaAnterior={null}
          fechaNueva={nueva}
          veces={0}
          onCancelar={() => setMotivo(false)}
          onConfirmar={(m: MotivoReprogramacion, obs: string | null) =>
            aplicar({ fecha_entrega: nueva, motivo_reprogramacion: m, observacion_reprogramacion: obs })
          }
        />
      )}
    </div>
  );
}

function FilaTarea({
  t,
  p,
  elegida,
  alternar,
  comun,
}: {
  t: TareaWeekly;
  p: ProyectoWeekly;
  elegida: boolean;
  alternar: () => void;
  comun: Comun;
}) {
  const { semanaId, nombres, usuarios, escribe, mesaDe } = comun;
  const router = useRouter();
  const [abierta, setAbierta] = useState(false);
  const [acordando, setAcordando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quien = t.owners.map((o) => nombres[o] ?? '—').join(', ') || 'Sin responsable';
  const pendientes = t.senales.filter((s) => !s.atendida);

  async function atender(s: Senal) {
    try {
      await atenderSenal(semanaId, s, true);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar');
    }
  }
  return (
    <li className="py-2.5 text-sm">
      <div className="flex items-start gap-2.5">
        {escribe && <input type="checkbox" className="mt-1" aria-label={`Elegir ${t.titulo}`} checked={elegida} onChange={alternar} />}
        <div className="min-w-0 flex-1">
          {t.basecamp_url ? (
            <a className="hover:underline break-words" href={hrefExterno(t.basecamp_url)} target="_blank" rel="noreferrer">
              {t.titulo}
            </a>
          ) : (
            <span className="break-words">{t.titulo}</span>
          )}
          <div className="text-xs text-gray-500 mt-0.5">
            {quien}
            {t.fecha_entrega ? ` · ${fecha(t.fecha_entrega)}` : ' · sin fecha'}
            {t.horas > 0 && ` · ${t.horas.toLocaleString('es-EC', { maximumFractionDigits: 1 })} h`}
            {t.dias_atraso > 0 && <span className="text-red-700 font-medium"> · {t.dias_atraso} d de atraso</span>}
            {t.veces_reprogramado > 0 && (
              <span className={t.veces_reprogramado >= 2 ? 'text-red-700' : ''}> · reprogramada {t.veces_reprogramado}×</span>
            )}
          </div>
          {pendientes.map((s) => (
            <div key={`${s.tipo}|${s.entidad_id}`} className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
              <span>{s.titulo}</span>
              {escribe && (
                <button type="button" className="text-brand hover:underline" onClick={() => atender(s)}>
                  Atendida
                </button>
              )}
            </div>
          ))}
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
        {escribe && (
          <button type="button" className="btn-ghost text-xs py-1 shrink-0" aria-expanded={abierta} onClick={() => setAbierta(!abierta)}>
            {abierta ? 'Cerrar' : 'Actuar'}
          </button>
        )}
      </div>
      {abierta && (
        <div className="mt-2 ml-6 space-y-2">
          <div className="flex flex-wrap items-start justify-end gap-2">
            <button type="button" className="btn-secondary text-xs py-1" onClick={() => setAcordando(!acordando)}>
              Crear acuerdo
            </button>
            <AccionesTarea
              tarea={{
                id: t.id,
                titulo: t.titulo,
                fecha_original: t.fecha_original,
                fecha_actual: t.fecha_entrega,
                veces: t.veces_reprogramado,
                owners: t.owners,
              }}
              usuarios={usuarios}
            />
          </div>
          {acordando && (
            <FormAcuerdo
              texto={t.titulo}
              responsable={t.owners[0] ?? null}
              usuarios={usuarios}
              cancelar={() => setAcordando(false)}
              guardar={async (f) => {
                setError(null);
                try {
                  await api(`/semanas/${semanaId}/acuerdos`, {
                    method: 'POST',
                    json: { ...f, mesa_id: mesaDe(p.cliente_id), requerimiento_id: t.id, proyecto_id: p.proyecto_id },
                  });
                  setAcordando(false);
                  router.refresh();
                } catch (e) {
                  setError(e instanceof ApiError ? e.message : 'No se pudo guardar el acuerdo');
                }
              }}
            />
          )}
        </div>
      )}
    </li>
  );
}

/** Lo primero al abrir un proyecto: cómo va, sin leer tarea por tarea. */
function ResumenProyecto({ p, nombres }: { p: ProyectoWeekly; nombres: Record<string, string> }) {
  const dec = (n: number) => n.toLocaleString('es-EC', { maximumFractionDigits: 1 });
  const datos: { etiqueta: string; valor: string; nota?: string; alerta?: boolean }[] = [
    { etiqueta: 'Avance', valor: p.avance === null ? '—' : `${Math.round(p.avance)} %` },
    { etiqueta: 'Abiertas', valor: String(p.abiertas) },
    { etiqueta: 'Salen esta semana', valor: String(p.conteo.esta_semana) },
    { etiqueta: 'Próxima entrega', valor: p.proxima_entrega ? fecha(p.proxima_entrega) : '—' },
    { etiqueta: 'Horas registradas', valor: `${dec(p.horas.total)} h`, nota: `${dec(p.horas.semana)} h esta semana` },
    { etiqueta: 'Mayor atraso', valor: p.atraso_maximo ? `${p.atraso_maximo} d` : 'Ninguno', alerta: p.atraso_maximo > 0 },
  ];
  return (
    <div className="rounded-md border border-gray-200 bg-white p-3 space-y-2">
      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {datos.map((d) => (
          <div key={d.etiqueta}>
            <dt className="text-xs text-gray-500">{d.etiqueta}</dt>
            <dd className={`text-sm font-semibold tabular-nums ${d.alerta ? 'text-red-700' : ''}`}>{d.valor}</dd>
            {d.nota && <dd className="text-xs text-gray-500">{d.nota}</dd>}
          </div>
        ))}
      </dl>
      {p.avance !== null && (
        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden" aria-hidden>
          <div className="h-full bg-brand" style={{ width: `${Math.min(100, Math.max(0, p.avance))}%` }} />
        </div>
      )}
      <p className="text-xs text-gray-600">
        <span className="text-gray-500">Quién: </span>
        {p.carga.length ? p.carga.map((c) => `${nombres[c.usuario_id] ?? '—'} (${c.tareas})`).join(' · ') : 'Sin responsable'}
      </p>
    </div>
  );
}

function DetalleProyecto({ p, comun, siguiente }: { p: ProyectoWeekly; comun: Comun; siguiente?: () => void }) {
  const { semanaId, nombres, usuarios, escribe, mesaDe } = comun;
  const router = useRouter();
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [verMas, setVerMas] = useState(p.estado === 'verde');
  const [acordando, setAcordando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const quietas = p.tareas.filter((t) => t.grupo === 'quieta');

  async function preguntar() {
    setMsg(null);
    try {
      const r = await api<{ personas: number; tareas: number }>('/semanas/daily/preguntar-vivas', {
        method: 'POST',
        json: { ids: quietas.map((t) => t.id).slice(0, 100) },
      });
      setMsg({ tipo: 'ok', texto: `Se le preguntó a ${r.personas} ${r.personas === 1 ? 'persona' : 'personas'} por la campana.` });
    } catch (e) {
      setMsg({ tipo: 'error', texto: e instanceof ApiError ? e.message : 'No se pudo preguntar' });
    }
  }
  const visibles = GRUPOS.filter((g) => p.conteo[g.id] > 0);
  const principales = visibles.filter((g) => g.id !== 'resto');
  const resto = p.conteo.resto;
  return (
    <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-3 space-y-3">
      <ResumenProyecto p={p} nombres={nombres} />
      <div className="flex flex-wrap items-center gap-2">
        {escribe && (
          <button type="button" className="btn-primary text-xs py-1" onClick={() => setAcordando(!acordando)}>
            Crear acuerdo del proyecto
          </button>
        )}
        {escribe && quietas.length > 0 && (
          <button type="button" className="btn-secondary text-xs py-1" onClick={preguntar}>
            Preguntar si {quietas.length === 1 ? 'sigue viva' : `siguen vivas las ${quietas.length}`}
          </button>
        )}
        {p.basecamp_url && (
          <a className="btn-ghost text-xs py-1" href={hrefExterno(p.basecamp_url)} target="_blank" rel="noreferrer">
            Ver en Basecamp ↗
          </a>
        )}
        {siguiente && (
          <button type="button" className="btn-secondary text-xs py-1 ml-auto" onClick={siguiente}>
            Siguiente proyecto →
          </button>
        )}
      </div>
      {msg && (
        <p className={`text-xs ${msg.tipo === 'ok' ? 'text-green-700' : 'text-red-600'}`} role="status">
          {msg.texto}
        </p>
      )}
      {acordando && (
        <FormAcuerdo
          texto=""
          responsable={p.responsables[0] ?? null}
          usuarios={usuarios}
          cancelar={() => setAcordando(false)}
          guardar={async (f) => {
            setMsg(null);
            try {
              await api(`/semanas/${semanaId}/acuerdos`, {
                method: 'POST',
                json: { ...f, mesa_id: mesaDe(p.cliente_id), proyecto_id: p.proyecto_id },
              });
              setAcordando(false);
              router.refresh();
            } catch (e) {
              setMsg({ tipo: 'error', texto: e instanceof ApiError ? e.message : 'No se pudo guardar el acuerdo' });
            }
          }}
        />
      )}
      {p.senales_de_proyecto
        .filter((s) => !s.atendida)
        .map((s) => (
          <p key={`${s.tipo}|${s.entidad_id}`} className="text-xs text-gray-600">
            {s.titulo}
          </p>
        ))}
      {(verMas ? visibles : principales).map((g) => (
        <section key={g.id}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {g.titulo} <span className="font-normal">({p.conteo[g.id]})</span>
          </h4>
          <ul className="divide-y divide-gray-100">
            {p.tareas
              .filter((t) => t.grupo === g.id)
              .map((t) => (
                <FilaTarea
                  key={t.id}
                  t={t}
                  p={p}
                  comun={comun}
                  elegida={elegidas.has(t.id)}
                  alternar={() =>
                    setElegidas((x) => {
                      const n = new Set(x);
                      if (n.has(t.id)) n.delete(t.id);
                      else n.add(t.id);
                      return n;
                    })
                  }
                />
              ))}
          </ul>
        </section>
      ))}
      {!verMas && resto > 0 && (
        <button type="button" className="text-xs text-brand hover:underline" onClick={() => setVerMas(true)}>
          Ver {resto === 1 ? '1 tarea' : `${resto} tareas`} para más adelante
        </button>
      )}
      {elegidas.size > 0 && <BarraSeleccion ids={[...elegidas]} tareas={p.tareas} limpiar={() => setElegidas(new Set())} />}
      {p.acuerdos.length > 1 && (
        <p className="text-xs text-gray-500">
          Acuerdos abiertos:{' '}
          {p.acuerdos.map((a) => `${a.descripcion} (${nombres[a.responsable_id] ?? '—'}, ${fecha(a.fecha_compromiso)})`).join(' · ')}
        </p>
      )}
    </div>
  );
}

/**
 * 2. Proyectos: la reunión recorre lo que necesita una decisión, por cliente. La tarea aparece solo al abrir el proyecto; lo
 * que va bien queda plegado. Reemplaza a las listas de Señales y Arrastre: las señales de una tarea se ven dentro de ella.
 */
export function ProyectosWeeklyVista({
  datos,
  semanaId,
  mesaId,
  mesaDeCliente,
  nombres,
  usuarios,
  escribe,
}: {
  datos: ProyectosWeekly;
  semanaId: string;
  mesaId: string | null;
  mesaDeCliente: Record<string, string>;
  nombres: Record<string, string>;
  usuarios: { id: string; nombre: string }[];
  escribe: boolean;
}) {
  const [filtro, setFiltro] = useState<Filtro>('atencion');
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);
  const comun: Comun = { semanaId, nombres, usuarios, escribe, mesaDe: (c) => mesaId ?? mesaDeCliente[c] ?? null };

  const clientes = useMemo(
    () =>
      datos.clientes
        .map((c) => ({
          ...c,
          proyectos: c.proyectos.filter((p) => {
            const pasaEstado = filtro === 'todos' || (filtro === 'atencion' ? p.estado !== 'verde' : p.estado === filtro);
            const texto = [
              p.nombre,
              c.nombre,
              c.ejecutiva_id ? (nombres[c.ejecutiva_id] ?? '') : '',
              ...p.responsables.map((r) => nombres[r] ?? ''),
              ...p.tareas.map((t) => t.titulo),
            ].join(' ');
            // Al buscar se mira todo, también lo que está en orden.
            return q ? coincideBusqueda(q, texto) : pasaEstado;
          }),
        }))
        .filter((c) => c.proyectos.length > 0),
    [datos, filtro, q, nombres],
  );
  const orden = clientes.flatMap((c) => c.proyectos);
  const { rojo, amarillo, verde } = datos.resumen;
  const chips: { id: Filtro; texto: string; punto?: string }[] = [
    { id: 'atencion', texto: `Por revisar ${rojo + amarillo}` },
    { id: 'rojo', texto: `Decidir ${rojo}`, punto: ESTADO.rojo.punto },
    { id: 'amarillo', texto: `Confirmar ${amarillo}`, punto: ESTADO.amarillo.punto },
    { id: 'verde', texto: `En orden ${verde}`, punto: ESTADO.verde.punto },
  ];
  return (
    <section className="card">
      <div className="px-4 py-3 border-b border-gray-200 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">2. Proyectos</h2>
            <p className="text-xs text-gray-500">Se discute lo que necesita una decisión. Abre un proyecto para ver sus tareas.</p>
          </div>
          <input
            className="input w-64 text-sm py-1.5"
            placeholder="Buscar proyecto, cliente, persona o tarea"
            aria-label="Buscar en los proyectos"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs" role="group" aria-label="Filtrar por estado">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={!q && filtro === c.id}
              title={c.id === 'atencion' ? 'Lo que hay que decidir o confirmar' : ESTADO[c.id as EstadoProyectoWeekly].ayuda}
              className={`rounded-full border px-3 py-1 inline-flex items-center gap-1.5 ${!q && filtro === c.id ? 'bg-brand text-white border-brand' : 'border-gray-300 hover:bg-gray-50'}`}
              onClick={() => {
                setFiltro(c.id);
                setQ('');
              }}
            >
              {c.punto && <span className={`h-2 w-2 rounded-full ${c.punto}`} aria-hidden />}
              {c.texto}
            </button>
          ))}
        </div>
      </div>
      {clientes.length === 0 && (
        <p className="p-6 text-sm text-gray-500">
          {q
            ? 'Nada coincide con la búsqueda.'
            : datos.clientes.length
              ? 'No hay nada en este estado.'
              : 'Esta mesa no tiene tareas abiertas.'}
          {!q && filtro === 'atencion' && verde > 0 ? ` Los ${verde} proyectos abiertos están en orden.` : ''}
        </p>
      )}
      <div className="divide-y divide-gray-200">
        {clientes.map((c) => (
          <div key={c.cliente_id}>
            <div className="px-4 pt-3 pb-1 flex flex-wrap items-baseline gap-x-2">
              <h3 className="font-semibold text-sm">{c.nombre}</h3>
              {c.ejecutiva_id && <span className="text-xs text-gray-500">{nombres[c.ejecutiva_id] ?? ''}</span>}
            </div>
            <ul>
              {c.proyectos.map((p) => {
                const k = clave(p);
                const ver = abierto === k;
                const e = ESTADO[p.estado];
                const i = orden.findIndex((x) => clave(x) === k);
                const sig = orden[i + 1];
                const personas = p.responsables.slice(0, 2).map((r) => (nombres[r] ?? '—').split(' ')[0]);
                return (
                  <li key={k} className={ver ? 'bg-white' : ''}>
                    <button
                      type="button"
                      className="w-full px-4 py-2.5 grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,1fr)_8rem_6rem] items-center gap-x-3 gap-y-1 text-left hover:bg-gray-50"
                      aria-expanded={ver}
                      onClick={() => setAbierto(ver ? null : k)}
                    >
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium inline-flex items-center gap-1.5 w-[5.5rem] col-span-2 sm:col-span-1 ${e.pill}`}
                        title={e.ayuda}
                      >
                        <span className={`h-2 w-2 rounded-full shrink-0 ${e.punto}`} aria-hidden />
                        {e.etiqueta}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium break-words">{p.nombre}</span>
                        <span className="block text-xs text-gray-600">{p.motivo}</span>
                        {p.acuerdos.length > 0 && (
                          <span className="block text-xs text-brand-dark">
                            Acordado: {p.acuerdos[0]!.descripcion} · {(nombres[p.acuerdos[0]!.responsable_id] ?? '—').split(' ')[0]},{' '}
                            {fecha(p.acuerdos[0]!.fecha_compromiso)}
                            {p.acuerdos.length > 1 ? ` y ${p.acuerdos.length - 1} más` : ''}
                          </span>
                        )}
                      </span>
                      <span
                        className="hidden sm:block text-xs text-gray-500 truncate"
                        title={p.responsables.map((r) => nombres[r] ?? '').join(', ')}
                      >
                        {personas.join(', ') || 'Sin responsable'}
                        {p.responsables.length > 2 ? ` +${p.responsables.length - 2}` : ''}
                      </span>
                      <span className="text-xs text-gray-500 text-right tabular-nums whitespace-nowrap">
                        {p.abiertas} {p.abiertas === 1 ? 'tarea' : 'tareas'}{' '}
                        <span aria-hidden className="text-base leading-none align-[-1px] text-gray-400">
                          {ver ? '▾' : '▸'}
                        </span>
                      </span>
                    </button>
                    {ver && <DetalleProyecto key={k} p={p} comun={comun} siguiente={sig ? () => setAbierto(clave(sig)) : undefined} />}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
