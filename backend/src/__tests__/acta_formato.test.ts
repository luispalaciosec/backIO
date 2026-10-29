import { describe, expect, it } from 'vitest';
import { markdownBasico, mencionarEnHtml, cuerpoDaily } from '../lib/mcp/publish';
import { mdTexto } from '../lib/rituals/documents';

// Revisión del 29/10/2026: títulos con «|» o «_», menciones dentro de otras palabras y la hora fija del daily.
describe('formato de actas y daily', () => {
  it('un título con «|» no parte la fila de la tabla', () => {
    const html = markdownBasico(`| Tarea | Responsable |\n|---|---|\n| ${mdTexto('AB-Inbev || Post 1')} | Ana |`);
    expect(html).toContain('<td>AB-Inbev || Post 1</td><td>Ana</td>');
  });
  it('un «_» del título no se vuelve cursiva, y la cursiva del documento sigue funcionando', () => {
    expect(markdownBasico(`- ${mdTexto('arte_final_v2 y _borrador_')}`)).toContain('<li>arte_final_v2 y _borrador_</li>');
    expect(markdownBasico('_Sin pendientes._')).toContain('<em>Sin pendientes.</em>');
    expect(markdownBasico('archivo_final_v2')).toContain('archivo_final_v2');
  });
  it('mdTexto junta las líneas y escapa los asteriscos', () => {
    expect(markdownBasico(mdTexto('**no negrita**\notra línea'))).toBe('<p>**no negrita** otra línea</p>');
  });
  it('la mención es de la palabra completa: «Ana» no se marca dentro de «Mariana»', () => {
    const men = new Map([
      ['Ana', 'sgid-ana'],
      ['Ana Paula', 'sgid-ap'],
    ]);
    const html = mencionarEnHtml('<p>Mariana y Ana revisan; Ana Paula aprueba</p>', men);
    expect(html).toContain('Mariana y <bc-attachment sgid="sgid-ana"');
    expect(html).toContain('<bc-attachment sgid="sgid-ap"');
    expect(html.match(/sgid-ana/g)).toHaveLength(1);
  });
  it('el daily lleva la hora real de publicación, no «9H00 AM» fija', () => {
    const html = cuerpoDaily({
      tipo: 'apertura',
      responsable: 'Ana',
      fecha: '2026-10-29',
      notas: [],
      hoy: [],
      vencen: [],
      bloqueos: [],
      cambios: [],
    });
    expect(html).not.toContain('9H00 AM');
    expect(html).toMatch(/<strong>Hora:<\/strong> \d{2}H\d{2}/);
  });
});
