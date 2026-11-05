import { describe, expect, it } from 'vitest';
import type { Senal } from '@backio/shared';
import { armarProyectosWeekly, grupoDeTarea } from '../lib/rituals/proyectos_weekly';

const hoy = '2026-11-04';
const fin = '2026-11-08';
const r = (id: string, p: Record<string, unknown> = {}) =>
  ({
    id,
    titulo_interno: `Tarea ${id}`,
    cliente_id: 'c1',
    proyecto_id: 'p1',
    owner_agencia: ['ana'],
    fecha_entrega: '2026-12-01',
    fecha_entrega_original: null,
    estado_operativo: 'en_ejecucion',
    estado_aprobacion: 'no_aplica',
    dias_atraso: 0,
    dias_sin_movimiento: 0,
    veces_reprogramado: 0,
    basecamp_url: null,
    ...p,
  }) as never;
const base = {
  proyectos: [
    { id: 'p1', nombre: 'Factoring', basecamp_todolist_id: 9 },
    { id: 'p2', nombre: 'Social' },
    { id: 'p3', nombre: 'Autoplan' },
  ],
  clientes: [
    { id: 'c1', nombre: 'Banco', ejecutiva_id: 'caro', basecamp_project_id: 5 },
    { id: 'c2', nombre: 'Otro', ejecutiva_id: null, basecamp_project_id: null },
  ],
  senales: [] as Senal[],
  acuerdos: [],
  hoy,
  finSemana: fin,
};
const senal = (p: Partial<Senal>) => ({ tipo: 'x', severidad: 'alta', titulo: 'S', detalle: {}, atendida: false, ...p }) as Senal;

describe('cada tarea cae en un solo grupo', () => {
  it('lo bloqueado manda, aunque esté atrasado; lo que espera al cliente no cuenta como atraso nuestro', () => {
    expect(grupoDeTarea(r('a', { estado_operativo: 'bloqueado', dias_atraso: 9 }), hoy, fin)).toBe('bloqueada');
    expect(grupoDeTarea(r('a', { estado_aprobacion: 'pendiente_cliente', dias_atraso: 9 }), hoy, fin)).toBe('espera_cliente');
  });
  it('separa lo atrasado en marcha de lo que lleva días quieto', () => {
    expect(grupoDeTarea(r('a', { dias_atraso: 3, dias_sin_movimiento: 2 }), hoy, fin)).toBe('atrasada');
    expect(grupoDeTarea(r('a', { dias_atraso: 30, dias_sin_movimiento: 30 }), hoy, fin)).toBe('quieta');
  });
  it('lo sin responsable se pide, y lo demás va por su fecha', () => {
    expect(grupoDeTarea(r('a', { owner_agencia: [] }), hoy, fin)).toBe('sin_responsable');
    expect(grupoDeTarea(r('a', { fecha_entrega: '2026-11-06' }), hoy, fin)).toBe('esta_semana');
    expect(grupoDeTarea(r('a'), hoy, fin)).toBe('resto');
  });
});

