/**
 * Salud de un cliente: una sola regla para el dashboard y la ficha del cliente, para que nunca digan cosas distintas.
 * Mira la operación (atrasos, movimiento) y la calidad de las entregas de los últimos 90 días (a tiempo según la fecha
 * original y reprocesos atribuibles a Geeks). Devuelve el color y el porqué.
 */
import { MOTIVOS_REPROCESO, type Reproceso } from './types';
import { diaLocal } from './fechas';

export type Salud = 'verde' | 'amarillo' | 'rojo';

/** Ventana de las métricas de entrega que usa la salud. */
export const SALUD_DIAS_ENTREGAS = 90;

/**
 * Desde cuándo se mide el % a tiempo de la salud: el trabajo pedido desde que se opera en BackIO (el evolutivo también
 * arranca el 21/09/2026). Lo pedido antes es historia importada de Basecamp: en septiembre se cerraron en bloque cientos
 * de to-dos viejos con meses de atraso y el % a tiempo no medía el trabajo actual (decisión de Luis, 29/10/2026).
 */
export const INICIO_MEDICION = '2026-09-21';

/** ¿La tarea es trabajo pedido desde que se opera en BackIO? Lo importado trae `fecha_pedido` = creación en Basecamp. */
export function esTrabajoMedido(r: { fecha_pedido?: string | null; created_at: string }): boolean {
  return (r.fecha_pedido ?? diaLocal(r.created_at)) >= INICIO_MEDICION;
}

export const UMBRALES_SALUD = {
  rojo: { atrasados: 2, atraso_dias: 30, sin_movimiento_dias: 14, pct_a_tiempo: 60 },
  amarillo: { sin_movimiento_dias: 7, pct_a_tiempo: 80, pct_reprocesos: 20 },
  /** Con menos entregas que esto en la ventana, el % a tiempo y los reprocesos no deciden el color. */
  entregas_minimas: 5,
} as const;

export interface DatosSalud {
  atrasados: number;
  /** Días de atraso de la tarea más atrasada. */
  atraso_max: number;
  sin_movimiento_max: number;
  /** Entregas medidas (completadas en los últimos SALUD_DIAS_ENTREGAS días y pedidas desde INICIO_MEDICION). */
  entregas: number;
  pct_a_tiempo: number | null;
  /** Reprocesos atribuibles a Geeks (no al cliente) en la misma ventana. */
  reprocesos_equipo: number;
}

export function saludCliente(d: DatosSalud): { salud: Salud; motivos: string[] } {
  const U = UMBRALES_SALUD;
  const conEntregas = d.entregas >= U.entregas_minimas;
  const pctReprocesos = d.entregas ? Math.round((d.reprocesos_equipo / d.entregas) * 100) : 0;
  const rojo: string[] = [];
  if (d.atrasados > U.rojo.atrasados) rojo.push(`${d.atrasados} tareas atrasadas`);
  if (d.atraso_max > U.rojo.atraso_dias) rojo.push(`una tarea con ${d.atraso_max} días de atraso`);
  if (d.sin_movimiento_max > U.rojo.sin_movimiento_dias) rojo.push(`${d.sin_movimiento_max} días sin movimiento`);
  if (conEntregas && d.pct_a_tiempo !== null && d.pct_a_tiempo < U.rojo.pct_a_tiempo) rojo.push(`${d.pct_a_tiempo} % a tiempo`);
  if (rojo.length) return { salud: 'rojo', motivos: rojo };
  const amarillo: string[] = [];
  if (d.atrasados > 0) amarillo.push(d.atrasados === 1 ? '1 tarea atrasada' : `${d.atrasados} tareas atrasadas`);
  if (d.sin_movimiento_max > U.amarillo.sin_movimiento_dias) amarillo.push(`${d.sin_movimiento_max} días sin movimiento`);
  if (conEntregas && d.pct_a_tiempo !== null && d.pct_a_tiempo < U.amarillo.pct_a_tiempo) amarillo.push(`${d.pct_a_tiempo} % a tiempo`);
  if (conEntregas && pctReprocesos > U.amarillo.pct_reprocesos) amarillo.push(`reprocesos en el ${pctReprocesos} % de las entregas`);
  return amarillo.length ? { salud: 'amarillo', motivos: amarillo } : { salud: 'verde', motivos: [] };
}

/**
 * Reproceso atribuible a Geeks: marcado como del equipo, o sin marca y con un motivo que no es del cliente. Sin motivo
 * no se sabe: no cuenta.
 */
export function reprocesoDelEquipo(r: Pick<Reproceso, 'motivo' | 'atribuible'>): boolean {
  if (r.atribuible) return r.atribuible === 'equipo';
  const resp = MOTIVOS_REPROCESO.find((m) => m.valor === r.motivo)?.responsable;
  return !!resp && resp !== 'cliente';
}
