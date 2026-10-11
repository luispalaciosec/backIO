import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { Hono } from 'hono';

const m = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://prueba.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  process.env.PROMETIO_WEBHOOK_SECRET = 'secreto-prometio';
  return {
    upsert: vi.fn(),
    getCliente: vi.fn(),
    audit: vi.fn(),
    notificar: vi.fn(),
    logo: vi.fn(),
    borrador: vi.fn(),
    plantilla: vi.fn(),
  };
});
vi.mock('../lib/db', () => ({ serviceClient: () => ({}), upsertClienteDesdePrometio: m.upsert, audit: m.audit, getCliente: m.getCliente }));
vi.mock('../lib/notificaciones', () => ({ notificar: m.notificar }));
vi.mock('../lib/db/tenants', () => ({ tenantPorDefecto: async () => 'tenant-geeks' }));
vi.mock('../lib/db/clientes', () => ({ ponerLogoSiFalta: m.logo }));
vi.mock('../lib/db/proyectos', () => ({ guardarBorradorPrometio: m.borrador, plantillaParaServicio: m.plantilla }));

import { prometioWebhook } from '../routes/webhooks/prometio';

const app = new Hono().route('/', prometioWebhook);
const enviar = (evento: string, data: unknown, o: { firma?: string; timestamp?: string } = {}) => {
  const body = JSON.stringify({ evento, timestamp: o.timestamp ?? new Date().toISOString(), data, nonce: randomUUID() });
  const firma = o.firma ?? `sha256=${createHmac('sha256', 'secreto-prometio').update(body).digest('hex')}`;
  return app.request('/', { method: 'POST', headers: { 'content-type': 'application/json', 'x-prometio-signature': firma }, body });
};
const empresa = { id: randomUUID(), nombre: 'Acme EC', activo: true };

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.upsert.mockImplementation(async (_c: unknown, e: { id: string; nombre: string }) => ({ id: e.id, nombre: e.nombre }));
  m.borrador.mockResolvedValue({ id: 'borrador-1' });
  m.plantilla.mockResolvedValue('plantilla-redes');
});

// Ola 8: el webhook de PrometIO (docs/08) solo tenía tests de firma y de montaje.
describe('webhook de PrometIO', () => {
  it('firma inválida: 401 y queda el rastro sin el cuerpo', async () => {
    const res = await enviar('empresa.creada', empresa, { firma: 'sha256=00' });
    expect(res.status).toBe(401);
    expect(m.upsert).not.toHaveBeenCalled();
    expect(m.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accion: 'webhook_rechazado',
        detalle: expect.objectContaining({ evento: 'empresa.creada', con_firma: true }),
      }),
    );
  });
  it('timestamp firmado viejo: 401 (anti-replay)', async () => {
    const res = await enviar('empresa.creada', empresa, { timestamp: new Date(Date.now() - 10 * 60_000).toISOString() });
    expect(res.status).toBe(401);
  });
  it('empresa.creada: cliente con el mismo id de PrometIO; el logo solo si viene', async () => {
    expect((await enviar('empresa.creada', empresa)).status).toBe(200);
    expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-geeks', origen: 'webhook:prometio' }), empresa);
    expect(m.logo).not.toHaveBeenCalled();
    await enviar('empresa.actualizada', { ...empresa, logo_url: 'https://cdn/logo.png' });
    expect(m.logo).toHaveBeenCalledWith(expect.anything(), empresa.id, 'https://cdn/logo.png');
  });
  it('cotización aprobada: solo un borrador para revisar (nunca un proyecto) y aviso a ejecutivas y operaciones', async () => {
    m.getCliente.mockResolvedValue({ id: empresa.id, nombre: 'Acme EC' });
    const res = await enviar('cotizacion.aprobada', {
      cotizacion_id: randomUUID(),
      numero: 'COT-12',
      empresa,
      valor: 1200,
      lineas: [{ servicio: 'Redes sociales', cantidad: 1 }],
    });
    expect(await res.json()).toEqual({ ok: true, borrador_id: 'borrador-1' });
    expect(m.plantilla).toHaveBeenCalledWith(expect.anything(), 'Redes sociales');
    expect(m.borrador).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cliente_id: empresa.id, plantilla_sugerida_id: 'plantilla-redes' }),
    );
    expect(m.upsert).not.toHaveBeenCalled(); // el cliente ya existía
    expect(m.notificar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tipo: 'borrador_proyecto', ruta: '/proyectos/nuevo' }),
      { roles: ['ejecutiva', 'operaciones'] },
    );
  });
  it('cotización de un cliente nuevo: lo crea con el id de PrometIO antes del borrador', async () => {
    m.getCliente.mockResolvedValue(null);
    await enviar('cotizacion.aprobada', { cotizacion_id: randomUUID(), empresa, lineas: [] });
    expect(m.upsert).toHaveBeenCalledWith(expect.anything(), empresa);
    expect(m.borrador).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ plantilla_sugerida_id: null }));
  });
  it('payload inválido: 400 auditado; evento desconocido: 200 ignorado (PrometIO no reintenta)', async () => {
    const malo = await enviar('cotizacion.aprobada', { cotizacion_id: 'no-uuid' });
    expect(malo.status).toBe(400);
    expect(m.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'webhook_payload_invalido' }));
    expect(await (await enviar('contacto.creado_formulario', {})).json()).toEqual({ ok: true, ignorado: 'contacto.creado_formulario' });
  });
  it('el mismo cuerpo dos veces se procesa una sola', async () => {
    const body = JSON.stringify({ evento: 'empresa.creada', timestamp: new Date().toISOString(), data: empresa });
    const firma = `sha256=${createHmac('sha256', 'secreto-prometio').update(body).digest('hex')}`;
    const pedir = () =>
      app.request('/', { method: 'POST', headers: { 'content-type': 'application/json', 'x-prometio-signature': firma }, body });
    await pedir();
    expect(await (await pedir()).json()).toEqual({ ok: true, duplicado: true });
    expect(m.upsert).toHaveBeenCalledTimes(1);
  });
});
