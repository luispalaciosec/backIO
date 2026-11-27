import { describe, expect, it } from 'vitest';
import { horasDeReunion, ocurrencias } from './reuniones';
import { BasecampClient, type EventoBasecampSafe } from './basecamp/client';

const ev = (p: Partial<EventoBasecampSafe>): EventoBasecampSafe => ({
  id: 1,
  inicio: '2026-11-24T14:00:00Z', // 09:00 en Guayaquil, martes
  fin: '2026-11-24T15:30:00Z',
  todo_el_dia: false,
  participantes: [10],
  repeticion: null,
  ...p,
});

describe('ocurrencias de un evento', () => {
  it('un evento sin repetición, solo si cae en la ventana', () => {
    expect(ocurrencias(ev({}), '2026-11-20', '2026-11-30')).toEqual([
      { externo: '1', inicio: '2026-11-24T14:00:00.000Z', fin: '2026-11-24T15:30:00.000Z' },
    ]);
    expect(ocurrencias(ev({}), '2026-11-25', '2026-11-30')).toEqual([]);
  });

  it('los de todo el día no cuentan (no tienen duración)', () => {
    expect(ocurrencias(ev({ todo_el_dia: true }), '2026-11-01', '2026-11-30')).toEqual([]);
  });

  it('semanal: una por semana, a la misma hora, con la fecha en el id', () => {
    const o = ocurrencias(
      ev({ repeticion: { frecuencia: 'every_week', dias: [], cada_semanas: 1, desde: null, hasta: null } }),
      '2026-11-20',
      '2026-12-10',
    );
    expect(o.map((x) => x.externo)).toEqual(['1:2026-11-24', '1:2026-12-01', '1:2026-12-08']);
    expect(o[1]).toEqual({ externo: '1:2026-12-01', inicio: '2026-12-01T14:00:00.000Z', fin: '2026-12-01T15:30:00.000Z' });
  });

  it('semanal en varios días, cada dos semanas y con fin', () => {
    const o = ocurrencias(
      ev({ repeticion: { frecuencia: 'every_week', dias: [2, 4], cada_semanas: 2, desde: null, hasta: '2026-12-10' } }),
      '2026-11-01',
      '2026-12-31',
    );
    expect(o.map((x) => x.externo)).toEqual(['1:2026-11-24', '1:2026-11-26', '1:2026-12-08', '1:2026-12-10']);
  });

  it('diaria y mensual', () => {
    expect(
      ocurrencias(
        ev({ repeticion: { frecuencia: 'every_day', dias: [], cada_semanas: 1, desde: null, hasta: null } }),
        '2026-11-24',
        '2026-11-26',
      ),
    ).toHaveLength(3);
    expect(
      ocurrencias(
        ev({ repeticion: { frecuencia: 'every_month', dias: [], cada_semanas: 1, desde: null, hasta: null } }),
        '2026-11-01',
        '2027-01-31',
      ).map((x) => x.externo),
    ).toEqual(['1:2026-11-24', '1:2026-12-24', '1:2027-01-24']);
  });
});

describe('horas de reunión por persona y día', () => {
  it('suma lo que no se pisa y cuenta una vez lo que se pisa (Basecamp y Google a la vez)', () => {
    const h = horasDeReunion([
      { usuario_id: 'u1', inicio: '2026-11-24T14:00:00Z', fin: '2026-11-24T15:00:00Z' }, // 9-10
      { usuario_id: 'u1', inicio: '2026-11-24T14:30:00Z', fin: '2026-11-24T15:30:00Z' }, // 9:30-10:30, se pisa
      { usuario_id: 'u1', inicio: '2026-11-24T19:00:00Z', fin: '2026-11-24T20:00:00Z' }, // 14-15
      { usuario_id: 'u2', inicio: '2026-11-24T14:00:00Z', fin: '2026-11-24T15:00:00Z' },
    ]);
    expect(h.get('u1|2026-11-24')).toBe(2.5);
    expect(h.get('u2|2026-11-24')).toBe(1);
  });

  it('el día es el de Guayaquil: una reunión a las 20:00 locales es de ese día', () => {
    const h = horasDeReunion([{ usuario_id: 'u1', inicio: '2026-11-25T01:00:00Z', fin: '2026-11-25T02:00:00Z' }]);
    expect(h.get('u1|2026-11-24')).toBe(1);
  });
});

describe('scheduleEntriesSafe (regla 1)', () => {
  it('nunca devuelve el título, la descripción ni las notas', async () => {
    const bc = Object.create(BasecampClient.prototype) as BasecampClient;
    (bc as unknown as { requestAll: () => Promise<unknown[]> }).requestAll = async () => [
      {
        id: 7,
        title: 'Reunión con el cliente: esto está horrible',
        description: '<div>notas internas</div>',
        summary: 'resumen',
        starts_at: '2026-11-24T14:00:00Z',
        ends_at: '2026-11-24T15:00:00Z',
        all_day: false,
        participants: [{ id: 10, name: 'Persona', email_address: 'p@geeks.com.ec' }],
        creator: { id: 10, name: 'Persona' },
        recurrence_schedule: null,
      },
    ];
    const r = await bc.scheduleEntriesSafe(1, 2);
    expect(r).toEqual([
      { id: 7, inicio: '2026-11-24T14:00:00Z', fin: '2026-11-24T15:00:00Z', todo_el_dia: false, participantes: [10], repeticion: null },
    ]);
    expect(JSON.stringify(r)).not.toMatch(/horrible|notas|resumen|Persona|geeks/);
  });
});
