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

describe('daily · narrativa con formato', () => {
  it('convierte negritas, viñetas y líneas en blanco en HTML con saltos visibles', () => {
    const narrativa = '**🎯 Foco del día**\nCerrar AB-Inbev.\n\n**📋 En la mesa hoy**\n- **DIVERTRON**: Marcos Poveda\n- **CORONA CERO**: Marcos Poveda';
    const html = cuerpoDaily({ tipo: 'apertura', responsable: 'Luis', fecha: '2026-09-22', notas: [], hoy: [], vencen: [], bloqueos: [], cambios: [], narrativa });
    expect(html).toContain('<strong>🎯 Foco del día</strong>');
    expect(html).toContain('<li><strong>DIVERTRON</strong>: Marcos Poveda</li>');
    expect(html).toContain('<div><br></div>');
    expect(html.indexOf('Cerrar AB-Inbev.')).toBeLessThan(html.indexOf('<div><br></div>'));
    expect(html).not.toContain('<p>**');
  });
});

describe('daily · cierre', () => {
  it('el cierre lleva Completado hoy y Completadas fuera del daily antes de lo que quedó abierto; la apertura no', () => {
    const base = { responsable: 'Luis', fecha: '2026-09-22', notas: [], hoy: [it2], vencen: [], bloqueos: [], cambios: [] };
    const cierre = cuerpoDaily({ ...base, tipo: 'cierre', completadas: [it1], completadas_fuera: [] });
    expect(cierre.indexOf('Completado hoy')).toBeLessThan(cierre.indexOf('Completadas fuera del daily'));
    expect(cierre.indexOf('Completadas fuera del daily')).toBeLessThan(cierre.indexOf('Quedó abierto'));
    expect(cierre).toContain('<strong>👤 Ana</strong> · 1 tarea');
    expect(cierre).not.toContain('Hoy se trabaja');
    const apertura = cuerpoDaily({ ...base, tipo: 'apertura' });
    expect(apertura).not.toContain('Completado hoy');
    expect(apertura).toContain('Hoy se trabaja');
  });
});

describe('daily · @menciones', () => {
  it('nombres con sgid salen como bc-attachment en secciones y narrativa; sin sgid, como texto', async () => {
    const { mencionarEnHtml } = await import('../lib/mcp/publish');
    const men = new Map([['Ana', 'SGID_ANA']]);
    const html = cuerpoDaily({ tipo: 'apertura', responsable: 'Luis', fecha: '2026-09-22', notas: [], hoy: [it1], vencen: [], bloqueos: [], cambios: [], narrativa: 'Hoy **Ana** cierra y Beto apoya.' }, men);
    expect((html.match(/sgid="SGID_ANA"/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('Beto');
    expect(html).not.toContain('sgid="SGID_BETO"');
    expect(mencionarEnHtml('<a href="x/Ana">Ana</a>', men)).toBe('<a href="x/Ana"><bc-attachment sgid="SGID_ANA" content-type="application/vnd.basecamp.mention"></bc-attachment></a>');
  });
});
