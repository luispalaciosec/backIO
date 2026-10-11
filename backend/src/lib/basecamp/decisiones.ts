/**
 * Decisiones de la importación de Basecamp, sin E/S para poder probarlas (auditoría 10/10, B6 y Fase 5).
 */
import { diaLocal, sumarDias } from '@backio/shared';
import { ownersDeBasecamp, type TodoPlano } from './recorrer';

/** Prefijos en el título del to-do que fijan clase y proactividad al importarlo. null si no hay ninguno. */
export function marcasDeTitulo(titulo: string | null | undefined): { clase?: 'propuesta' | 'incidencia'; proactiva?: true } | null {
  const t = (titulo ?? '').toUpperCase();
  const out: { clase?: 'propuesta' | 'incidencia'; proactiva?: true } = {};
  if (/\[\s*PROPUESTA\s*\]/.test(t)) out.clase = 'propuesta';
  if (/\[\s*INCIDENCIA\s*\]/.test(t)) out.clase = 'incidencia';
  if (/\[\s*PROACTIVA\s*\]/.test(t)) out.proactiva = true;
  return Object.keys(out).length ? out : null;
}

export interface Enlazado {
  id: string;
  basecamp_todo_id: number;
  owner_agencia: string[];
  titulo_interno: string;
  bloque_nombre: string | null;
  proyecto_id: string | null;
  estado_operativo: string;
}

export type Clasificacion = 'enlazado' | 'nuevo' | 'ignorado' | 'completado_viejo';

/** Qué hacer con un to-do: ya enlazado, nuevo, descartado a mano como huérfano, o completado hace demasiado. */
export function clasificarTodo(
  t: TodoPlano,
  o: { enlazados: Set<number>; ignorados: Set<number>; limiteCompletadosMs: number },
): Clasificacion {
  if (o.enlazados.has(t.id)) return 'enlazado';
  if (o.ignorados.has(t.id)) return 'ignorado';
  if (t.completed && t.completed_at && new Date(t.completed_at).getTime() < o.limiteCompletadosMs) return 'completado_viejo';
  return 'nuevo';
}

/** Cambios que Basecamp manda sobre un requerimiento ya enlazado: título (D1), grupo, lista y responsables. */
export function cambiosDeEnlazado(
  ex: Enlazado,
  t: TodoPlano,
  destino: { proyectoId: string | null; listaId: number },
  porBcUser: Map<number, string>,
): { patch: Record<string, unknown>; titulo: boolean; movido: boolean; responsables: boolean } {
  const patch: Record<string, unknown> = {};
  const titulo = !!t.titulo && t.titulo !== ex.titulo_interno;
  if (titulo) patch.titulo_interno = t.titulo;
  if ((t.bloque ?? null) !== (ex.bloque_nombre ?? null)) patch.bloque_nombre = t.bloque;
  const movido = !!destino.proyectoId && ex.proyecto_id !== destino.proyectoId;
  if (movido) {
    patch.proyecto_id = destino.proyectoId;
    patch.basecamp_todolist_id = t.grupoId ?? destino.listaId;
  }
  // Solo si Basecamp tiene asignados con usuario en BackIO: un to-do sin asignar no borra los responsables de BackIO.
  const owners = ownersDeBasecamp(t.assignee_ids, porBcUser);
  const igual = owners.length === ex.owner_agencia.length && owners.every((o) => ex.owner_agencia.includes(o));
  const responsables = owners.length > 0 && !igual;
  if (responsables) patch.owner_agencia = owners;
  return { patch, titulo, movido, responsables };
}

/** Fechas del proyecto que nace de una lista: del primer al último vencimiento (o 30 días desde hoy). */
export function fechasProyectoNuevo(todos: Pick<TodoPlano, 'due_on'>[], hoy: string): { inicio: string; entrega: string } {
  const fechas = todos
    .map((t) => t.due_on)
    .filter((d): d is string => !!d)
    .sort();
  const entrega = fechas[fechas.length - 1] ?? sumarDias(hoy, 30);
  const inicio = fechas[0] && fechas[0] < entrega ? fechas[0] : hoy < entrega ? hoy : entrega;
  return { inicio, entrega };
}

/**
 * Fila de un requerimiento nuevo desde un to-do, con su enlace a Basecamp en la misma inserción (B6: antes se
 * insertaba y después se enlazaba, y en ese hueco el webhook y el cron podían crear la misma tarea dos veces).
 * D1: entra el título, nunca visible al cliente.
 */
export function filaDesdeTodo(t: TodoPlano, o: { clienteId: string; proyectoId: string; listaId: number; porBcUser: Map<number, string> }) {
  return {
    cliente_id: o.clienteId,
    proyecto_id: o.proyectoId,
    bloque_nombre: t.bloque,
    titulo_interno: t.titulo || `To-do ${t.id}`,
    etiqueta_cliente: null,
    visible_cliente: false as const,
    tipo_trabajo: 'fee' as const,
    estado_operativo: t.completed ? ('completado' as const) : t.due_on ? ('priorizado' as const) : ('backlog' as const),
    prioridad: 'media' as const,
    peso: 1,
    fecha_pedido: t.created_at ? diaLocal(t.created_at) : null,
    fecha_entrega: t.due_on,
    owner_agencia: ownersDeBasecamp(t.assignee_ids, o.porBcUser),
    piezas: 0,
    basecamp_todo_id: t.id,
    basecamp_todolist_id: t.grupoId ?? o.listaId,
    basecamp_url: t.app_url,
    completado_at: t.completed ? t.completed_at : null,
    // Convenciones de título para KPIs (docs/19): [PROPUESTA], [INCIDENCIA], [PROACTIVA]. El título no se toca.
    ...(marcasDeTitulo(t.titulo) ?? {}),
  };
}
export type FilaDesdeTodo = ReturnType<typeof filaDesdeTodo>;
