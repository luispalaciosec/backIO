/** Cambiar la fecha desde BackIO no debe desarmar los adjuntos de la descripción del to-do en Basecamp. */
import { describe, it, expect } from 'vitest';
import { descripcionParaGuardar } from '../lib/basecamp/client';

const img = (sgid: string, extra = '') => `<bc-attachment sgid="${sgid}" content-type="image/png" url="https://x/${sgid}.png" href="https://x/${sgid}" filename="${sgid}.png"${extra}><figure><img src="https://preview/${sgid}.png"><figcaption>${sgid}.png</figcaption></figure></bc-attachment>`;

describe('descripcionParaGuardar', () => {
  it('deja cada adjunto como referencia vacía por sgid (lo que espera el PUT)', () => {
    const html = `<p>${img('A')}</p><p><br></p><div>${img('B', ' caption="Arte final"')}${img('C')}</div>`;
    expect(descripcionParaGuardar(html)).toBe('<p><bc-attachment sgid="A"></bc-attachment></p><p><br></p><div><bc-attachment sgid="B" caption="Arte final"></bc-attachment><bc-attachment sgid="C"></bc-attachment></div>');
  });

  it('no toca el texto ni el formato fuera de los adjuntos', () => {
    const html = '<div><strong>Brief</strong><br>Colores: <em>azul</em><ul><li>uno</li></ul></div>';
    expect(descripcionParaGuardar(html)).toBe(html);
  });

  it('las menciones también quedan como referencia', () => {
    const m = '<bc-attachment sgid="P1" content-type="application/vnd.basecamp.mention"><figure><img src="a.png"><figcaption>Ana</figcaption></figure></bc-attachment>';
    expect(descripcionParaGuardar(`Hola ${m}`)).toBe('Hola <bc-attachment sgid="P1"></bc-attachment>');
  });

  it('un adjunto sin sgid se deja como estaba (no se pierde)', () => {
    const raro = '<bc-attachment content-type="x"><figure></figure></bc-attachment>';
    expect(descripcionParaGuardar(raro)).toBe(raro);
  });

  it('es idempotente: guardar dos veces da lo mismo', () => {
    const una = descripcionParaGuardar(`<p>${img('A')}</p>`);
    expect(descripcionParaGuardar(una)).toBe(una);
  });
});
