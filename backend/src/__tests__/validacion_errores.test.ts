import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { urlHttps, zValidator } from '../lib/validacion';

// B3: el validador devolvía el ZodError entero en `error` y la pantalla mostraba «[object Object]».
describe('errores de validación legibles', () => {
  const app = new Hono().post('/x', zValidator('json', z.object({ fecha_entrega: z.string().date(), piezas: z.number().int() })), (c) =>
    c.json(c.req.valid('json')),
  );

  it('error es texto con los campos y el detalle va aparte', async () => {
    const res = await app.request('/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fecha_entrega: 'mañana', piezas: 1.5 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: unknown; detalle: { campo: string }[] };
    expect(body.error).toBe('Revisa: fecha_entrega, piezas');
    expect(body.detalle.map((d) => d.campo)).toEqual(['fecha_entrega', 'piezas']);
  });

  it('una entrada válida pasa tipada', async () => {
    const res = await app.request('/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fecha_entrega: '2026-10-12', piezas: 2 }),
    });
    expect(await res.json()).toEqual({ fecha_entrega: '2026-10-12', piezas: 2 });
  });
});

describe('urlHttps', () => {
  it('solo acepta https', () => {
    expect(urlHttps().safeParse('https://cdn.geeks.ec/logo.png').success).toBe(true);
    for (const u of ['javascript:alert(1)', 'http://cdn/logo.png', 'data:image/png;base64,AA', 'ftp://x'])
      expect(urlHttps().safeParse(u).success).toBe(false);
  });
});
