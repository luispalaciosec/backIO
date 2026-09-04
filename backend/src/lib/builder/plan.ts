/**
 * Builder de proyectos · lógica pura (docs/03-builder.md)
 *  - Redistribución proporcional de pesos al desmarcar bloques opcionales.
 *  - Peso absoluto por tarea = peso_bloque × (peso_relativo / Σ peso_relativo del bloque).
 *  - Fechas calculadas HACIA ATRÁS desde fecha_entrega usando dias_offset.
 *  - Alerta de concentración de carga (>30% de tareas de una semana en un owner).
 */
import type { PlantillaArbol, BloqueAlcanceInput, TipoPieza } from '@backio/shared';

export interface TareaPlanificada {
  plantilla_tarea_id: string;
  bloque_id: string;
  bloque_nombre: string;
  titulo_interno: string;
  etiqueta_cliente: string | null;
  visible_cliente: boolean;
  peso: number; // absoluto sobre 100
  fecha_entrega: string; // YYYY-MM-DD
  owner_agencia: string[];
  piezas: number;
  rol_sugerido: string | null;
  tipo_pieza_id?: string | null;
  aprobacion_cliente?: boolean;
}

export interface AlertaCapacidad {
  owner_id: string;
  semana_inicio: string;
  tareas: number;
  total: number;
  pct: number;
}

export interface PlanProyecto {
  tareas: TareaPlanificada[];
  bloques_activos: { id: string; nombre: string; peso: number }[];
  alertas: AlertaCapacidad[];
  visibles: number;
}

export interface PlanInput {
  plantilla: PlantillaArbol;
  fecha_entrega: string;
  bloques: BloqueAlcanceInput[];
  umbral_concentracion_pct?: number;
  tiposPieza?: TipoPieza[];
}

export function redistribuirPesos(bloques: { id: string; peso: number }[], activosIds: Set<string>): Map<string, number> {
  const activos = bloques.filter((b) => activosIds.has(b.id));
  const suma = activos.reduce((s, b) => s + b.peso, 0);
  const out = new Map<string, number>();
  if (suma === 0) return out;
  for (const b of activos) out.set(b.id, round2((b.peso / suma) * 100));
  // Corrige residuo de redondeo para que sume exactamente 100
  const total = [...out.values()].reduce((s, v) => s + v, 0);
  const diff = round2(100 - total);
  if (diff !== 0 && activos.length > 0) {
    const ultimo = activos[activos.length - 1]!.id;
    out.set(ultimo, round2((out.get(ultimo) ?? 0) + diff));
  }
  return out;
}

