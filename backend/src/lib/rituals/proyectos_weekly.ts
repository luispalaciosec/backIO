/**
 * El weekly por proyecto (docs/05): el weekly decide y el daily ejecuta, así que la reunión recorre proyectos y baja a la
 * tarea solo cuando hay algo que resolver. El estado sale de las tareas: la fecha de entrega del proyecto no sirve, porque
 * estaba vencida en 21 de los 26 proyectos en marcha de Omega el 4/11/2026.
 */
import type {
  Acuerdo,
  Cliente,
  ClienteWeekly,
  EstadoProyectoWeekly,
  GrupoTareaWeekly,
  ProyectoWeekly,
  ProyectosWeekly,
  RequerimientoMetricas,
  Senal,
  TareaWeekly,
} from '@backio/shared';
import { DIAS_ATRASADA_VIVA } from '../carga';

type Tarea = Pick<
  RequerimientoMetricas,
  | 'id'
  | 'titulo_interno'
  | 'cliente_id'
  | 'proyecto_id'
  | 'owner_agencia'
  | 'fecha_entrega'
  | 'fecha_entrega_original'
  | 'estado_operativo'
  | 'estado_aprobacion'
  | 'dias_atraso'
  | 'dias_sin_movimiento'
  | 'veces_reprogramado'
  | 'basecamp_url'
>;

/** Cada tarea cae en un solo grupo: el que más pide de la reunión. */
export function grupoDeTarea(r: Tarea, hoy: string, finSemana: string): GrupoTareaWeekly {
  if (r.estado_operativo === 'bloqueado') return 'bloqueada';
  if (r.estado_aprobacion === 'pendiente_cliente') return 'espera_cliente';
  if (!r.owner_agencia.length) return 'sin_responsable';
  if (r.dias_atraso > 0) return r.dias_sin_movimiento > DIAS_ATRASADA_VIVA ? 'quieta' : 'atrasada';
  if (r.fecha_entrega && r.fecha_entrega >= hoy && r.fecha_entrega <= finSemana) return 'esta_semana';
  return 'resto';
}

/** Rojo: hay que decidir. Amarillo: hay que confirmar o pedir algo. Verde: va bien y no se discute. */
function estadoDe(c: Record<GrupoTareaWeekly, number>): EstadoProyectoWeekly {
  if (c.bloqueada || c.atrasada) return 'rojo';
  if (c.espera_cliente || c.quieta || c.sin_responsable) return 'amarillo';
  return 'verde';
}

function motivoDe(c: Record<GrupoTareaWeekly, number>): string {
  const partes = [
    c.bloqueada ? (c.bloqueada === 1 ? '1 bloqueada' : `${c.bloqueada} bloqueadas`) : null,
    c.atrasada ? (c.atrasada === 1 ? '1 atrasada' : `${c.atrasada} atrasadas`) : null,
    c.sin_responsable ? `${c.sin_responsable} sin responsable` : null,
    c.espera_cliente ? (c.espera_cliente === 1 ? '1 espera al cliente' : `${c.espera_cliente} esperan al cliente`) : null,
    c.quieta ? `${c.quieta} sin movimiento` : null,
  ].filter(Boolean);
  if (partes.length) return partes.join(' · ');
  return c.esta_semana
    ? c.esta_semana === 1
      ? 'Va bien: 1 sale esta semana'
      : `Va bien: ${c.esta_semana} salen esta semana`
    : 'Va bien: sin entregas esta semana';
}

const r1 = (n: number) => Math.round(n * 10) / 10;
type FilaHorasWeekly = { requerimiento_id: string | null; horas: number; requerimientos: { proyecto_id: string | null } | null };

const PESO: Record<EstadoProyectoWeekly, number> = { rojo: 0, amarillo: 1, verde: 2 };