describe('agenda por proyecto', () => {
  const armar = (activos: never[], extra = {}) => armarProyectosWeekly({ ...base, activos, ...extra });
  const uno = (activos: never[]) => armar(activos).clientes[0]!.proyectos[0]!;

  it('el estado sale de las tareas y el motivo lo dice en palabras', () => {
    expect(uno([r('a', { estado_operativo: 'bloqueado' }), r('b', { dias_atraso: 2 })])).toMatchObject({
      estado: 'rojo',
      motivo: '1 bloqueada · 1 atrasada',
      abiertas: 2,
    });
    expect(uno([r('a', { estado_aprobacion: 'pendiente_cliente' }), r('b', { estado_aprobacion: 'pendiente_cliente' })])).toMatchObject({
      estado: 'amarillo',
      motivo: '2 esperan al cliente',
    });
    expect(uno([r('a', { fecha_entrega: '2026-11-06' })])).toMatchObject({ estado: 'verde', motivo: 'Va bien: 1 sale esta semana' });
  });
  it('ordena lo que necesita decisión primero, en proyectos y en clientes', () => {
    const d = armar([
      r('v', { proyecto_id: 'p3' }),
      r('a', { proyecto_id: 'p2', estado_aprobacion: 'pendiente_cliente' }),
      r('x', { proyecto_id: 'p1', dias_atraso: 2 }),
      r('o', { cliente_id: 'c2', proyecto_id: null }),
    ]);
    expect(d.clientes.map((c) => c.nombre)).toEqual(['Banco', 'Otro']);
    expect(d.clientes[0]!.proyectos.map((p) => p.nombre)).toEqual(['Factoring', 'Social', 'Autoplan']);
    expect(d.clientes[1]!.proyectos[0]!.nombre).toBe('Sin proyecto');
    expect(d.resumen).toEqual({ rojo: 1, amarillo: 1, verde: 2 });
  });
  it('la señal de una tarea va dentro de ella; las demás no se pierden', () => {
    const d = armar([r('a')], {
      senales: [
        senal({ entidad_tipo: 'requerimiento', entidad_id: 'a' }),
        senal({ entidad_tipo: 'usuario', entidad_id: 'ana' }),
        senal({ entidad_tipo: 'cliente', entidad_id: 'c1' }),
        senal({ entidad_tipo: 'requerimiento', entidad_id: 'cerrada' }),
      ],
    });
    const p = d.clientes[0]!.proyectos[0]!;
    expect(p.tareas[0]!.senales).toHaveLength(1);
    expect(p.senales_por_atender).toBe(1);
    expect(d.otras_senales.map((s) => s.entidad_id)).toEqual(['ana', 'c1', 'cerrada']);
  });
  it('el resumen trae avance, el mayor atraso y cuántas tareas tiene cada persona', () => {
    const p = armar([r('a', { dias_atraso: 4 }), r('b', { dias_atraso: 9, owner_agencia: ['ana', 'beto'] })], {
      proyectos: [{ id: 'p1', nombre: 'Factoring', avance: 73 }],
    }).clientes[0]!.proyectos[0]!;
    expect(p).toMatchObject({
      avance: 73,
      atraso_maximo: 9,
      carga: [
        { usuario_id: 'ana', tareas: 2 },
        { usuario_id: 'beto', tareas: 1 },
      ],
    });
  });
  it('suma las horas del proyecto, también de tareas cerradas, y las de esta semana', () => {
    const fila = (requerimiento_id: string, horas: number, proyecto_id: string | null = 'p1') => ({
      requerimiento_id,
      horas,
      requerimientos: { proyecto_id },
    });
    const p = armar([r('a')], {
      horas: { total: [fila('a', 2.5), fila('cerrada', 10), fila('otra', 7, 'p2')], semana: [fila('a', 1)] },
    }).clientes[0]!.proyectos[0]!;
    expect(p.horas).toEqual({ total: 12.5, semana: 1 });
    expect(p.tareas[0]!.horas).toBe(2.5);
  });
  it('muestra los acuerdos abiertos del proyecto y de sus tareas, y el enlace a Basecamp', () => {
    const p = armar([r('a')], {
      acuerdos: [
        { id: '1', descripcion: 'Del proyecto', responsable_id: 'ana', fecha_compromiso: fin, proyecto_id: 'p1' },
        { id: '2', descripcion: 'De la tarea', responsable_id: 'ana', fecha_compromiso: fin, requerimiento_id: 'a' },
        { id: '3', descripcion: 'De otro', responsable_id: 'ana', fecha_compromiso: fin, proyecto_id: 'p2' },
      ],
      urlLista: (b: number, l: number) => `bc/${b}/${l}`,
    }).clientes[0]!.proyectos[0]!;
    expect(p.acuerdos.map((a) => a.id)).toEqual(['1', '2']);
    expect(p.basecamp_url).toBe('bc/5/9');
  });
});
