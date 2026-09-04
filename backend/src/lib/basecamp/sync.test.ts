import { describe, it, expect, vi } from 'vitest';
import { extractSafePayload, extractSafeTodo, applyBasecampUpdate } from './sync';
import * as reqs from '../db/requerimientos';
import * as auditMod from '../db/audit';

const mockTodo = (extra: Record<string, unknown> = {}) => ({
  id: 991,
  status: 'active',
  completed: true,
  completed_at: '2026-09-01T10:00:00Z',
  due_on: '2026-09-05',
  updated_at: '2026-09-01T10:00:00Z',
  content: 'Ruta creativa v3',
  description: '<p>ESTO ESTA HORRIBLE</p>',
  comments_count: 2,
  comments: [{ content: 'el cliente no sabe lo que quiere' }],
  attachments: [{ name: 'horrible.png' }],
  assignees: [{ id: 5, name: 'Elías', email_address: 'e@geeks.ec' }],
  ...extra,
});

describe('Defensa 1 · extracción estricta de Basecamp', () => {
  it('extrae únicamente los campos permitidos', () => {
    const safe = extractSafePayload({ kind: 'todo_completed', recording: mockTodo() });
    expect(safe).toEqual({
      todo_id: 991,
      completed: true,
      bucket_id: null,
      completed_at: '2026-09-01T10:00:00Z',
      due_on: '2026-09-05',
      assignee_ids: [5],
      updated_at: '2026-09-01T10:00:00Z',
    });
    const dump = JSON.stringify(safe);
    expect(dump).not.toContain('HORRIBLE');
    expect(dump).not.toContain('no sabe lo que quiere');
    expect(dump).not.toContain('horrible.png');
    expect(dump).not.toContain('Elías');
    expect(Object.keys(safe!).sort()).toEqual(['assignee_ids', 'bucket_id', 'completed', 'completed_at', 'due_on', 'todo_id', 'updated_at']);
  });

  it('ignora eventos que no son de to-do', () => {
    expect(extractSafePayload({ kind: 'comment_created', recording: mockTodo() })).toBeNull();
    expect(extractSafePayload({ kind: 'message_created', recording: { id: 1 } })).toBeNull();
    expect(extractSafePayload(null)).toBeNull();
  });

  it('extractSafeTodo tolera objetos incompletos', () => {
    expect(extractSafeTodo({ id: 1 })?.completed).toBeNull();
    expect(extractSafeTodo({ id: 'x' })).toBeNull();
  });

  it('deriva completed del tipo de evento aunque el recording resumido no lo traiga', () => {
    const resumido = { id: 991, type: 'Todo', bucket: { id: 48775530 } };
    expect(extractSafePayload({ kind: 'todo_completed', recording: resumido })).toMatchObject({ completed: true, bucket_id: 48775530 });
    expect(extractSafePayload({ kind: 'todo_uncompleted', recording: resumido })).toMatchObject({ completed: false });
    expect(extractSafePayload({ kind: 'todo_changed', recording: resumido })?.completed).toBeNull();
  });

  it('nunca persiste texto proveniente de Basecamp', async () => {
    const escrituras: unknown[] = [];
    vi.spyOn(reqs, 'findByBasecampTodo').mockResolvedValue({
      id: 'r1', tenant_id: 't1', estado_operativo: 'en_ejecucion',
    } as never);
    vi.spyOn(reqs, 'updateRequerimiento').mockImplementation(async (_c, _id, patch) => {
      escrituras.push(patch);
      return {} as never;
    });
    vi.spyOn(auditMod, 'audit').mockImplementation(async (_c, e) => { escrituras.push(e); });

    const safe = extractSafePayload({ kind: 'todo_completed', recording: mockTodo() })!;
    const ctx = { db: {} as never, tenantId: 't1', usuarioId: null, origen: 'webhook:basecamp' as const };
    const res = await applyBasecampUpdate(ctx, safe);

    expect(res.aplicado).toBe(true);
    const dump = JSON.stringify(escrituras);
    expect(dump).not.toContain('HORRIBLE');
    expect(dump).not.toContain('no sabe lo que quiere');
    expect(escrituras[0]).toMatchObject({ estado_operativo: 'completado' });
  });

  it('reabre a en_ejecucion, no a backlog', async () => {
    let patch: unknown;
    vi.spyOn(reqs, 'findByBasecampTodo').mockResolvedValue({ id: 'r1', tenant_id: 't1', estado_operativo: 'completado' } as never);
    vi.spyOn(reqs, 'updateRequerimiento').mockImplementation(async (_c, _id, p) => { patch = p; return {} as never; });
    vi.spyOn(auditMod, 'audit').mockResolvedValue();
    const safe = extractSafePayload({ kind: 'todo_uncompleted', recording: mockTodo({ completed: false, completed_at: null }) })!;
    await applyBasecampUpdate({ db: {} as never, tenantId: 't1', usuarioId: null, origen: 'webhook:basecamp' }, safe);
    expect(patch).toMatchObject({ estado_operativo: 'en_ejecucion', completado_at: null });
  });
});
