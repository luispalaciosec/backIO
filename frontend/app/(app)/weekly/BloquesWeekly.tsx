'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';

interface ResultadoSemana {
  completadas: number;
  vigentes: number;
  pct: number | null;
}
interface Marcador {
  meta: number;
  actual: ResultadoSemana;
  compromiso: number;
  ya_completadas: number;
  anterior: ResultadoSemana | null;
  racha: number;
}

/**
 * La agenda del weekly. En «Modo reunión» se ve un bloque a la vez, en grande y en el orden de la agenda, con el marcador
 * arriba: sirve para proyectar y para que la reunión dure lo que debe. Los bloques siguen montados, así no pierden lo escrito.
 */
export function BloquesWeekly({
  bloques,
  lateral,
  semanaId,
  mesa,
}: {
  bloques: { titulo: string; contenido: ReactNode }[];
  lateral: ReactNode;
  semanaId: string;
  mesa: string;
}) {
  const [reunion, setReunion] = useState(false);
  const [i, setI] = useState(0);
  const [marcador, setMarcador] = useState<Marcador | null>(null);
  const total = bloques.length + 1; // El último paso son los acuerdos de la sesión.

  useEffect(() => {
    if (!reunion || !mesa) return;
    let vivo = true;
    api<{ marcador: Marcador | null }>(`/semanas/${semanaId}/marcador?mesa=${mesa}`)
      .then((r) => vivo && setMarcador(r.marcador))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [reunion, semanaId, mesa]);
  useEffect(() => {
    if (!reunion) return;
    const tecla = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (e.key === 'ArrowRight') setI((x) => Math.min(x + 1, total - 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(x - 1, 0));
      if (e.key === 'Escape') setReunion(false);
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [reunion, total]);

  if (!reunion)
    return (
      <>
        <div className="flex justify-end -mt-3">
          <button
            className="btn-secondary text-sm"
            onClick={() => {
              setI(0);
              setReunion(true);
            }}
          >
            ▶ Modo reunión
          </button>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-6">
            {bloques.map((b) => (
              <div key={b.titulo}>{b.contenido}</div>
            ))}
          </div>
          <aside className="space-y-4">{lateral}</aside>
        </div>
      </>
    );

  const a = marcador?.actual;
  return (
    <div className="fixed inset-0 z-40 bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <nav className="flex flex-wrap gap-1 text-sm flex-1" aria-label="Bloques de la agenda">
          {[...bloques.map((b) => b.titulo), 'Acuerdos'].map((t, n) => (
            <button
              key={t}
              aria-current={n === i ? 'step' : undefined}
              className={`rounded-full px-3 py-1 ${n === i ? 'bg-brand text-white font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
              onClick={() => setI(n)}
            >
              {n + 1}. {t}
            </button>
          ))}
        </nav>
        {a && (
          <div className="text-sm tabular-nums flex flex-wrap gap-4">
            <span>
              Semana: <b>{a.pct === null ? `${marcador!.ya_completadas} de ${marcador!.compromiso}` : `${a.pct} %`}</b>
            </span>
            <span>Meta: {marcador!.meta} %</span>
            {marcador!.anterior?.pct != null && <span>Anterior: {marcador!.anterior.pct} %</span>}
            {marcador!.racha > 0 && <span>Racha: {marcador!.racha}</span>}
          </div>
        )}
        <button className="btn-ghost text-sm" onClick={() => setReunion(false)}>
          Salir
        </button>
      </div>
      <div className="flex-1 overflow-auto p-6 text-base">
        <div className="mx-auto max-w-5xl">
          {bloques.map((b, n) => (
            <div key={b.titulo} className={n === i ? '' : 'hidden'}>
              {b.contenido}
            </div>
          ))}
          <div className={i === bloques.length ? 'max-w-xl space-y-4' : 'hidden'}>{lateral}</div>
        </div>
      </div>
      <div className="bg-white border-t border-gray-200 px-6 py-3 flex justify-between">
        <button className="btn-secondary" disabled={i === 0} onClick={() => setI(i - 1)}>
          ← Anterior
        </button>
        <span className="text-sm text-gray-500 self-center">
          {i + 1} de {total}
        </span>
        <button className="btn-primary" disabled={i === total - 1} onClick={() => setI(i + 1)}>
          Siguiente →
        </button>
      </div>
    </div>
  );
}
