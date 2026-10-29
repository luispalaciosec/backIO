import { beforeEach, describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({ req: null as Record<string, unknown> | null, auditoria: [] as unknown[], updates: [] as unknown[] }));
const espias = vi.hoisted(() => ({
  pushDueDate: vi.fn(),
  archivarTodo: vi.fn(),
  pushResponsables: vi.fn(),
  registrarReproceso: vi.fn(),
  cerrarReproceso: vi.fn(),
  completarUltimaReprogramacion: vi.fn(),
  forActor: vi.fn(),
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
vi.mock('../lib/db/requerimientos', () => ({ marcarDueOnVisto: async () => undefined }));
vi.mock('../lib/cumplimiento', () => ({ registrarReproceso: espias.registrarReproceso, cerrarReproceso: espias.cerrarReproceso }));
vi.mock('../lib/basecamp/write', () => ({
  pushDueDate: espias.pushDueDate,
  archivarTodo: espias.archivarTodo,
  pushResponsables: espias.pushResponsables,
}));
vi.mock('../lib/basecamp/client', async (orig) => ({
  ...(await orig<object>()),
  BasecampClient: { forActor: espias.forActor },
}));

import { actualizarRequerimiento, ReglaError } from '../lib/requerimientos/actualizar';
import { BasecampSinConectar } from '../lib/basecamp/client';

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
  espias.forActor.mockResolvedValue({ cuenta: 'de u1' });
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
  // Auditoría del 28/10/2026: dos tareas de AB-Inbev llegaron de Basecamp sin fecha, se la pusieron en BackIO y nunca bajó.
  it('poner fecha a una tarea que no tenía la lleva a Basecamp, sin contarla como reprogramación', async () => {
    estado.req = { ...base, fecha_entrega: null };
    const r = await actualizarRequerimiento(ctx, 'r1', { fecha_entrega: '2026-10-30' }, opts);
    expect(espias.pushDueDate).toHaveBeenCalledOnce();
    expect(espias.forActor).toHaveBeenCalledOnce();
    expect(espias.completarUltimaReprogramacion).not.toHaveBeenCalled();
    expect(r.basecamp_due_on).toBe('ok');
    expect(estado.auditoria[0]).toMatchObject({ accion: 'actualizar' });
  });
  // 28/10/2026 (decisión de Luis): «Briefing Pasaportes» se canceló en BackIO y siguió abierto en Basecamp.
  it('cancelar archiva el to-do en Basecamp con la cuenta de quien cancela', async () => {
    await actualizarRequerimiento(ctx, 'r1', { estado_operativo: 'cancelado' }, opts);
    expect(espias.forActor).toHaveBeenCalledWith(ctx);
    expect(espias.archivarTodo).toHaveBeenCalledWith(ctx, expect.objectContaining({ id: 'r1' }), true, { cuenta: 'de u1' });
  });
  it('sacar una tarea de cancelado vuelve a dejar activo el to-do', async () => {
    estado.req = { ...base, estado_operativo: 'cancelado' };
    await actualizarRequerimiento(ctx, 'r1', { estado_operativo: 'en_ejecucion' }, opts);
    expect(espias.archivarTodo).toHaveBeenCalledWith(ctx, expect.objectContaining({ id: 'r1' }), false, { cuenta: 'de u1' });
  });
  it('si Basecamp falla al archivar, la cancelación queda y el error se audita', async () => {
    espias.archivarTodo.mockRejectedValueOnce(new Error('Basecamp 500'));
    await actualizarRequerimiento(ctx, 'r1', { estado_operativo: 'cancelado' }, opts);
    expect(estado.updates[0]).toMatchObject({ estado_operativo: 'cancelado' });
    expect(estado.auditoria).toContainEqual(expect.objectContaining({ accion: 'basecamp_archivar_error' }));
  });
  it('sin Basecamp conectado no se cancela a medias (428 antes de guardar)', async () => {
    espias.forActor.mockRejectedValueOnce(new BasecampSinConectar());
    await expect(actualizarRequerimiento(ctx, 'r1', { estado_operativo: 'cancelado' }, opts)).rejects.toBeInstanceOf(BasecampSinConectar);
    expect(estado.updates).toEqual([]);
  });
  it('cancelar una tarea sin to-do no pide Basecamp', async () => {
    estado.req = { ...base, basecamp_todo_id: null };
    await actualizarRequerimiento(ctx, 'r1', { estado_operativo: 'cancelado' }, opts);
    expect(espias.forActor).not.toHaveBeenCalled();
    expect(espias.archivarTodo).not.toHaveBeenCalled();
  });
  // 28/10/2026: reasignar en BackIO no llegaba a Basecamp y la sincronización lo deshacía.
  it('cambiar responsables los lleva a Basecamp con la cuenta de quien reasigna', async () => {
    await actualizarRequerimiento(ctx, 'r1', { owner_agencia: ['julio'] }, opts);
    expect(espias.forActor).toHaveBeenCalledWith(ctx);
    expect(espias.pushResponsables).toHaveBeenCalledWith(ctx, expect.objectContaining({ owner_agencia: ['julio'] }), { cuenta: 'de u1' });
  });
  it('los mismos responsables en otro orden no escriben en Basecamp', async () => {
    estado.req = { ...base, owner_agencia: ['u1', 'u2'] };
    await actualizarRequerimiento(ctx, 'r1', { owner_agencia: ['u2', 'u1'] }, opts);
    expect(espias.pushResponsables).not.toHaveBeenCalled();
    expect(espias.forActor).not.toHaveBeenCalled();
  });
  it('si Basecamp falla, la reasignación queda y el error se audita', async () => {
    espias.pushResponsables.mockRejectedValueOnce(new Error('Basecamp 500'));
    await actualizarRequerimiento(ctx, 'r1', { owner_agencia: ['julio'] }, opts);
    expect(estado.updates[0]).toMatchObject({ owner_agencia: ['julio'] });
    expect(estado.auditoria).toContainEqual(expect.objectContaining({ accion: 'basecamp_responsables_error' }));
  });
  it('requerimiento inexistente: 404', async () => {
    estado.req = null;
    expect(await regla(actualizarRequerimiento(ctx, 'r1', { piezas: 1 }, opts))).toEqual([404, 'No encontrado']);
  });

  // Migración 33: lo que baja a Basecamp va con la cuenta de quien hace el cambio, y sin cuenta conectada no se aplica.
  it('la fecha baja a Basecamp con la cuenta de quien cambia; sin su Basecamp conectado no cambia nada', async () => {
    await actualizarRequerimiento(ctx, 'r1', { fecha_entrega: '2026-10-20', motivo_reprogramacion: 'cambio_alcance' }, opts);
    expect(espias.forActor).toHaveBeenCalledWith(ctx);
    expect(espias.pushDueDate).toHaveBeenCalledWith(ctx, expect.anything(), { cuenta: 'de u1' });
    estado.updates = [];
    espias.forActor.mockRejectedValueOnce(new BasecampSinConectar());
    await expect(
      actualizarRequerimiento(ctx, 'r1', { fecha_entrega: '2026-10-21', motivo_reprogramacion: 'cambio_alcance' }, opts),
    ).rejects.toBeInstanceOf(BasecampSinConectar);
    expect(estado.updates).toEqual([]);
  });
  it('sin to-do en Basecamp no hace falta tener la cuenta conectada', async () => {
    estado.req = { ...base, basecamp_todo_id: null };
    await actualizarRequerimiento(ctx, 'r1', { fecha_entrega: '2026-10-20', motivo_reprogramacion: 'cambio_alcance' }, opts);
    expect(espias.forActor).not.toHaveBeenCalled();
  });
  it('reabrir un completado reabre también el to-do (antes nunca se reabría)', async () => {
    estado.req = { ...base, estado_operativo: 'completado' };
    await actualizarRequerimiento(ctx, 'r1', { estado_operativo: 'en_ejecucion' }, opts);
    expect(espias.registrarReproceso).toHaveBeenCalledWith(
      ctx,
      'r1',
      expect.objectContaining({ estabaCompletada: true, bc: { cuenta: 'de u1' } }),
    );
  });
});
