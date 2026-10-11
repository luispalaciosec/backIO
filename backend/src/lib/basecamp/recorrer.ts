/**
 * Recorrido de los to-dos de un proyecto Basecamp (listas y grupos) y mapa de usuarios Basecamp → BackIO.
 * Lo comparten la importación y el detector de huérfanos (antes cada uno tenía su copia).
 */
import type { BasecampClient } from './client';

export type TodoBasecamp = Awaited<ReturnType<BasecampClient['listTodosSafe']>>[number];
export interface TodoPlano extends TodoBasecamp {
  /** Nombre del grupo (bloque en BackIO); null si está suelto en la lista. */
  bloque: string | null;
  grupoId: number | null;
}
export interface ListaRecorrida {
  lista: { id: number; name: string };
  grupos: { id: number; name: string }[];
  todos: TodoPlano[];
}

export async function recorrerTodos(
  bc: BasecampClient,
  projectId: number,
  incluirCompletados = true,
): Promise<{ todosetId: number; listas: ListaRecorrida[] }> {
  const todosetId = await bc.getTodosetId(projectId);
  const listas: ListaRecorrida[] = [];
  for (const lista of await bc.listTodolists(projectId, todosetId)) {
    const grupos = await bc.listGroups(projectId, lista.id);
    const todos: TodoPlano[] = [];
    for (const t of await bc.listTodosSafe(projectId, lista.id, incluirCompletados)) todos.push({ ...t, bloque: null, grupoId: null });
    for (const g of grupos)
      for (const t of await bc.listTodosSafe(projectId, g.id, incluirCompletados)) todos.push({ ...t, bloque: g.name, grupoId: g.id });
    listas.push({ lista, grupos, todos });
  }
  return { todosetId, listas };
}

export function mapaUsuariosBasecamp(usuarios: { id: string; basecamp_user_id: number | null }[]): Map<number, string> {
  return new Map(usuarios.filter((u) => u.basecamp_user_id).map((u) => [u.basecamp_user_id as number, u.id]));
}

/** Responsables en BackIO de los asignados en Basecamp (los que no tienen usuario vinculado se omiten). */
export const ownersDeBasecamp = (assigneeIds: number[], mapa: Map<number, string>): string[] =>
  assigneeIds.map((id) => mapa.get(id)).filter((x): x is string => !!x);
