import { describe, expect, it } from 'vitest';
import { REGLAS } from '../lib/rituals/signals';

const base = {
  semana: { fecha_inicio: '2026-10-05', fecha_fin: '2026-10-11' },
  hoy: '2026-10-08',
  usuarios: [],
  clientes: [{ id: 'c1', nombre: 'Banco Uno', activo: true }],
  acuerdosAbiertos: [],
};
const tarea = (p: Record<string, unknown>) => ({
  id: Math.random().toString(36),
  cliente_id: 'c1',
  titulo_interno: 't',
  owner_agencia: [],
  fecha_entrega: '2026-10-09',
  estado_operativo: 'priorizado',
  estado_aprobacion: 'no_aplica',
  veces_reprogramado: 0,
  veces_reproceso: 0,
  dias_atraso: 0,
  dias_sin_movimiento: 0,
  ...p,
});

describe('señal tareas_sin_responsable', () => {
  it('agrupa por cliente las tareas sin responsable que vencen esta semana o ya vencieron', () => {
    const activos = [
      tarea({}),
      tarea({ fecha_entrega: '2026-09-30' }),
      tarea({ fecha_entrega: '2026-10-20' }),
      tarea({ owner_agencia: ['ana'] }),
    ];
    const regla = REGLAS.find((r) => r.tipo === 'tareas_sin_responsable')!;
    const s = regla.detectar({ ...base, activos } as never, {} as never);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ entidad_tipo: 'cliente', entidad_id: 'c1', detalle: { tareas: 2 } });
  });
});
