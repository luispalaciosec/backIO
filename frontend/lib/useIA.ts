'use client';
import { useEffect, useState } from 'react';
import { api } from './api';

/** ¿Está configurada la capa de IA en el backend? Los botones ✨ solo aparecen si sí. */
export function useIA(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => { api<{ disponible: boolean }>('/ia/estado').then((r) => setOk(r.disponible)).catch(() => setOk(false)); }, []);
  return ok;
}
