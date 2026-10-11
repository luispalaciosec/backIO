'use client';
/** Carga del tablero de KPIs de un mes. */
import { useCallback, useEffect, useState } from 'react';
import type { KpiTablero } from '@backio/shared';
import { api, ApiError } from '@/lib/api';

export function useTableroKpis(mes: string, soloMios = false) {
  const [tablero, setTablero] = useState<KpiTablero | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(() => {
    setError(null);
    api<KpiTablero>(`/kpis${soloMios ? '/mios' : ''}?periodo=${mes}`)
      .then(setTablero)
      .catch((e) =>
        setError(
          e instanceof ApiError
            ? /kpi_definiciones|does not exist|schema cache/i.test(e.message)
              ? 'Falta aplicar la migración 22 de KPIs en Supabase.'
              : e.message
            : 'Error cargando KPIs',
        ),
      );
  }, [mes, soloMios]);
  useEffect(() => {
    cargar();
  }, [cargar]);
  return { tablero, error, recargar: cargar };
}
