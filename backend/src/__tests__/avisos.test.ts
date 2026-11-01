import { describe, expect, it } from 'vitest';
import type { RequerimientoMetricas } from '@backio/shared';
import { armarCuentas, armarMiDia, resumenMiDia } from '../lib/mi_dia';
import { cambiosDeSalud, textoCambio, type FotoSalud } from '../lib/salud_clientes';
import { rutaPermitida } from '../lib/notificaciones';

const r = (p: Partial<RequerimientoMetricas>) =>
  ({
    id: Math.random().toString(36).slice(2),
    cliente_id: 'c',
    titulo_interno: 'Tarea',
    daily_fecha: null,
    fecha_entrega: '2026-11-10',
    estado_operativo: 'en_ejecucion',
    estado_aprobacion: 'no_aplica',
    dias_atraso: 0,
    dias_sin_movimiento: 0,
    entregado_el: null,
    ...p,
  }) as RequerimientoMetricas;

// docs/22 · Fase 2 de las mejoras (30/10/2026).
describe('Mi día', () => {
  const hoy = '2026-10-30';
  it('arma hoy, lo que vence hoy o mañana, lo atrasado, lo bloqueado, lo que espera al cliente y lo que hay que confirmar', () => {
    const m = armarMiDia(
      [
        r({ titulo_interno: 'Selección', daily_fecha: hoy }),
        r({ titulo_interno: 'Vence', fecha_entrega: '2026-10-31' }),
        r({ titulo_interno: 'Vieja', fecha_entrega: '2026-10-20', dias_atraso: 10, dias_sin_movimiento: 5 }),
        r({ titulo_interno: 'Bloq', estado_operativo: 'bloqueado' }),
        r({ titulo_interno: 'Espera', estado_aprobacion: 'pendiente_cliente', dias_atraso: 3, dias_sin_movimiento: 9 }),
      ],
      hoy,
    );
    expect(m.hoy.map((x) => x.titulo_interno)).toEqual(['Selección']);
    expect(m.vencen.map((x) => x.titulo_interno)).toEqual(['Vence']);
    expect(m.atrasadas.map((x) => x.titulo_interno)).toEqual(['Vieja', 'Espera']);
    expect(m.preguntar.map((x) => x.titulo_interno)).toEqual(['Vieja']);
    expect(m.bloqueadas).toHaveLength(1);
    expect(m.esperando_cliente).toHaveLength(1);
  });
  it('el correo resume con el nombre del cliente y no se envía si no hay nada', () => {
    const m = armarMiDia([r({ titulo_interno: 'Post', daily_fecha: hoy })], hoy);
    expect(resumenMiDia(m, () => 'Foligain')).toEqual({ titulo: 'Tu día: 1 para hoy', cuerpo: 'Hoy trabajas en 1: Post (Foligain).' });
    expect(resumenMiDia(armarMiDia([], hoy), () => '')).toBeNull();
  });
});

describe('aviso de cambio de salud', () => {
  const foto = (salud: FotoSalud['salud'], motivos: string[] = []): FotoSalud => ({ cliente_id: 'f', cliente: 'Foligain', salud, motivos });
  it('avisa solo si cambió el color respecto del último registro; sin registro previo, no avisa', () => {
    expect(cambiosDeSalud([foto('amarillo', ['2 tareas atrasadas'])], new Map([['f', 'verde']]))).toHaveLength(1);
    expect(cambiosDeSalud([foto('verde')], new Map([['f', 'verde']]))).toHaveLength(0);
    expect(cambiosDeSalud([foto('rojo')], new Map())).toHaveLength(0);
  });
  it('dice el porqué cuando empeora y lo dice cuando mejora', () => {
    expect(textoCambio({ ...foto('amarillo', ['2 tareas atrasadas']), antes: 'verde' })).toEqual({
      titulo: 'Foligain pasó de verde a amarillo',
      cuerpo: 'Por qué: 2 tareas atrasadas.',
    });
    expect(textoCambio({ ...foto('verde'), antes: 'rojo' }).cuerpo).toBe('Mejoró: ya no tiene motivos de alerta.');
  });
  it('los avisos pueden enlazar a la ficha del cliente y a Mi día', () => {
    expect(rutaPermitida('/clientes/abc')).toBe('/clientes/abc');
    expect(rutaPermitida('/mi-dia')).toBe('/mi-dia');
  });
});

// Mi día de Grace del 30/10/2026: siendo ejecutiva, solo veía la única tarea donde era responsable.
describe('Mi día de una ejecutiva: tus cuentas', () => {
  const hoy = '2026-10-30';
  const cuentas = armarCuentas(
    [
      r({ id: 'a1', titulo_interno: 'Reel 02', dias_atraso: 2 }),
      r({ id: 'a2', titulo_interno: 'Reel 07', dias_atraso: 9 }),
      r({ id: 'e1', titulo_interno: 'Landing', estado_aprobacion: 'pendiente_cliente', dias_atraso: 40, dias_sin_movimiento: 3 }),
      r({ id: 'e2', titulo_interno: 'Fotos', estado_aprobacion: 'pendiente_cliente', dias_sin_movimiento: 12 }),
      r({ id: 'ok', titulo_interno: 'Al día' }),
    ],
    new Map([['e1', 44]]),
  );
  it('atrasado (sin lo que espera al cliente) y lo que espera al cliente, lo más antiguo primero', () => {
    expect(cuentas.atrasadas.map((x) => x.id)).toEqual(['a2', 'a1']);
    expect(cuentas.esperando_cliente.map((x) => [x.id, x.dias_esperando])).toEqual([
      ['e1', 44],
      ['e2', 12],
    ]);
  });
  it('el correo lo cuenta aunque no tenga tareas propias', () => {
    const t = resumenMiDia({ ...armarMiDia([], hoy), cuentas }, () => '');
    expect(t?.titulo).toBe('Tu día: 2 esperan al cliente');
    expect(t?.cuerpo).toBe('Tus cuentas: 2 tareas atrasadas; 2 esperan al cliente (la más antigua hace 44 d): pide el feedback.');
  });
});
