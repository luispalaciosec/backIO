'use client';
/**
 * Cargas secundarias de una pantalla (catálogos, horas, notas) que antes fallaban en silencio con `.catch(() => {})`:
 * el filtro o la columna quedaban vacíos y nadie sabía por qué (auditoría 10/10). Cada fallo queda nombrado y la
 * pantalla lo muestra con <AvisoCarga>.
 */
import { useCallback, useState } from 'react';

export function useAvisosCarga() {
  const [fallos, setFallos] = useState<Record<string, string>>({});
  /** Para usar en `.catch(avisar('los clientes'))`. */
  const avisar = useCallback(
    (que: string) => (e: unknown) => setFallos((f) => ({ ...f, [que]: e instanceof Error ? e.message : 'sin respuesta' })),
    [],
  );
  return { fallos, avisar };
}
