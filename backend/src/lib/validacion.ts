/** Esquemas zod reutilizables para entradas de texto. */
import { z } from 'zod';

/**
 * Texto de una sola línea (títulos y nombres). Sin saltos de línea: un título con «\n» se colaba en los correos
 * y en los mensajes de Basecamp como si fueran líneas propias (auditoría 10/10, S5).
 */
export const unaLinea = (min = 1, max = 300) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .regex(/^[^\r\n]*$/, 'No puede tener saltos de línea');
