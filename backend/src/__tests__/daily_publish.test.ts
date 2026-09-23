import { describe, it, expect } from 'vitest';
import { cuerpoDaily, porPersonaDaily, type DailyItem } from '../lib/mcp/publish';

const it1: DailyItem = { cliente: 'Board A', titulo: 'Tarea 1', owner: 'Ana', owners: ['Ana', 'Beto'], fecha: '2026-09-22', url: 'https://bc/1' };
const it2: DailyItem = { cliente: 'Board B', titulo: 'Tarea 2', owner: 'Ana', owners: ['Ana'], fecha: null, url: null };

describe('daily · bloque por persona', () => {
  it('agrupa persona → board → tareas y repite la tarea bajo cada responsable', () => {
    const html = porPersonaDaily([it1, it2]);
    expect(html.indexOf('👤 Ana')).toBeLessThan(html.indexOf('👤 Beto'));
    expect(html).toContain('<strong>👤 Ana</strong> · 2 tareas');
    expect(html).toContain('<strong>👤 Beto</strong> · 1 tarea');
    expect((html.match(/Tarea 1/g) ?? []).length).toBe(2);
    expect(html).toContain('<strong>Board A</strong>');
  });
  it('el cuerpo pone "Por persona" antes de "Por tarea" dentro de Hoy se trabaja, y lo omite si no hay tareas', () => {
    const base = { tipo: 'apertura' as const, responsable: 'Luis', fecha: '2026-09-22', notas: [], vencen: [], bloqueos: [], cambios: [] };
    const con = cuerpoDaily({ ...base, hoy: [it1] });
    expect(con.indexOf('Hoy se trabaja')).toBeLessThan(con.indexOf('Por persona'));
    expect(con.indexOf('Por persona')).toBeLessThan(con.indexOf('Por tarea'));
    expect(con.indexOf('Por tarea')).toBeLessThan(con.indexOf('Vence hoy'));
    expect(cuerpoDaily({ ...base, hoy: [] })).not.toContain('Por persona');
  });
});
