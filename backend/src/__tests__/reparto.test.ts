import { describe, expect, it } from 'vitest';
import { sugerirReparto } from '../lib/rituals/reparto';
import type { CargaPersona, TareaCarga } from '../lib/carga';

const t = (id: string, cliente_id: string, horas: number, fecha_entrega = '2026-11-05'): TareaCarga => ({
  id,
  titulo: `Tarea ${id}`,
  cliente_id,
  proyecto_id: null,
  fecha_entrega,
  horas,
  base: 'equipo' as TareaCarga['base'],
});
const p = (usuario_id: string, capacidad_restante: number, tareas: TareaCarga[], en_riesgo: TareaCarga[] = []): CargaPersona => ({
  usuario_id,
  nombre: usuario_id,
  capacidad_semanal: 40,
  capacidad_base: 'ritmo',
  capacidad_restante,
  horas: tareas.reduce((s, x) => s + x.horas, 0),
  tareas,
  en_riesgo,
  exceso: 0,
});
const opts = { fechaRenegociar: '2026-11-09' };

describe('plan de la semana', () => {
  const riesgo = t('r', 'banco', 10);
  it('propone a quien ya trabaja con ese cliente y tiene horas', () => {
    const [s] = sugerirReparto([p('oscar', 10, [t('a', 'banco', 20), riesgo], [riesgo]), p('ana', 30, [t('b', 'banco', 5)])], opts);
    expect(s).toMatchObject({ tarea_id: 'r', de_id: 'oscar', a_id: 'ana', horas_libres_a: 25, fecha_sugerida: null });
  });
  it('nunca propone a alguien que no conoce la cuenta, aunque tenga horas: toca renegociar', () => {
    const [s] = sugerirReparto([p('oscar', 10, [riesgo], [riesgo]), p('gerente', 40, []), p('ana', 40, [t('b', 'otro', 1)])], opts);
    expect(s).toMatchObject({ a_id: null, fecha_sugerida: '2026-11-09' });
  });
  it('no le pasa dos tareas a quien solo tiene horas para una', () => {
    const r1 = t('r1', 'banco', 10);
    const r2 = t('r2', 'banco', 10, '2026-11-06');
    const out = sugerirReparto([p('oscar', 0, [r1, r2], [r1, r2]), p('ana', 16, [t('b', 'banco', 2)])], opts);
    expect(out.map((s) => s.a_id)).toEqual(['ana', null]);
  });
  it('filtra por las cuentas de la mesa y sin riesgo no sugiere nada', () => {
    expect(sugerirReparto([p('oscar', 0, [riesgo], [riesgo])], { ...opts, soloClientes: new Set(['otro']) })).toEqual([]);
    expect(sugerirReparto([p('oscar', 40, [t('a', 'banco', 2)])], opts)).toEqual([]);
  });
});
