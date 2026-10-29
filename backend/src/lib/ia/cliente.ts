/**
 * Sugerencias de la IA en la ficha del cliente (docs/21). Pantalla interna: la IA lee los números de la ficha y los
 * títulos internos de lo atrasado y de las señales, y propone qué hacer. No cambia nada ni escribe a nadie (docs/15).
 */
import type { FichaCliente, SugerenciaCliente } from '@backio/shared';
import type { DbCtx } from '../db/client';
import { generarJson } from './index';

const SYSTEM_SUGERENCIAS = `Eres el apoyo de la ejecutiva de cuenta de una agencia creativa. Recibes la ficha de un cliente: salud,
indicadores de entrega (90 días), evolución mensual, proyectos, tareas atrasadas, esperando al cliente, bloqueadas,
sin movimiento y señales de la semana.
Propón de 3 a 5 acciones concretas para mejorar la cuenta esta semana. Cada una:
- "titulo": la acción en pocas palabras.
- "dato": el número o la tarea de la ficha que la justifica, tal como aparece (por ejemplo «4 tareas atrasadas», «62 % a tiempo»).
- "accion": qué hacer y quién (la ejecutiva, el líder de la mesa o el responsable de la tarea, con su nombre si está en los datos).
Prioriza lo que más pesa en la salud. Si la cuenta está sana, dilo en una sola sugerencia y propone cómo mantenerla.
No atribuyas causas que no estén en los datos. No propongas cosas fuera de la operación (precios, contratos, personal).
Formato: {"sugerencias":[{"titulo":"…","dato":"…","accion":"…"}]}`;

export async function sugerenciasCliente(ctx: DbCtx, f: FichaCliente): Promise<SugerenciaCliente[]> {
  const t = (x: FichaCliente['tareas']['atrasadas'][number]) => ({
    tarea: x.titulo_interno,
    proyecto: x.proyecto,
    responsables: x.responsables,
    fecha: x.fecha_entrega,
    dias_atraso: x.dias_atraso || undefined,
    dias_sin_movimiento: x.dias_sin_movimiento,
  });
  const payload = {
    cliente: f.cliente.nombre,
    ejecutiva: f.ejecutiva?.nombre ?? null,
    mesa: f.mesa?.nombre ?? null,
    lider_mesa: f.mesa?.lider?.nombre ?? null,
    salud: f.salud,
    indicadores: f.indicadores,
    mensual: f.mensual,
    proyectos_en_curso: f.proyectos
      .filter((p) => !['completado', 'cancelado'].includes(p.estado))
      .map((p) => ({ nombre: p.nombre, avance: p.avance, activos: p.activos, atrasados: p.atrasados, horas_30d: p.horas_30d })),
    atrasadas: f.tareas.atrasadas.slice(0, 10).map(t),
    esperando_cliente: f.tareas.esperando_cliente.slice(0, 10).map(t),
    bloqueadas: f.tareas.bloqueadas.slice(0, 10).map(t),
    sin_movimiento: f.tareas.sin_movimiento.slice(0, 10).map(t),
    senales: f.senales.map((s) => ({ severidad: s.severidad, tipo: s.tipo, titulo: s.titulo, atendida: s.atendida })),
  };
  const r = await generarJson<{ sugerencias?: SugerenciaCliente[] }>(ctx, {
    tipo: 'sugerencias_cliente',
    entidad: { tipo: 'cliente', id: f.cliente.id },
    payload,
    system: SYSTEM_SUGERENCIAS,
    maxTokens: 900,
    cacheMs: 6 * 3_600_000,
  });
  return (r.sugerencias ?? [])
    .filter((s) => s && typeof s.titulo === 'string' && typeof s.accion === 'string')
    .slice(0, 5)
    .map((s) => ({ titulo: s.titulo, dato: typeof s.dato === 'string' ? s.dato : '', accion: s.accion }));
}
