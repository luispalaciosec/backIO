/**
 * Rentabilidad por cliente (docs/21, migración 41). Solo gerencia y admin.
 *
 * Margen del mes = fee mensual del cliente − su costo. El costo es el sueldo de cada persona repartido entre sus clientes
 * según las horas que registró ese mes en el timesheet. No es horas × costo por hora: el timesheet recoge ~13 h de las
 * 40 h de la semana, y así quedaban fuera dos tercios de los sueldos (revisión del 30/10/2026). Los sueldos de quien no
 * registró horas en el mes no se pueden repartir y se muestran aparte.
 */
import type { CostoPersonal, FeeCliente, RentabilidadCliente, RentabilidadMes, Usuario } from '@backio/shared';
import { nombrePersona } from '@backio/shared';
import type { DbCtx } from './db/client';
import { listCostosPersonal, listFeesCliente } from './db/costos';
import { listHorasEntre } from './db/horas';
import { listUsuarios } from './db/usuarios';
import { idsClientesDePrueba, listClientes } from './db/clientes';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Primer y último día de un mes YYYY-MM. */
export function rangoMes(mes: string): { desde: string; hasta: string } {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  return { desde: `${mes}-01`, hasta: new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10) };
}

/** Valor vigente en un mes: la fila con `desde` más reciente que no pase del último día del mes. */
export function vigente<T extends { desde: string }>(filas: T[], hasta: string): T | undefined {
  return filas.filter((f) => f.desde <= hasta).sort((a, b) => b.desde.localeCompare(a.desde))[0];
}

