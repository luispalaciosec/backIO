/** Explicación del escenario recomendado para armar el día (docs/05). Las reglas deciden; aquí solo se redacta el porqué. */
import { nombrePersona } from '@backio/shared';
import type { DbCtx } from '../db/client';
import { listClientes } from '../db/clientes';
import { listUsuarios } from '../db/usuarios';
import { escenariosDelDia } from '../rituals/escenarios';
import { generarTexto } from './index';

const SYSTEM_ESCENARIO = `Le explicas a la ejecutiva que arma el daily por qué se le recomienda este escenario para hoy.
Escribe máximo dos frases cortas, en tono de compañera de mesa, con los números de los datos: qué logra y qué deja afuera.
Si una persona queda pasada de sus horas, dilo con su nombre. No cambies la recomendación ni propongas otra.
Texto plano, sin títulos ni viñetas.`;

export async function explicarEscenario(ctx: DbCtx, mesaId?: string, ejecutivaId?: string): Promise<string> {
  const [d, usuarios, clientes] = await Promise.all([
    escenariosDelDia(ctx, mesaId, ejecutivaId),
    listUsuarios(ctx),
    listClientes(ctx, { incluirInactivos: true }),
  ]);
  const e = d.escenarios.find((x) => x.recomendado)!;
  const g = await generarTexto(ctx, {
    tipo: 'daily_escenario',
    entidad: mesaId ? { tipo: 'mesa', id: mesaId } : undefined,
    payload: {
      escenario: e.titulo,
      para_que: e.para_que,
      regla: d.porque,
      tareas: e.impacto.tareas,
      atraso_antes: e.impacto.atraso_antes,
      atraso_despues: e.impacto.atraso_despues,
      vencen_hoy: e.impacto.vencen_hoy,
      vencen_hoy_cubiertas: e.impacto.vencen_hoy_cubiertas,
      quedan_afuera: e.impacto.afuera,
      afuera_por_cliente: e.impacto.afuera_por_cliente.map((x) => ({
        cliente: clientes.find((c) => c.id === x.cliente_id)?.nombre ?? '',
        tareas: x.n,
      })),
      personas: e.impacto.personas.map((p) => {
        const u = usuarios.find((x) => x.id === p.usuario_id);
        return { nombre: u ? nombrePersona(u) : '', horas: p.horas, horas_de_su_dia: p.capacidad };
      }),
    },
    system: SYSTEM_ESCENARIO,
    maxTokens: 200,
    cacheMs: 30 * 60_000,
  });
  return g.texto;
}
