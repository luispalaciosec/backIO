'use client';
/**
 * KPIs por equipo y por persona (docs/19-kpis.md). Componentes compartidos por /kpis y el modal de Personas.
 */
// Reexporta las piezas del tablero de KPIs (antes un solo archivo de 293 líneas; auditoría 10/10, Ola 7).
export { pct, mesActual, moverMes, nombreMes, EstadoKpi, type Seleccion } from './comun';
export { VistaEquipo } from './VistaEquipo';
export { FichaPersona } from './FichaPersona';
export { DetalleKpi } from './DetalleKpi';
export { useTableroKpis } from './useTableroKpis';