/** Cálculo puro: se prueba sin base. */
export function calcularRentabilidad(e: {
  mes: string;
  costos: Pick<CostoPersonal, 'usuario_id' | 'sueldo_mensual' | 'desde'>[];
  fees: Pick<FeeCliente, 'cliente_id' | 'fee_mensual' | 'desde'>[];
  horas: { cliente_id: string | null; usuario_id: string | null; horas: number }[];
  usuarios: Pick<Usuario, 'id' | 'nombre' | 'activo' | 'fecha_salida'>[];
  clientes: { id: string; nombre: string }[];
  /** Clientes que no cuentan (de prueba). */
  excluir?: Set<string>;
}): RentabilidadMes {
  const { desde, hasta } = rangoMes(e.mes);
  const nombre = (id: string) => {
    const u = e.usuarios.find((x) => x.id === id);
    return u ? nombrePersona(u) : 'Sin nombre';
  };
  // Horas del mes por persona y cliente (sin clientes de prueba).
  const porPersona = new Map<string, Map<string, number>>();
  let horasSinCosto = 0;
  for (const h of e.horas) {
    const n = Number(h.horas);
    if (h.cliente_id && e.excluir?.has(h.cliente_id)) continue;
    if (!h.usuario_id || !h.cliente_id) {
      horasSinCosto += n;
      continue;
    }
    const m = porPersona.get(h.usuario_id) ?? new Map<string, number>();
    m.set(h.cliente_id, (m.get(h.cliente_id) ?? 0) + n);
    porPersona.set(h.usuario_id, m);
  }

  const porCliente = new Map<string, RentabilidadCliente>();
  const fila = (clienteId: string): RentabilidadCliente => {
    let c = porCliente.get(clienteId);
    if (!c) {
      const fee = vigente(
        e.fees.filter((f) => f.cliente_id === clienteId),
        hasta,
      );
      c = {
        cliente_id: clienteId,
        cliente: e.clientes.find((x) => x.id === clienteId)?.nombre ?? 'Cliente',
        fee: fee ? Number(fee.fee_mensual) : null,
        costo: 0,
        margen: null,
        margen_pct: null,
        horas: 0,
        personas: [],
      };
      porCliente.set(clienteId, c);
    }
    return c;
  };

  const sinRepartir: RentabilidadMes['sin_repartir']['personas'] = [];
  const sinSueldo: RentabilidadMes['sin_sueldo'] = [];
  const conSueldo = new Set(e.costos.map((c) => c.usuario_id));
  for (const usuarioId of new Set([...conSueldo, ...porPersona.keys()])) {
    // Quien salió antes de empezar el mes ya no cuesta (su sueldo seguiría vigente si no).
    const salida = e.usuarios.find((u) => u.id === usuarioId)?.fecha_salida;
    const costo =
      salida && salida < desde
        ? undefined
        : vigente(
            e.costos.filter((c) => c.usuario_id === usuarioId),
            hasta,
          );
    const horas = porPersona.get(usuarioId);
    const total = horas ? [...horas.values()].reduce((s, h) => s + h, 0) : 0;
    if (!costo) {
      if (total > 0) sinSueldo.push({ usuario_id: usuarioId, nombre: nombre(usuarioId), horas: r2(total) });
      // Aun sin sueldo, sus horas cuentan en las horas del cliente.
      for (const [clienteId, h] of horas ?? []) fila(clienteId).horas += h;
      continue;
    }
    const sueldo = Number(costo.sueldo_mensual);
    if (total <= 0) {
      sinRepartir.push({ usuario_id: usuarioId, nombre: nombre(usuarioId), sueldo });
      continue;
    }
    for (const [clienteId, h] of horas!) {
      const c = fila(clienteId);
      const parte = (sueldo * h) / total;
      c.costo += parte;
      c.horas += h;
      c.personas.push({ usuario_id: usuarioId, nombre: nombre(usuarioId), horas: r2(h), costo: r2(parte) });
    }
  }
  // Clientes con fee y sin horas en el mes también van: todo su fee es margen.
  for (const f of e.fees) if (!e.excluir?.has(f.cliente_id) && vigente([f], hasta)) fila(f.cliente_id);

  const clientes = [...porCliente.values()]
    .map((c) => {
      const costo = r2(c.costo);
      const margen = c.fee === null ? null : r2(c.fee - costo);
      return {
        ...c,
        costo,
        horas: r2(c.horas),
        margen,
        margen_pct: c.fee && margen !== null ? Math.round((margen / c.fee) * 100) : null,
        personas: c.personas.sort((a, b) => b.costo - a.costo),
      };
    })
    .filter((c) => c.fee !== null || c.costo > 0 || c.horas > 0)
    .sort((a, b) => (a.margen ?? Infinity) - (b.margen ?? Infinity) || b.costo - a.costo);

  const fee = r2(clientes.reduce((s, c) => s + (c.fee ?? 0), 0));
  const costo = r2(clientes.reduce((s, c) => s + c.costo, 0));
  return {
    mes: e.mes,
    clientes,
    totales: { fee, costo, margen: r2(fee - costo) },
    sin_repartir: { total: r2(sinRepartir.reduce((s, p) => s + p.sueldo, 0)), personas: sinRepartir },
    horas_sin_costo: r2(horasSinCosto),
    sin_sueldo: sinSueldo.sort((a, b) => b.horas - a.horas),
  };
}

/** Rentabilidad del mes con el cliente de la persona: la RLS de la migración 41 vuelve a exigir gerencia o admin. */
export async function rentabilidadMes(ctx: DbCtx, mes: string): Promise<RentabilidadMes> {
  const { desde, hasta } = rangoMes(mes);
  const [costos, fees, horas, usuarios, clientes, prueba] = await Promise.all([
    listCostosPersonal(ctx),
    listFeesCliente(ctx),
    listHorasEntre(ctx, desde, hasta),
    listUsuarios(ctx, { incluirInactivos: true }),
    listClientes(ctx, { incluirInactivos: true }),
    idsClientesDePrueba(ctx),
  ]);
  return calcularRentabilidad({ mes, costos, fees, horas, usuarios, clientes, excluir: prueba });
}
