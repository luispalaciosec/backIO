/**
 * Plan de la semana (docs/05): qué hacer con lo que no entra en las horas de cada persona. Las reglas deciden; nada cambia
 * sin un clic. Solo se propone reasignar a quien ya trabaja con ese cliente y tiene horas libres: repartir a cualquiera
 * mandaría tareas a personas que no producen (gerencia, administración) o que no conocen la cuenta. Si nadie puede, lo que
 * queda es renegociar la fecha.
 */
import type { CargaPersona } from '../carga';

export interface SugerenciaReparto {
  tarea_id: string;
  titulo: string;
  cliente_id: string;
  fecha_entrega: string;
  horas: number;
  de_id: string;
  de: string;
  /** Con quién: null = nadie con horas conoce la cuenta y hay que renegociar la fecha. */
  a_id: string | null;
  a: string | null;
  horas_libres_a: number | null;
  /** Desde cuándo se propone renegociar: la semana siguiente. */
  fecha_sugerida: string | null;
}

export function sugerirReparto(carga: CargaPersona[], opts: { soloClientes?: Set<string>; fechaRenegociar: string }): SugerenciaReparto[] {
  const libres = new Map(carga.map((p) => [p.usuario_id, p.capacidad_restante - p.horas]));
  const out: SugerenciaReparto[] = [];
  const enRiesgo = carga
    .flatMap((p) => p.en_riesgo.map((t) => ({ t, p })))
    .filter(({ t }) => !opts.soloClientes || opts.soloClientes.has(t.cliente_id))
    .sort((a, b) => a.t.fecha_entrega.localeCompare(b.t.fecha_entrega) || b.t.horas - a.t.horas);
  for (const { t, p } of enRiesgo) {
    const candidata = carga
      .filter(
        (c) =>
          c.usuario_id !== p.usuario_id &&
          c.tareas.some((x) => x.cliente_id === t.cliente_id) &&
          !c.tareas.some((x) => x.id === t.id) &&
          (libres.get(c.usuario_id) ?? 0) >= t.horas,
      )
      .sort((a, b) => (libres.get(b.usuario_id) ?? 0) - (libres.get(a.usuario_id) ?? 0))[0];
    if (candidata) libres.set(candidata.usuario_id, (libres.get(candidata.usuario_id) ?? 0) - t.horas);
    out.push({
      tarea_id: t.id,
      titulo: t.titulo,
      cliente_id: t.cliente_id,
      fecha_entrega: t.fecha_entrega,
      horas: t.horas,
      de_id: p.usuario_id,
      de: p.nombre,
      a_id: candidata?.usuario_id ?? null,
      a: candidata?.nombre ?? null,
      horas_libres_a: candidata ? Math.round((libres.get(candidata.usuario_id) ?? 0) + t.horas) : null,
      fecha_sugerida: candidata ? null : opts.fechaRenegociar,
    });
  }
  return out;
}
