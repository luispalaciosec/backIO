import { beforeEach, describe, expect, it, vi } from 'vitest';

const e = vi.hoisted(() => ({
  req: null as Record<string, unknown> | null,
  ultimo: null as { created_at: string; fecha_anterior: string | null } | null,
  update: vi.fn(),
  completar: vi.fn(),
  audit: vi.fn(),
  usuarioPorBasecampId: vi.fn(),
}));

vi.mock('../lib/db/requerimientos', () => ({ findByBasecampTodo: async () => e.req, updateRequerimiento: e.update }));
vi.mock('../lib/db/historial', () => ({
  ultimoCambioDeFechaEnBackio: async () => e.ultimo,
  completarUltimaReprogramacion: e.completar,
}));
vi.mock('../lib/db/usuarios', () => ({ usuarioPorBasecampId: e.usuarioPorBasecampId }));
vi.mock('../lib/db/audit', () => ({ audit: e.audit }));
vi.mock('../lib/cumplimiento', () => ({ registrarReproceso: vi.fn(), cerrarReproceso: vi.fn() }));

import { applyBasecampUpdate, type BasecampSyncPayload } from '../lib/basecamp/sync';

const ctx = { tenantId: 't', usuarioId: null, origen: 'webhook' } as never;
const payload = (extra: Partial<BasecampSyncPayload> = {}): BasecampSyncPayload => ({
  todo_id: 70,
  completed: false,
  bucket_id: 10,
  completed_at: null,
  due_on: '2026-10-19',
  assignee_ids: [],
  updated_at: '2026-10-19T14:47:00Z',
  actor_basecamp_id: 501,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  e.req = { id: 'r1', tenant_id: 't', estado_operativo: 'en_ejecucion', fecha_entrega: '2026-10-16' };
  e.ultimo = null;
  e.usuarioPorBasecampId.mockResolvedValue('grace');
});

// 19/10/2026 (caso Grace): la fecha que alguien cambia en Basecamp ya no se revierte con la cuenta de Luis.
describe('fecha cambiada en Basecamp', () => {
  it('se acepta como reprogramación desde Basecamp, a nombre de quien la cambió', async () => {
    const r = await applyBasecampUpdate(ctx, payload());
    expect(r).toMatchObject({ aplicado: true, fecha_aceptada: true });
    expect(e.update).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: 'grace' }), 'r1', { fecha_entrega: '2026-10-19' });
    expect(e.completar).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: 'grace' }), 'r1', { motivo: null, origen: 'basecamp' });
    expect(e.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'basecamp_fecha_aceptada' }));
  });
  it('si no se sabe quién fue (reconciliación), queda sin autor, nunca a nombre de otro', async () => {
    await applyBasecampUpdate(ctx, payload({ actor_basecamp_id: undefined }));
    expect(e.usuarioPorBasecampId).not.toHaveBeenCalled();
    expect(e.update.mock.calls[0]![0]).toMatchObject({ usuarioId: null });
  });
  it('si BackIO la cambió después, manda BackIO', async () => {
    e.ultimo = { created_at: '2026-10-19T15:00:00Z', fecha_anterior: '2026-10-10' };
    const r = await applyBasecampUpdate(ctx, payload());
    expect(r.fecha_aceptada).toBeUndefined();
    expect(e.update).not.toHaveBeenCalled();
  });
  it('si Basecamp sigue con la fecha de antes del cambio de BackIO (aún no llegó), no se toma como cambio', async () => {
    e.ultimo = { created_at: '2026-10-18T10:00:00Z', fecha_anterior: '2026-10-19' };
    const r = await applyBasecampUpdate(ctx, payload({ updated_at: '2026-10-19T16:00:00Z' }));
    expect(r.fecha_aceptada).toBeUndefined();
    expect(e.update).not.toHaveBeenCalled();
  });
  it('misma fecha, sin fecha o tarea cerrada: no hace nada', async () => {
    await applyBasecampUpdate(ctx, payload({ due_on: '2026-10-16' }));
    await applyBasecampUpdate(ctx, payload({ due_on: null }));
    e.req = { ...e.req!, estado_operativo: 'completado' };
    await applyBasecampUpdate(ctx, payload({ completed: true }));
    expect(e.update).not.toHaveBeenCalled();
  });
});
