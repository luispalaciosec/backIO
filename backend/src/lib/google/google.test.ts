import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.GOOGLE_CLIENT_ID = 'cliente-prueba';
  process.env.GOOGLE_CLIENT_SECRET = 'secreto-prueba';
  process.env.GOOGLE_REDIRECT_URI = 'https://backend.example.test/api/google/oauth/callback';
});

const { eventoSeguro } = await import('./calendar');
const { estadoGoogle, verificarEstadoGoogle, urlAutorizacionGoogle } = await import('./oauth');
const { clientePorDominio } = await import('../reuniones');

describe('evento de Google sin texto (regla 1)', () => {
  const crudo = {
    id: 'ev1',
    status: 'confirmed',
    summary: 'Reunión con el cliente: esto está horrible',
    description: 'notas internas',
    location: 'Oficina del cliente',
    start: { dateTime: '2026-11-24T09:00:00-05:00' },
    end: { dateTime: '2026-11-24T10:30:00-05:00' },
    attendees: [
      { email: 'ejecutiva@geeks.com.ec', self: true, responseStatus: 'accepted' },
      { email: 'gerente@bancoamazonas.com', responseStatus: 'accepted', displayName: 'Gerente' },
      { email: 'otra@bancoamazonas.com' },
      { email: 'disenador@geeks.com.ec' },
      { email: 'c_123@resource.calendar.google.com' },
    ],
  };

  it('solo horario, estado, respuesta y dominios externos; nunca título, notas, lugar ni correos', () => {
    const e = eventoSeguro(crudo as never, 'geeks.com.ec');
    expect(e).toEqual({
      id: 'ev1',
      inicio: '2026-11-24T09:00:00-05:00',
      fin: '2026-11-24T10:30:00-05:00',
      todo_el_dia: false,
      cancelado: false,
      respuesta: 'aceptada',
      dominios_externos: ['bancoamazonas.com'],
    });
    expect(JSON.stringify(e)).not.toMatch(/horrible|notas|Oficina|gerente@|Gerente|ejecutiva@/);
  });

  it('todo el día, rechazado y sin invitados', () => {
    expect(eventoSeguro({ id: 'a', start: { date: '2026-11-24' }, end: { date: '2026-11-25' } }, 'geeks.com.ec')?.todo_el_dia).toBe(true);
    expect(
      eventoSeguro({ ...crudo, attendees: [{ email: 'yo@geeks.com.ec', self: true, responseStatus: 'declined' }] } as never, 'geeks.com.ec')
        ?.respuesta,
    ).toBe('rechazada');
    expect(eventoSeguro({ id: 'b', start: crudo.start, end: crudo.end }, 'geeks.com.ec')).toMatchObject({
      respuesta: 'aceptada',
      dominios_externos: [],
    });
  });
});

describe('state firmado de Google', () => {
  it('vuelve con tenant y persona; uno alterado o vencido no sirve', () => {
    const s = estadoGoogle('t1', 'u1', 1_000);
    expect(verificarEstadoGoogle(s, 2_000)).toEqual({ tenantId: 't1', usuarioId: 'u1' });
    expect(verificarEstadoGoogle(s, 1_000 + 11 * 60_000)).toBeNull();
    const [p] = s.split('.');
    const otro = Buffer.from(JSON.stringify({ t: 't1', u: 'u2', n: 'x', e: 9e15 })).toString('base64url');
    expect(verificarEstadoGoogle(`${otro}.${s.split('.')[1]}`, 2_000)).toBeNull();
    expect(verificarEstadoGoogle(`${p}.firma-falsa`, 2_000)).toBeNull();
  });

  it('pide solo lectura de eventos y el correo', () => {
    const u = new URL(urlAutorizacionGoogle('st', 'yo@geeks.com.ec'));
    expect(u.searchParams.get('scope')).toBe('openid email https://www.googleapis.com/auth/calendar.events.readonly');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('login_hint')).toBe('yo@geeks.com.ec');
  });
});

describe('cliente por dominio', () => {
  it('el primer dominio que coincide; sin coincidencia es interna', () => {
    const m = new Map([['bancoamazonas.com', 'c1']]);
    expect(clientePorDominio(['otro.com', 'BancoAmazonas.com'], m)).toBe('c1');
    expect(clientePorDominio(['otro.com'], m)).toBeNull();
    expect(clientePorDominio([], m)).toBeNull();
  });
});
