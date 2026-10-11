import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Requerimiento } from '@backio/shared';

const estado = vi.hoisted(() => ({ req: null as Record<string, unknown> | null, auditoria: [] as unknown[], updates: [] as unknown[] }));
const espias = vi.hoisted(() => ({
  pushDueDate: vi.fn(),
  registrarReproceso: vi.fn(),
  cerrarReproceso: vi.fn(),
  completarUltimaReprogramacion: vi.fn(),
}));

vi.mock('../lib/db', () => ({
  getRequerimiento: async () => estado.req,
  updateRequerimiento: async (_c: unknown, _id: string, cambios: Record<string, unknown>) => {
    estado.updates.push(cambios);
    return { ...estado.req, ...cambios };
  },
  audit: async (_c: unknown, e: unknown) => void estado.auditoria.push(e),
}));
vi.mock('../lib/db/historial', () => ({ completarUltimaReprogramacion: espias.completarUltimaReprogramacion }));
vi.mock('../lib/cumplimiento', () => ({ registrarReproceso: espias.registrarReproceso, cerrarReproceso: espias.cerrarReproceso }));
vi.mock('../lib/basecamp/write', () => ({ pushDueDate: espias.pushDueDate }));

import { actualizarRequerimiento, ReglaError } from '../lib/requerimientos/actualizar';

const ctx = { tenantId: 't', usuarioId: 'u1', origen: 'mcp' } as never;
const base = {
  id: 'r1',
  titulo_interno: 'Pieza',
  owner_agencia: ['u1'],
  fecha_entrega: '2026-10-10',
  estado_operativo: 'en_ejecucion',
  estado_aprobacion: 'pendiente_interno',
  basecamp_todo_id: 99,
};
const opts = { colaborador: false, exigirMotivo: true };
const regla = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof ReglaError ? [e.status, e.message] : e),
  );

beforeEach(() => {
  estado.req = { ...base };
  estado.auditoria = [];
  estado.updates = [];
  Object.values(espias).forEach((f) => f.mockReset());
});

// B9: la misma función atiende la UI y el confirm_plan del MCP; antes el MCP se saltaba estas reglas.
describe('actualizarRequerimiento (REST y MCP)', () => {
  it('no completa desde BackIO una tarea que vive en Basecamp (regla 3)', async () => {
    expect(await regla(actualizarRequerimiento(ctx, 'r1', { estado_operativo: 'completado' }, opts))).toEqual([
      422,
      expect.stringContaining('Basecamp'),
    ]);
    expect(estado.updates).toHaveLength(0);
  });
  it('no pone en el daily una tarea sin responsable', async () => {
    estado.req = { ...base, owner_agencia: [] };
    expect(await regla(actualizarRequerimiento(ctx, 'r1', { daily_fecha: '2026-10-10' }, opts))).toEqual([
      422,
      expect.stringContaining('responsable'),
    ]);
  });
  it('colaborador: solo sus tareas y solo sus campos', async () => {
    estado.req = { ...base, owner_agencia: ['otro'] };
    expect(await regla(actualizarRequerimiento(ctx, 'r1', { piezas: 2 }, { ...opts, colaborador: true }))).toEqual([
      403,
      expect.any(String),
    ]);
    estado.req = { ...base };
    expect(await regla(actualizarRequerimiento(ctx, 'r1', { prioridad: 'alta' }, { ...opts, colaborador: true }))).toEqual([
      403,
      expect.stringContaining('prioridad'),
    ]);
  });
  it('reprogramar exige motivo, registra la reprogramación y baja la fecha a Basecamp', async () => {
    expect(await regla(actualizarRequerimiento(ctx, 'r1', { fecha_entrega: '2026-10-15' }, opts))).toEqual([
      422,
      expect.stringContaining('motivo'),
    ]);
    const r = await actualizarRequerimiento(
      ctx,
      'r1',
      { fecha_entrega: '2026-10-15', motivo_reprogramacion: 'cambio_alcance' },
      { ...opts, auditoriaExtra: { plan_id: 'plan_x' } },
    );
    expect(espias.completarUltimaReprogramacion).toHaveBeenCalledOnce();
    expect(espias.pushDueDate).toHaveBeenCalledOnce();
    expect(r.basecamp_due_on).toBe('ok');
    expect(estado.auditoria[0]).toMatchObject({ accion: 'reprogramar', detalle: { de: '2026-10-10', a: '2026-10-15', plan_id: 'plan_x' } });
  });
  it('si Basecamp no acepta la fecha, se informa y queda auditado (antes el MCP lo perdía)', async () => {
    espias.pushDueDate.mockRejectedValueOnce(new Error('503'));
    const r = await actualizarRequerimiento(ctx, 'r1', { fecha_entrega: '2026-10-15', motivo_reprogramacion: 'otro' }, opts);
    expect(r.basecamp_due_on).toBe('error');
    expect(estado.auditoria.some((a) => (a as { accion: string }).accion === 'basecamp_due_on_error')).toBe(true);
  });
  it('reabrir un completado registra un reproceso interno; el rechazo del cliente, uno del cliente', async () => {
    estado.req = { ...base, estado_operativo: 'completado' };
    await actualizarRequerimiento(ctx, 'r1', { estado_operativo: 'en_ejecucion' }, opts);
    expect(espias.registrarReproceso).toHaveBeenLastCalledWith(ctx, 'r1', expect.objectContaining({ origen: 'interno' }));
    estado.req = { ...base };
    await actualizarRequerimiento(ctx, 'r1', { estado_aprobacion: 'rechazado' }, opts);
    expect(espias.registrarReproceso).toHaveBeenLastCalledWith(ctx, 'r1', expect.objectContaining({ origen: 'cliente' }));
  });
  it('requerimiento inexistente: 404', async () => {
    estado.req = null;
    expect(await regla(actualizarRequerimiento(ctx, 'r1', { piezas: 1 }, opts))).toEqual([404, 'No encontrado']);
  });
});
