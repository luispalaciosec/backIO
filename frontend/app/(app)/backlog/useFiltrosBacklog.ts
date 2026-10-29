'use client';
/**
 * Filtros, orden y vista del backlog. Viven en la URL (sobreviven al refresh y se comparten) con respaldo en
 * localStorage, que aquí es solo una preferencia de interfaz.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { CampoOrden, Dir } from '@/lib/orden';

export type Vista = 'tabla' | 'kanban';

export function useFiltrosBacklog() {
  const router = useRouter();
  const sp = useSearchParams();
  const FILTRO0 = { cliente: '', owner: '', estado: '', activos: true, q: '', proyecto: '', mesa: '', ejecutiva: '', planificacion: '' };
  const leerInicial = () => {
    const desdeUrl = sp.toString() ? Object.fromEntries(sp.entries()) : null;
    let guardado: Record<string, string> | null = null;
    if (!desdeUrl) {
      try {
        guardado = JSON.parse(localStorage.getItem('backio:backlog:filtros') ?? 'null');
      } catch {
        /* ignore */
      }
    }
    const src = desdeUrl ?? guardado ?? {};
    return {
      filtro: {
        ...FILTRO0,
        cliente: src.cliente ?? '',
        owner: src.owner ?? '',
        estado: src.estado ?? '',
        proyecto: src.proyecto ?? '',
        mesa: src.mesa ?? '',
        ejecutiva: src.ejecutiva ?? '',
        planificacion: src.planificacion ?? '',
        q: src.q ?? '',
        activos: src.activos === undefined ? true : src.activos !== '0',
      },
      orden: { campo: (src.orden as CampoOrden) || 'fecha_entrega', dir: (src.dir as Dir) || 'asc' },
      vista: (src.vista === 'kanban' ? 'kanban' : 'tabla') as Vista,
    };
  };
  const inicial = useRef(leerInicial());
  const [vista, setVista] = useState<Vista>(inicial.current.vista);
  const [filtro, setFiltro] = useState(inicial.current.filtro);
  const [orden, setOrden] = useState<{ campo: CampoOrden; dir: Dir }>(inicial.current.orden);
  useEffect(() => {
    const q: Record<string, string> = {};
    for (const [k, v] of Object.entries(filtro)) {
      if (k === 'activos') {
        if (!v) q.activos = '0';
      } else if (v) q[k] = String(v);
    }
    if (orden.campo !== 'fecha_entrega') q.orden = orden.campo;
    if (orden.dir !== 'asc') q.dir = orden.dir;
    if (vista !== 'tabla') q.vista = vista;
    const qs = new URLSearchParams(q).toString();
    router.replace(qs ? `/backlog?${qs}` : '/backlog', { scroll: false });
    try {
      localStorage.setItem('backio:backlog:filtros', JSON.stringify(q));
    } catch {
      /* ignore */
    }
  }, [filtro, orden, vista, router]);
  return { vista, setVista, filtro, setFiltro, orden, setOrden, FILTRO0 };
}
