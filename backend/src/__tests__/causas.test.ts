import { describe, expect, it } from 'vitest';
import { causasVigentes, type TareaCausa } from '../lib/causas';
import { comentarioDeNota } from '../routes/v1/requerimientos';

const hoy = '2026-11-04';
const t = (id: string, p: Partial<TareaCausa> = {}): TareaCausa => ({
  id,
  titulo_interno: `Tarea ${id}`,
  cliente_id: 'c1',
  proyecto_id: null,
  estado_operativo: 'en_ejecucion',
  completado_at: null,
  ...p,
});
const fila = (requerimiento_id: string) => ({ requerimiento_id });

// Carolina, 3/11/2026: 171 causas pendientes, casi todas decían «Requerimiento» y traían tareas de otra mesa.
describe('causas pendientes', () => {
  it('trae el título y el cliente, también de lo completado hace poco', () => {
    const r = causasVigentes([fila('a')], [t('a', { estado_operativo: 'completado', completado_at: '2026-10-30T15:00:00Z' })], hoy);
    expect(r).toEqual([{ requerimiento_id: 'a', titulo: 'Tarea a', cliente_id: 'c1' }]);
  });
  it('deja de pedir lo cerrado hace más de 15 días y lo cancelado', () => {
    const tareas = [
      t('vieja', { estado_operativo: 'completado', completado_at: '2026-10-10T15:00:00Z' }),
      t('borde', { estado_operativo: 'completado', completado_at: '2026-10-20T15:00:00Z' }),
      t('cancelada', { estado_operativo: 'cancelado' }),
    ];
    expect(causasVigentes(['vieja', 'borde', 'cancelada'].map(fila), tareas, hoy).map((x) => x.requerimiento_id)).toEqual(['borde']);
  });
  it('filtra por mesa, por cliente o por proyecto', () => {
    const tareas = [t('a', { cliente_id: 'orion' }), t('b', { cliente_id: 'omega' }), t('c', { cliente_id: 'otro', proyecto_id: 'p' })];
    const r = causasVigentes(['a', 'b', 'c'].map(fila), tareas, hoy, { clienteIds: ['omega'], proyectoIds: ['p'] });
    expect(r.map((x) => x.requerimiento_id)).toEqual(['b', 'c']);
  });
});

describe('observación hacia Basecamp', () => {
  it('escapa el texto y conserva los saltos de línea', () => {
    expect(comentarioDeNota('<b>Hola</b>\nFee & más')).toBe('<div>&lt;b&gt;Hola&lt;/b&gt;<br>Fee &amp; más</div>');
  });
});
