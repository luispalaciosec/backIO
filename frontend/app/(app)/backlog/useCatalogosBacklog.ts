'use client';
/** Catálogos del backlog: clientes, personas, proyectos, mesas, horas y últimas notas. Los fallos se avisan (useAvisosCarga). */
import { useEffect, useState } from 'react';
import type { Cliente, Usuario, Mesa, Bitacora } from '@backio/shared';
import { api } from '@/lib/api';

export type ProyectoDeCliente = { id: string; nombre: string; basecamp: boolean; completado: boolean };

export function useCatalogosBacklog(avisar: (que: string) => (e: unknown) => void) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [horas, setHoras] = useState<Record<string, number>>({});
  const [notas, setNotas] = useState<Record<string, Bitacora>>({});
  const [proyectos, setProyectos] = useState<Record<string, string>>({});
  const [proyectosCliente, setProyectosCliente] = useState<Record<string, { id: string; nombre: string; basecamp: boolean; completado: boolean }[]>>({});
  const [proyectoMesa, setProyectoMesa] = useState<Record<string, string | null>>({});
  const [mesas, setMesas] = useState<Mesa[]>([]);
  useEffect(() => {
    api<{ items: Cliente[] }>('/clientes').then((r) => setClientes(r.items)).catch(avisar('los clientes'));
    api<{ items: Usuario[] }>('/usuarios').then((r) => setUsuarios(r.items)).catch(avisar('las personas'));
    api<{ items: { id: string; nombre: string; mesa_id: string | null; cliente_id: string; estado: string; basecamp_todolist_id: number | null }[] }>('/proyectos').then((r) => {
      setProyectos(Object.fromEntries(r.items.map((p) => [p.id, p.nombre]))); setProyectoMesa(Object.fromEntries(r.items.map((p) => [p.id, p.mesa_id])));
      // También los proyectos completados: una campaña cerrada puede recibir una tarea nueva (se reabre sola).
      const pc: Record<string, { id: string; nombre: string; basecamp: boolean; completado: boolean }[]> = {};
      const orden = (x: { estado: string; nombre: string }) => `${x.estado === 'completado' ? 1 : 0}${x.nombre.toLowerCase()}`;
      for (const p of r.items.filter((x) => x.estado !== 'cancelado').sort((a, b) => orden(a).localeCompare(orden(b), 'es'))) (pc[p.cliente_id] ??= []).push({ id: p.id, nombre: p.nombre, basecamp: !!p.basecamp_todolist_id, completado: p.estado === 'completado' });
      setProyectosCliente(pc);
    }).catch(avisar('los proyectos'));
    api<{ items: Mesa[] }>('/mesas').then((r) => setMesas(r.items.filter((m) => m.activa))).catch(avisar('las mesas'));
    api<{ por_requerimiento: Record<string, number> }>('/horas/resumen?dias=90').then((r) => setHoras(r.por_requerimiento)).catch(avisar('las horas'));
    api<{ items: Record<string, Bitacora> }>('/requerimientos/bitacora/ultimas').then((r) => setNotas(r.items)).catch(avisar('las últimas notas'));
  }, [avisar]);
  return { clientes, usuarios, horas, notas, setNotas, proyectos, proyectosCliente, proyectoMesa, mesas };
}
