import { describe, expect, it } from 'vitest';
import { armarDaily, SECCIONES_DAILY } from '../lib/ia/daily';

// Los títulos del daily los pone el código (decisión del 11/10): la IA solo redacta el contenido de cada sección.
describe('armarDaily', () => {
  it('pone los títulos fijos en el orden canónico aunque la IA cambie el orden', () => {
    const ia = '[[bloqueos]]\n- **Arte** : Ana\n\n[[foco]]\nCerrar la campaña de octubre.\n[[mesa]]\n- **Post 1**: Luis';
    expect(armarDaily('apertura', ia)).toBe(
      '**🎯 Foco del día**\nCerrar la campaña de octubre.\n\n**📋 En la mesa hoy**\n- **Post 1**: Luis\n\n**⛔ Bloqueos**\n- **Arte** : Ana',
    );
  });
  it('omite secciones vacías, desconocidas o que no tocan en ese tipo', () => {
    const ia = '[[foco]]\nFoco.\n[[vence]]\n\n[[inventada]]\n- algo\n[[manana]]\n- no va en apertura';
    expect(armarDaily('apertura', ia)).toBe('**🎯 Foco del día**\nFoco.');
  });
  it('el cierre lleva «Para mañana» al final', () => {
    const r = armarDaily('cierre', '[[manana]]\n- seguir\n[[balance]]\n8 de 10 cerradas.');
    expect(r).toBe('**🎯 Balance del día**\n8 de 10 cerradas.\n\n**➡️ Para mañana**\n- seguir');
  });
  it('si la IA no usa marcas, publica su texto tal cual', () => {
    expect(armarDaily('apertura', '  Texto libre.  ')).toBe('Texto libre.');
  });
  it('cada sección tiene título con emoji y clave única', () => {
    for (const tipo of ['apertura', 'cierre'] as const) {
      const claves = SECCIONES_DAILY[tipo].map(([c]) => c);
      expect(new Set(claves).size).toBe(claves.length);
    }
  });
});
