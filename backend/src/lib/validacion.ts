/** Esquemas zod reutilizables para entradas de texto. */
import { z } from 'zod';
import { zValidator as zValidatorHono } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';

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

/**
 * zValidator con la respuesta de error de BackIO (auditoría 10/10, B3). El de @hono/zod-validator devuelve el
 * ZodError entero en `error` (un objeto): el frontend mostraba «[object Object]». Aquí `error` es siempre un texto que
 * nombra los campos («Revisa: fecha_entrega, piezas») y el detalle va aparte.
 */
export const zValidator = <T extends z.ZodTypeAny, Target extends keyof ValidationTargets>(target: Target, schema: T) =>
  zValidatorHono(target, schema, (r, c) => {
    if (r.success) return;
    const campos = [...new Set(r.error.issues.map((i) => i.path.join('.') || target))];
    return c.json(
      { error: `Revisa: ${campos.join(', ')}`, detalle: r.error.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })) },
      400,
    );
  });
