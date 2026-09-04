import { describe, it, expect } from 'vitest';
import { calcularSenales, type WeekContext } from './signals';
import type { RequerimientoMetricas } from '@backio/shared';

function req(p: Partial<RequerimientoMetricas>): RequerimientoMetricas {
  return {
    id: crypto.randomUUID(), tenant_id: 't', cliente_id: 'c1', proyecto_id: null, bloque_nombre: null, plantilla_tarea_id: null,
    titulo_interno: 'Tarea', etiqueta_cliente: null, visible_cliente: false, tipo_trabajo: 'fee',
    estado_operativo: 'priorizado', estado_aprobacion: 'no_aplica', prioridad: 'media', peso: 1,
    fecha_pedido: null, fecha_entrega: '2026-08-12', fecha_entrega_original: '2026-08-12', veces_reprogramado: 0, veces_reproceso: 0,
    owner_agencia: ['u1'], owner_cliente: null, piezas: 0, tipo_pieza_id: null, brief_url: null, entregable_urls: null,
    basecamp_todo_id: null, basecamp_todolist_id: null, basecamp_url: null,
    ultima_actualizacion: '2026-08-09T00:00:00Z', completado_at: null, created_at: '', updated_at: '', created_by: null, deleted_at: null,
    dias_atraso: 0, dias_sin_movimiento: 0, peso_completado: 0,
    ...p,
  };
}

const base: WeekContext = {
  hoy: '2026-08-10',
  semana: { fecha_inicio: '2026-08-10', fecha_fin: '2026-08-16' },
  activos: [],
  completadosRecientes: [],
  usuarios: [
    { id: 'u1', tenant_id: 't', nombre: 'Elías', email: 'e@g.ec', rol: 'colaborador', avatar_url: null, basecamp_user_id: null, capacidad_semanal: 40, activo: true },
    { id: 'u2', tenant_id: 't', nombre: 'Ana', email: 'a@g.ec', rol: 'colaborador', avatar_url: null, basecamp_user_id: null, capacidad_semanal: 40, activo: true },
  ],
  clientes: [{ id: 'c1', nombre: 'Banco Amazonas', activo: true }, { id: 'c2', nombre: 'Torres & Torres', activo: true }],
  acuerdosAbiertos: [],
};

describe('motor de señales', () => {
  it('semana del 03/08: Elías en 9 de 21 tareas → concentracion_carga 43%', () => {
    const activos = [
      ...Array(9).fill(0).map(() => req({ owner_agencia: ['u1'] })),
      ...Array(12).fill(0).map((_, i) => req({ owner_agencia: [`x${i}`] })),
    ];
    const s = calcularSenales({ ...base, activos }).filter((x) => x.tipo === 'concentracion_carga');
    expect(s).toHaveLength(1);
    expect(s[0]?.titulo).toBe('Elías concentra 9 de 21 tareas (43%)');
    expect(s[0]?.severidad).toBe('critica');
  });

  it('arrastre_reincidente con veces_reprogramado >= 2', () => {
    const s = calcularSenales({ ...base, activos: [req({ veces_reprogramado: 2 }), req({ veces_reprogramado: 1 })] });
    expect(s.filter((x) => x.tipo === 'arrastre_reincidente')).toHaveLength(1);
  });

  it('bloqueo_cliente solo si pendiente_cliente y > 5 días', () => {
    const s = calcularSenales({
      ...base,
      activos: [
        req({ estado_aprobacion: 'pendiente_cliente', dias_sin_movimiento: 6, etiqueta_cliente: 'Brief Navidad' }),
        req({ estado_aprobacion: 'pendiente_cliente', dias_sin_movimiento: 3 }),
      ],
    }).filter((x) => x.tipo === 'bloqueo_cliente');
    expect(s).toHaveLength(1);
    expect(s[0]?.titulo).toContain('Brief Navidad');
  });

  it('cuenta_silenciosa: cliente con activos y sin completados en 14 días', () => {
    const s = calcularSenales({
      ...base,
      activos: [req({ cliente_id: 'c1' }), req({ cliente_id: 'c2' })],
      completadosRecientes: [{ cliente_id: 'c1', completado_at: '2026-08-05T00:00:00Z' }],
    }).filter((x) => x.tipo === 'cuenta_silenciosa');
    expect(s.map((x) => x.entidad_id)).toEqual(['c2']);
  });

  it('compromiso_vencido con fecha pasada y pendiente', () => {
    const s = calcularSenales({
      ...base,
      acuerdosAbiertos: [
        { id: 'a1', tenant_id: 't', semana_id: 's', descripcion: 'Investigación comercial Foligain', responsable_id: 'u1', fecha_compromiso: '2026-08-07', estado: 'pendiente', cerrado_at: null, created_at: '' },
        { id: 'a2', tenant_id: 't', semana_id: 's', descripcion: 'Otro', responsable_id: 'u2', fecha_compromiso: '2026-08-20', estado: 'pendiente', cerrado_at: null, created_at: '' },
      ],
    }).filter((x) => x.tipo === 'compromiso_vencido');
    expect(s).toHaveLength(1);
    expect(s[0]?.titulo).toContain('Foligain');
  });

  it('sobrecarga_proyectada usa capacidad declarada', () => {
    const activos = Array(11).fill(0).map(() => req({ owner_agencia: ['u1'] })); // 44h > 40h
    const s = calcularSenales({ ...base, activos }).filter((x) => x.tipo === 'sobrecarga_proyectada');
    expect(s.map((x) => x.entidad_id)).toEqual(['u1']);
  });

  it('sin_movimiento y atraso_critico con umbrales parametrizables', () => {
    const s = calcularSenales({
      ...base,
      activos: [req({ dias_sin_movimiento: 15 }), req({ dias_atraso: 31 })],
      umbrales: { sin_movimiento_dias: 20 },
    });
    expect(s.some((x) => x.tipo === 'sin_movimiento')).toBe(false);
    expect(s.some((x) => x.tipo === 'atraso_critico')).toBe(true);
  });

  it('ordena por severidad', () => {
    const s = calcularSenales({ ...base, activos: [req({ dias_sin_movimiento: 15 }), req({ dias_atraso: 40 })] });
    expect(s[0]?.severidad).toBe('critica');
    expect(s[s.length - 1]?.severidad).toBe('media');
  });
});
