import { beforeEach, describe, expect, it, vi } from 'vitest';

const registro = vi.hoisted(() => ({ filas: new Map<string, { ok?: boolean; detalle?: string }>() }));
vi.mock('../lib/db/cron_runs', () => ({
  tenantsActivos: async () => ['t1'],
  clientesConBasecamp: async () => [],
  limpiarCronRuns: async () => undefined,
  reclamarVentana: async (job: string, ventana: string) => {
    const k = `${job}|${ventana}`;
    if (registro.filas.has(k)) return false;
    registro.filas.set(k, {});
    return true;
  },
  cerrarVentana: async (job: string, ventana: string, ok: boolean, detalle: string) =>
    void registro.filas.set(`${job}|${ventana}`, { ok, detalle }),
}));

import { aLas, cada, ejecutarJob, JOBS, mesAnterior, momentoLocal, type Job } from '../lib/jobs';

const gye = (iso: string) => momentoLocal(new Date(iso)); // iso con -05:00

beforeEach(() => registro.filas.clear());

describe('ventanas de los jobs (B10)', () => {
  it('momento en hora de Guayaquil', () => {
    expect(gye('2026-10-11T18:00:00-05:00')).toMatchObject({ dia: 0, hora: 18, minuto: 0, clave: '2026-10-11' });
    expect(gye('2026-10-12T00:30:00-05:00')).toMatchObject({ dia: 1, hora: 0, minuto: 30 });
  });
  it('un job de hora fija se recupera si el tick de su minuto se perdió (despliegue a las 18:00)', () => {
    const senales = JOBS.find((j) => j.nombre === 'senales')!;
    expect(senales.ventana(gye('2026-10-11T17:59:00-05:00'))).toBeNull();
    expect(senales.ventana(gye('2026-10-11T18:03:00-05:00'))).toBe('2026-10-11');
    // Fuera de la tolerancia (y en otro día) no se dispara: el primer arranque no corre jobs viejos.
    expect(senales.ventana(gye('2026-10-11T21:00:00-05:00'))).toBeNull();
    expect(senales.ventana(gye('2026-10-12T18:00:00-05:00'))).toBeNull();
  });
  it('filtros de día: laborables y día 1', () => {
    expect(aLas(19, 30, { cuando: (m) => m.dia >= 1 && m.dia <= 5 })(gye('2026-10-10T19:31:00-05:00'))).toBeNull(); // sábado
    const informe = JOBS.find((j) => j.nombre === 'kpis_congelar')!;
    expect(informe.ventana(gye('2026-11-01T08:10:00-05:00'))).toBe('2026-11-01');
    expect(informe.ventana(gye('2026-11-02T08:10:00-05:00'))).toBeNull();
  });
  it('intervalos: misma ventana dentro del tramo, otra en el siguiente', () => {
    const v = cada(30);
    expect(v(gye('2026-10-10T10:01:00-05:00'))).toBe(v(gye('2026-10-10T10:29:00-05:00')));
    expect(v(gye('2026-10-10T10:29:00-05:00'))).not.toBe(v(gye('2026-10-10T10:31:00-05:00')));
  });
  it('mes anterior', () => {
    expect(mesAnterior('2026-01-01')).toBe('2025-12');
    expect(mesAnterior('2026-10-01')).toBe('2026-09');
  });
});

describe('ejecutarJob', () => {
  const crear = (ejecutar: Job['ejecutar']): Job => ({ nombre: 'prueba', descripcion: '', ventana: aLas(8, 0), ejecutar });
  const m = gye('2026-10-12T08:01:00-05:00');

  it('corre una sola vez por ventana aunque dos procesos lo intenten', async () => {
    const fn = vi.fn(async () => 'ok');
    const job = crear(fn);
    const [a, b] = await Promise.all([ejecutarJob(job, m), ejecutarJob(job, m)]);
    expect(fn).toHaveBeenCalledOnce();
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await ejecutarJob(job, gye('2026-10-12T08:30:00-05:00'))).toBeNull();
  });
  it('un fallo queda registrado y no se propaga', async () => {
    const job = crear(async () => {
      throw new Error('Supabase caído');
    });
    expect(await ejecutarJob(job, m)).toEqual({ ventana: '2026-10-12', resultado: { error: 'Supabase caído' } });
    expect(registro.filas.get('prueba|2026-10-12')).toEqual({ ok: false, detalle: 'Supabase caído' });
  });
  it('errores parciales (un tenant) marcan la corrida como no ok', async () => {
    await ejecutarJob(
      crear(async () => ({ t1: { error: 'x' }, t2: 3 })),
      m,
    );
    expect(registro.filas.get('prueba|2026-10-12')?.ok).toBe(false);
  });
  it('fuera de su hora no corre; manual sí', async () => {
    const fn = vi.fn(async () => 1);
    expect(await ejecutarJob(crear(fn), gye('2026-10-12T07:00:00-05:00'))).toBeNull();
    expect(await ejecutarJob(crear(fn), gye('2026-10-12T07:00:00-05:00'), { manual: true })).toMatchObject({ resultado: 1 });
  });
});
