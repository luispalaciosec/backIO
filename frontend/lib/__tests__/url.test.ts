import { afterEach, describe, expect, it, vi } from 'vitest';
import { hrefExterno, rutaInterna } from '../url';
import { limpiarUrl } from '../sentry';

afterEach(() => vi.unstubAllGlobals());

describe('hrefExterno', () => {
  it('solo https', () => {
    expect(hrefExterno('https://3.basecamp.com/1/buckets/2')).toBe('https://3.basecamp.com/1/buckets/2');
    expect(hrefExterno('javascript:alert(1)')).toBeUndefined();
    expect(hrefExterno('http://inseguro.com')).toBeUndefined();
    expect(hrefExterno('no es url')).toBeUndefined();
    expect(hrefExterno(null)).toBeUndefined();
  });
});

describe('rutaInterna (redirección después del login)', () => {
  const conOrigen = () => vi.stubGlobal('window', { location: { origin: 'https://backio.vercel.app' } });
  it('acepta rutas del mismo origen', () => {
    conOrigen();
    expect(rutaInterna('/kpis?mes=2026-10#x')).toBe('/kpis?mes=2026-10#x');
  });
  it('rechaza otro origen, incluido el truco del tabulador', () => {
    conOrigen();
    expect(rutaInterna('https://evil.com/x')).toBe('/backlog');
    expect(rutaInterna('//evil.com')).toBe('/backlog');
    expect(rutaInterna('/\t/evil.com')).toBe('/backlog');
  });
  it('sin next o sin navegador, la ruta por defecto', () => {
    expect(rutaInterna('/kpis')).toBe('/backlog');
    conOrigen();
    expect(rutaInterna(null, '/daily')).toBe('/daily');
  });
});

describe('limpiarUrl (lo que se manda a Sentry)', () => {
  it('quita el token del portal y toda query', () => {
    expect(limpiarUrl('https://backio.vercel.app/p/tok_secreto/x?pin=1')).toBe('https://backio.vercel.app/p/[redactado]/x');
    expect(limpiarUrl('https://backio.vercel.app/auth/establecer-clave?token_hash=abc&type=invite')).toBe(
      'https://backio.vercel.app/auth/establecer-clave',
    );
    expect(limpiarUrl(undefined)).toBeUndefined();
  });
});