export function restarDias(fechaISO: string, dias: number): string {
  const d = new Date(`${fechaISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

export function lunesDe(fechaISO: string): string {
  const d = new Date(`${fechaISO}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0 domingo
  const diff = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

export function planificarProyecto(input: PlanInput): PlanProyecto {
  const { plantilla, fecha_entrega, bloques } = input;
  const umbral = input.umbral_concentracion_pct ?? 30;

  const config = new Map(bloques.map((b) => [b.bloque_id, b]));
  const activosIds = new Set(
    plantilla.bloques.filter((b) => (config.get(b.id)?.activo ?? true) || !b.opcional).map((b) => b.id),
  );
  const pesos = redistribuirPesos(plantilla.bloques, activosIds);

  const tareas: TareaPlanificada[] = [];
  for (const bloque of plantilla.bloques) {
    if (!activosIds.has(bloque.id)) continue;
    const cfg = config.get(bloque.id);
    const pesoBloque = pesos.get(bloque.id) ?? 0;
    const piezasBloque = Object.values(cfg?.piezas_por_canal ?? {}).reduce((s, n) => s + (n || 0), 0);

    // Lotes de piezas de este bloque: (tipo, cantidad). Peso relativo del lote = esfuerzo × cantidad.
    const lotes = Object.entries(cfg?.piezas_por_tipo ?? {})
      .map(([tipoId, n]) => ({ tipo: (input.tiposPieza ?? []).find((t) => t.id === tipoId), n: Number(n) || 0 }))
      .filter((l): l is { tipo: TipoPieza; n: number } => !!l.tipo && l.n > 0);
    const pesoLotes = lotes.reduce((s, l) => s + l.tipo.esfuerzo * l.n, 0);
    const sumaRel = bloque.tareas.reduce((s, t) => s + t.peso_relativo, 0) + pesoLotes || 1;

    for (const t of bloque.tareas) {
      tareas.push({
        plantilla_tarea_id: t.id,
        bloque_id: bloque.id,
        bloque_nombre: bloque.nombre,
        titulo_interno: t.titulo_interno,
        etiqueta_cliente: t.etiqueta_cliente,
        visible_cliente: t.visible_cliente_default && !!t.etiqueta_cliente,
        peso: round3(pesoBloque * (t.peso_relativo / sumaRel)),
        fecha_entrega: restarDias(fecha_entrega, t.dias_offset),
        owner_agencia: cfg?.owner_id ? [cfg.owner_id] : [],
        piezas: lotes.length ? 0 : piezasBloque,
        rol_sugerido: t.rol_sugerido,
      });
    }

    // Expansión: un to-do por paso del flujo del tipo, por lote (o por pieza si se pide).
    for (const { tipo, n } of lotes) {
      const pesoLote = pesoBloque * ((tipo.esfuerzo * n) / sumaRel);
      const sumaPasos = tipo.pasos.reduce((s, p) => s + p.peso, 0) || 1;
      const unidades = cfg?.una_tarea_por_pieza ? Array.from({ length: n }, (_, i) => ({ sufijo: ` ${i + 1}/${n}`, piezas: 1, factor: 1 / n })) : [{ sufijo: ` (${n})`, piezas: n, factor: 1 }];
      for (const u of unidades) {
        for (const paso of tipo.pasos) {
          const visible = paso.visible === true;
          tareas.push({
            plantilla_tarea_id: null as unknown as string,
            bloque_id: bloque.id,
            bloque_nombre: bloque.nombre,
            titulo_interno: `${paso.titulo} · ${tipo.nombre}${u.sufijo}`,
            etiqueta_cliente: visible ? `${paso.etiqueta ?? paso.titulo} · ${tipo.nombre}${u.sufijo}` : null,
            visible_cliente: visible,
            peso: round3(pesoLote * u.factor * (paso.peso / sumaPasos)),
            fecha_entrega: restarDias(fecha_entrega, paso.dias_offset),
            owner_agencia: cfg?.owner_id ? [cfg.owner_id] : [],
            piezas: u.piezas,
            rol_sugerido: paso.rol ?? null,
            tipo_pieza_id: tipo.id,
            aprobacion_cliente: paso.aprobacion_cliente === true,
          });
        }
      }
    }
  }

  return {
    tareas,
    bloques_activos: plantilla.bloques
      .filter((b) => activosIds.has(b.id))
      .map((b) => ({ id: b.id, nombre: b.nombre, peso: pesos.get(b.id) ?? 0 })),
    alertas: detectarConcentracion(tareas, umbral),
    visibles: tareas.filter((t) => t.visible_cliente).length,
  };
}

export function detectarConcentracion(
  tareas: { fecha_entrega: string; owner_agencia: string[] }[],
  umbralPct = 30,
): AlertaCapacidad[] {
  const porSemana = new Map<string, { total: number; porOwner: Map<string, number> }>();
  for (const t of tareas) {
    const semana = lunesDe(t.fecha_entrega);
    const entry = porSemana.get(semana) ?? { total: 0, porOwner: new Map() };
    entry.total += 1;
    const owner = t.owner_agencia[0];
    if (owner) entry.porOwner.set(owner, (entry.porOwner.get(owner) ?? 0) + 1);
    porSemana.set(semana, entry);
  }
  const alertas: AlertaCapacidad[] = [];
  for (const [semana, { total, porOwner }] of porSemana) {
    if (total < 3) continue; // con 1-2 tareas la concentración no significa nada
    for (const [owner, n] of porOwner) {
      const pct = Math.round((n / total) * 100);
      if (pct > umbralPct) alertas.push({ owner_id: owner, semana_inicio: semana, tareas: n, total, pct });
    }
  }
  return alertas.sort((a, b) => b.pct - a.pct);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
