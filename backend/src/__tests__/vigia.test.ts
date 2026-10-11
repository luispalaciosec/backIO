import { beforeEach, describe, expect, it, vi } from 'vitest';

const e = vi.hoisted(() => ({
  registradas: new Set<string>(),
  ultimas: new Map<string, { job: string; inicio_at: string; fin_at: string | null; ok: boolean | null }>(),
  inicio: 0 as number | null,
  reclamadas: new Set<string>(),
  notificar: vi.fn(),
}));
vi.mock('../lib/db/cron_runs', () => ({
  ventanasRegistradas: async (pares: { job: string; ventana: string }[]) =>
    new Set(pares.map((p) => `${p.job}|${p.ventana}`).filter((k) => e.registradas.has(k))),
  ultimasCorridas: async () => e.ultimas,
  inicioDelRegistro: async () => e.inicio,
  tenantsActivos: async () => ['t1'],
  reclamarVentana: async (job: string, ventana: string) =>
    !e.reclamadas.has(`${job}|${ventana}`) && !!e.reclamadas.add(`${job}|${ventana}`),
}));
vi.mock('../lib/notificaciones', () => ({ notificar: e.notificar }));

import { aLas, cada, type Job } from '../lib/jobs';
import { revisarJobs, ventanasCerradas, vigilar } from '../lib/vigia';

const ms = (iso: string) => Date.parse(iso); // iso con -05:00
const senales: Job = {
  nombre: 'senales',
  descripcion: 'Señales del weekly',
  ventana: aLas(18, 0, { cuando: (m) => m.dia === 0 }),
  ejecutar: async () => 0,
};
const reconcile: Job = { nombre: 'reconcile', descripcion: 'Reconciliación', ventana: cada(30), intervaloMin: 30, ejecutar: async () => 0 };
const notif: Job = { nombre: 'notificaciones', descripcion: 'Correos', ventana: cada(1), registrar: false, ejecutar: async () => 0 };
const jobs = [senales, reconcile, notif];

beforeEach(() => {
  e.registradas = new Set();
  // Última corrida de reconcile a las 20:00 de Guayaquil: al día.
  e.ultimas = new Map([['reconcile', { job: 'reconcile', inicio_at: '2026-10-12T01:00:00Z', fin_at: null, ok: true }]]);
  e.inicio = ms('2026-10-01T00:00:00-05:00');
  e.reclamadas = new Set();
  e.notificar.mockReset().mockResolvedValue(1);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

// Deuda técnica §8.2: avisar si un job no corre. Domingo 11/10, señales a las 18:00 con 2 h de tolerancia.
describe('vigía de jobs', () => {
  it('detecta la ventana de hora fija que cerró sin registro', async () => {
    const p = await revisarJobs(jobs, ms('2026-10-11T20:30:00-05:00'));
    expect(p).toEqual([expect.objectContaining({ job: 'senales', clave: '2026-10-11' })]);
  });
  it('si corrió, no hay problema', async () => {
    e.registradas.add('senales|2026-10-11');
    expect(await revisarJobs(jobs, ms('2026-10-11T20:30:00-05:00'))).toEqual([]);
  });
  it('no juzga una ventana todavía abierta ni las anteriores al registro', () => {
    expect(ventanasCerradas([senales], ms('2026-10-11T19:00:00-05:00'))).toEqual([]);
    expect(ventanasCerradas([senales], ms('2026-10-11T20:30:00-05:00'), ms('2026-10-11T21:00:00-05:00'))).toEqual([]);
  });
  it('job de intervalo sin corridas en tres intervalos', async () => {
    e.ultimas = new Map([['reconcile', { job: 'reconcile', inicio_at: '2026-10-11T19:00:00Z', fin_at: null, ok: true }]]);
    e.registradas.add('senales|2026-10-11');
    const p = await revisarJobs(jobs, ms('2026-10-11T20:30:00-05:00'));
    expect(p).toEqual([expect.objectContaining({ job: 'reconcile', clave: 'atraso:2026-10-11', detalle: 'Última corrida hace 390 min.' })]);
  });
  it('avisa a admin una sola vez por problema', async () => {
    const ahora = ms('2026-10-11T20:30:00-05:00');
    expect(await vigilar(jobs, ahora)).toEqual({ problemas: 1, avisados: 1 });
    expect(await vigilar(jobs, ahora + 3600_000)).toEqual({ problemas: 1, avisados: 0 });
    expect(e.notificar).toHaveBeenCalledTimes(1);
    expect(e.notificar).toHaveBeenCalledWith(
      { tenantId: 't1' },
      expect.objectContaining({ tipo: 'job_sin_correr', ruta: '/admin/servicios' }),
      { roles: ['admin'] },
    );
  });
});
