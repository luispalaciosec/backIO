/**
 * Auditoría run-1, rls:notificaciones_update_propias: el dueño de una notificación puede editar su fila por PostgREST
 * (email_destino, título, cuerpo). El envío debe ir SIEMPRE al correo actual del usuario, nunca al email_destino guardado.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.NODE_ENV = 'test';

const T = 't1';
let FILAS: Record<string, unknown>[] = [];
const USUARIOS = [
  { id: 'u1', email: 'ana@geeks.com.ec', tenant_id: T, activo: true },
  { id: 'u2', email: 'beto@geeks.com.ec', tenant_id: T, activo: false },
  { id: 'u3', email: 'otra@tenant2.com', tenant_id: 't2', activo: true },
];
const enviados: string[] = [];
const updates: Record<string, unknown>[] = [];

vi.mock('../lib/db/client', async (orig) => {
  const mod = await orig<typeof import('../lib/db/client')>();
  const fake = () => ({
    from(tabla: string) {
      let upd: Record<string, unknown> | null = null;
      const b = {
        select: () => b, eq: () => b, is: () => b, lt: () => b, order: () => b, limit: () => b, in: () => b,
        update: (o: Record<string, unknown>) => { upd = o; return b; },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          if (upd) { updates.push(upd); return Promise.resolve({ error: null }).then(res, rej); }
          return Promise.resolve({ data: tabla === 'usuarios' ? USUARIOS : FILAS, error: null }).then(res, rej);
        },
      };
      return b;
    },
  });
  return { ...mod, serviceClient: () => fake() as never };
});
vi.mock('../lib/notificaciones/email', () => ({
  emailHabilitado: () => true,
  plantillaHtml: (t: string) => t,
  sendEmail: async (m: { to: string }) => { enviados.push(m.to); return { id: 'x' }; },
}));

const fila = (p: Record<string, unknown>) => ({ id: 'n1', tenant_id: T, usuario_id: 'u1', email_destino: 'ana@geeks.com.ec', titulo: 'Hola', cuerpo: 'c', intentos: 0, ...p });

describe('procesarPendientes: destinatario', () => {
  beforeEach(() => { enviados.length = 0; updates.length = 0; });

  it('control: una notificación normal llega al usuario', async () => {
    FILAS = [fila({})];
    const { procesarPendientes } = await import('../lib/notificaciones');
    expect(await procesarPendientes()).toEqual({ enviadas: 1, fallidas: 0 });
    expect(enviados).toEqual(['ana@geeks.com.ec']);
  });

  it('ignora un email_destino manipulado: envía al correo del usuario, no al tercero', async () => {
    FILAS = [fila({ email_destino: 'victima@externo.com', titulo: 'Verifica tu cuenta' })];
    const { procesarPendientes } = await import('../lib/notificaciones');
    await procesarPendientes();
    expect(enviados).toEqual(['ana@geeks.com.ec']);
    expect(enviados).not.toContain('victima@externo.com');
  });

  it('no envía si la fila no tiene usuario, si el usuario está inactivo o es de otro tenant', async () => {
    FILAS = [fila({ id: 'a', usuario_id: null, email_destino: 'x@externo.com' }), fila({ id: 'b', usuario_id: 'u2' }), fila({ id: 'c', usuario_id: 'u3', email_destino: 'otra@tenant2.com' })];
    const { procesarPendientes } = await import('../lib/notificaciones');
    await procesarPendientes();
    expect(enviados).toEqual([]);
    expect(updates.every((u) => u.ultimo_error === 'sin destinatario válido')).toBe(true);
  });
});