export function armarProyectosWeekly(e: {
  activos: Tarea[];
  proyectos: { id: string; nombre: string; basecamp_todolist_id?: number | null; avance?: number }[];
  clientes: Pick<Cliente, 'id' | 'nombre' | 'ejecutiva_id' | 'basecamp_project_id'>[];
  senales: Senal[];
  /** Filas del timesheet: todas las del alcance y, aparte, las de esta semana. */
  horas?: { total: FilaHorasWeekly[]; semana: FilaHorasWeekly[] };
  acuerdos: Pick<Acuerdo, 'id' | 'descripcion' | 'responsable_id' | 'fecha_compromiso' | 'proyecto_id' | 'requerimiento_id'>[];
  hoy: string;
  finSemana: string;
  /** Enlace a la lista de Basecamp de un proyecto. */
  urlLista?: (clienteBasecamp: number, lista: number) => string;
}): ProyectosWeekly {
  const { hoy, finSemana } = e;
  const horasTarea = new Map<string, number>();
  for (const h of e.horas?.total ?? [])
    if (h.requerimiento_id) horasTarea.set(h.requerimiento_id, (horasTarea.get(h.requerimiento_id) ?? 0) + Number(h.horas));
  const sumaProyecto = (filas: FilaHorasWeekly[], id: string) =>
    r1(filas.filter((h) => h.requerimientos?.proyecto_id === id).reduce((s, h) => s + Number(h.horas), 0));
  const porTarea = new Map(e.activos.map((r) => [r.id, r]));
  const senalesDeTarea = new Map<string, Senal[]>();
  const senalesDeProyecto = new Map<string, Senal[]>();
  const otras: Senal[] = [];
  const proyectoIds = new Set(e.activos.map((r) => r.proyecto_id));
  for (const s of e.senales) {
    if (s.entidad_tipo === 'requerimiento' && porTarea.has(s.entidad_id))
      senalesDeTarea.set(s.entidad_id, [...(senalesDeTarea.get(s.entidad_id) ?? []), s]);
    else if (s.entidad_tipo === 'proyecto' && proyectoIds.has(s.entidad_id))
      senalesDeProyecto.set(s.entidad_id, [...(senalesDeProyecto.get(s.entidad_id) ?? []), s]);
    else otras.push(s);
  }

  // Tareas por cliente y proyecto. Lo que no tiene proyecto se agrupa aparte en su cliente.
  const grupos = new Map<string, Tarea[]>();
  for (const r of e.activos) {
    const k = `${r.cliente_id}|${r.proyecto_id ?? ''}`;
    grupos.set(k, [...(grupos.get(k) ?? []), r]);
  }
  const clienteDe = new Map(e.clientes.map((c) => [c.id, c]));
  const proyectoDe = new Map(e.proyectos.map((p) => [p.id, p]));
  const porCliente = new Map<string, ProyectoWeekly[]>();
  for (const [k, tareasDelGrupo] of grupos) {
    const [clienteId, proyectoId] = k.split('|') as [string, string];
    const conteo: Record<GrupoTareaWeekly, number> = {
      bloqueada: 0,
      atrasada: 0,
      sin_responsable: 0,
      espera_cliente: 0,
      quieta: 0,
      esta_semana: 0,
      resto: 0,
    };
    const tareas: TareaWeekly[] = tareasDelGrupo.map((r) => {
      const grupo = grupoDeTarea(r, hoy, finSemana);
      conteo[grupo] += 1;
      return {
        id: r.id,
        titulo: r.titulo_interno,
        grupo,
        owners: r.owner_agencia,
        fecha_entrega: r.fecha_entrega,
        fecha_original: r.fecha_entrega_original,
        dias_atraso: r.dias_atraso,
        dias_sin_movimiento: r.dias_sin_movimiento,
        veces_reprogramado: r.veces_reprogramado,
        basecamp_url: r.basecamp_url,
        horas: r1(horasTarea.get(r.id) ?? 0),
        senales: senalesDeTarea.get(r.id) ?? [],
      };
    });
    const orden: GrupoTareaWeekly[] = ['bloqueada', 'atrasada', 'sin_responsable', 'espera_cliente', 'quieta', 'esta_semana', 'resto'];
    tareas.sort(
      (a, b) =>
        orden.indexOf(a.grupo) - orden.indexOf(b.grupo) ||
        b.dias_atraso - a.dias_atraso ||
        (a.fecha_entrega ?? '9999').localeCompare(b.fecha_entrega ?? '9999'),
    );
    const cuenta = new Map<string, number>();
    for (const r of tareasDelGrupo) for (const o of r.owner_agencia) cuenta.set(o, (cuenta.get(o) ?? 0) + 1);
    const p = proyectoId ? proyectoDe.get(proyectoId) : undefined;
    const cl = clienteDe.get(clienteId);
    const proximas = tareasDelGrupo.flatMap((r) => (r.fecha_entrega && r.fecha_entrega >= hoy ? [r.fecha_entrega] : [])).sort();
    const senales = [...tareas.flatMap((t) => t.senales), ...(proyectoId ? (senalesDeProyecto.get(proyectoId) ?? []) : [])];
    const ids = new Set(tareasDelGrupo.map((r) => r.id));
    const fila: ProyectoWeekly = {
      proyecto_id: proyectoId || null,
      nombre: p?.nombre ?? 'Sin proyecto',
      cliente_id: clienteId,
      estado: estadoDe(conteo),
      motivo: motivoDe(conteo),
      conteo,
      abiertas: tareasDelGrupo.length,
      proxima_entrega: proximas[0] ?? null,
      // Sin proyecto no hay historia a la cual sumar: cuentan solo sus tareas abiertas.
      horas: proyectoId
        ? { total: sumaProyecto(e.horas?.total ?? [], proyectoId), semana: sumaProyecto(e.horas?.semana ?? [], proyectoId) }
        : {
            total: r1(tareas.reduce((s, t) => s + t.horas, 0)),
            semana: r1(
              (e.horas?.semana ?? [])
                .filter((h) => !!h.requerimiento_id && ids.has(h.requerimiento_id))
                .reduce((s, h) => s + Number(h.horas), 0),
            ),
          },
      avance: p?.avance ?? null,
      atraso_maximo: Math.max(0, ...tareasDelGrupo.map((r) => r.dias_atraso)),
      responsables: [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id),
      carga: [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([usuario_id, tareas]) => ({ usuario_id, tareas })),
      senales_por_atender: senales.filter((s) => !s.atendida).length,
      senales_de_proyecto: proyectoId ? (senalesDeProyecto.get(proyectoId) ?? []) : [],
      acuerdos: e.acuerdos.filter(
        (a) => (!!proyectoId && a.proyecto_id === proyectoId) || (!!a.requerimiento_id && ids.has(a.requerimiento_id)),
      ),
      basecamp_url:
        p?.basecamp_todolist_id && cl?.basecamp_project_id && e.urlLista
          ? e.urlLista(cl.basecamp_project_id, p.basecamp_todolist_id)
          : null,
      tareas,
    };
    porCliente.set(clienteId, [...(porCliente.get(clienteId) ?? []), fila]);
  }

  const clientes: ClienteWeekly[] = [...porCliente.entries()].map(([id, proyectos]) => ({
    cliente_id: id,
    nombre: clienteDe.get(id)?.nombre ?? 'Cliente',
    ejecutiva_id: clienteDe.get(id)?.ejecutiva_id ?? null,
    proyectos: proyectos.sort(
      (a, b) =>
        PESO[a.estado] - PESO[b.estado] ||
        b.conteo.bloqueada + b.conteo.atrasada - (a.conteo.bloqueada + a.conteo.atrasada) ||
        a.nombre.localeCompare(b.nombre, 'es'),
    ),
  }));
  const cuantos = (c: ClienteWeekly, x: EstadoProyectoWeekly) => c.proyectos.filter((p) => p.estado === x).length;
  clientes.sort(
    (a, b) =>
      cuantos(b, 'rojo') - cuantos(a, 'rojo') || cuantos(b, 'amarillo') - cuantos(a, 'amarillo') || a.nombre.localeCompare(b.nombre, 'es'),
  );
  const todos = clientes.flatMap((c) => c.proyectos);
  return {
    clientes,
    resumen: {
      rojo: todos.filter((p) => p.estado === 'rojo').length,
      amarillo: todos.filter((p) => p.estado === 'amarillo').length,
      verde: todos.filter((p) => p.estado === 'verde').length,
    },
    otras_senales: otras,
  };
}
