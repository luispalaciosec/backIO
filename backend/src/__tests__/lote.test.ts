import { describe, expect, it, vi } from 'vitest';

const rpcService = vi.hoisted(() => vi.fn());
vi.mock('../lib/db/client', async (orig) => ({ ...(await orig<object>()), serviceClient: () => ({ rpc: rpcService }) }));

import { crearLote, quitarAcceso } from '../lib/db/lote';

// B7 y B8: las RPC de la migración 29 hacen la transacción; aquí se prueba lo que les manda el backend.
describe('crearLote', () => {
  it('manda claves del lote y auditoría en cada fila', async () => {
    const rpc = vi.fn(async () => ({ data: { proyectos: {}, requerimientos: [] }, error: null }));
    const ctx = { db: { rpc }, tenantId: 't1', usuarioId: 'u1', origen: 'ui' } as never;
    await crearLote(
      ctx,
      [
        {
          clave: 'c:P',
          cliente_id: 'c',
          plantilla_id: null,
          nombre: 'P',
          brief: {},
          fecha_inicio: 'a',
          fecha_entrega: 'b',
          portal_token: 'x',
        },
      ],
      [{ proyecto_clave: 'c:P', cliente_id: 'c', titulo_interno: 'T', visible_cliente: false } as never],
    );
    expect(rpc).toHaveBeenCalledWith('crear_lote', {
      p_proyectos: [expect.objectContaining({ _clave: 'c:P', tenant_id: 't1', created_by: 'u1' })],
      p_requerimientos: [expect.objectContaining({ _proyecto_clave: 'c:P', tenant_id: 't1', titulo_interno: 'T' })],
    });
  });
  it('visible al cliente sin etiqueta se rechaza antes de llamar a la base', async () => {
    const rpc = vi.fn();
    const ctx = { db: { rpc }, tenantId: 't1', usuarioId: 'u1', origen: 'ui' } as never;
    await expect(crearLote(ctx, [], [{ cliente_id: 'c', titulo_interno: 'T', visible_cliente: true } as never])).rejects.toThrow(
      'etiqueta_cliente',
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('quitarAcceso', () => {
  const ctx = { tenantId: 't1', usuarioId: 'admin', origen: 'ui' } as never;
  it('errores de la función como respuestas claras', async () => {
    rpcService.mockResolvedValueOnce({ data: null, error: { code: 'P0002', message: 'x' } });
    await expect(quitarAcceso(ctx, 'u9', null)).rejects.toMatchObject({ status: 404 });
    rpcService.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'x' } });
    await expect(quitarAcceso(ctx, 'u9', 'u8')).rejects.toMatchObject({ status: 422 });
  });
  it('pasa tenant y actor', async () => {
    rpcService.mockResolvedValueOnce({ data: { tareas_reasignadas: 3 }, error: null });
    expect(await quitarAcceso(ctx, 'u9', 'u8')).toEqual({ tareas_reasignadas: 3 });
    expect(rpcService).toHaveBeenLastCalledWith('quitar_acceso', {
      p_tenant: 't1',
      p_usuario: 'u9',
      p_reasignar_a: 'u8',
      p_actor: 'admin',
    });
  });
});
