/**
 * Carga masiva CSV (docs/03-builder.md · bulk import). Validación pura.
 *  - visible=true requiere etiqueta_cliente → si falta, la fila se rechaza.
 *  - Preview obligatorio: válidas + rechazadas con motivo.
 *  - La inserción es transaccional (o todas o ninguna) en routes/v1/requerimientos.
 */
import type { FilaImportCSV, PreviewImport } from '@backio/shared';

export const COLUMNAS_CSV: (keyof FilaImportCSV)[] = [
  'cliente_slug', 'proyecto', 'titulo_interno', 'etiqueta_cliente', 'visible', 'bloque',
  'peso', 'tipo', 'prioridad', 'fecha_pedido', 'fecha_entrega', 'owner_email', 'piezas',
];

export function parseCSV(texto: string): FilaImportCSV[] {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lineas.length === 0) return [];
  const header = splitLinea(lineas[0]!).map((h) => h.trim());
  return lineas.slice(1).map((l) => {
    const celdas = splitLinea(l);
    const fila = {} as Record<string, string>;
    header.forEach((h, i) => (fila[h] = (celdas[i] ?? '').trim()));
    return fila as unknown as FilaImportCSV;
  });
}

function splitLinea(l: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i]!;
    if (ch === '"') {
      if (inQ && l[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ;
    } else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const BOOL_TRUE = new Set(['true', '1', 'si', 'sí', 'yes']);
const BOOL_FALSE = new Set(['false', '0', 'no', '']);

export function validarFilas(
  filas: FilaImportCSV[],
  ctx: { clientesSlug: Set<string>; usuariosEmail: Set<string> },
): PreviewImport {
  const validas: PreviewImport['validas'] = [];
  const rechazadas: PreviewImport['rechazadas'] = [];
  filas.forEach((f, i) => {
    const fila = i + 2; // 1 = header
    const motivos: string[] = [];
    if (!f.cliente_slug) motivos.push('cliente_slug vacío');
    else if (!ctx.clientesSlug.has(f.cliente_slug)) motivos.push(`cliente "${f.cliente_slug}" no existe`);
    if (!f.titulo_interno) motivos.push('titulo_interno vacío');
    const vis = (f.visible ?? '').toLowerCase();
    if (!BOOL_TRUE.has(vis) && !BOOL_FALSE.has(vis)) motivos.push(`visible inválido: "${f.visible}"`);
    if (BOOL_TRUE.has(vis) && !f.etiqueta_cliente) motivos.push('visible=true requiere etiqueta_cliente');
    if (f.peso && Number.isNaN(Number(f.peso))) motivos.push('peso no numérico');
    if (f.tipo && !['fee', 'proyecto'].includes(f.tipo)) motivos.push(`tipo inválido: "${f.tipo}"`);
    if (f.prioridad && !['alta', 'media', 'baja'].includes(f.prioridad)) motivos.push(`prioridad inválida: "${f.prioridad}"`);
    if (f.fecha_pedido && !ES_FECHA.test(f.fecha_pedido)) motivos.push('fecha_pedido debe ser YYYY-MM-DD');
    if (f.fecha_entrega && !ES_FECHA.test(f.fecha_entrega)) motivos.push('fecha_entrega debe ser YYYY-MM-DD');
    if (f.owner_email && !ctx.usuariosEmail.has(f.owner_email.toLowerCase())) motivos.push(`owner "${f.owner_email}" no existe`);
    if (f.piezas && (!/^\d+$/.test(f.piezas))) motivos.push('piezas debe ser entero');
    if (motivos.length) rechazadas.push({ fila, motivo: motivos.join('; '), datos: f });
    else validas.push({ ...f, fila });
  });
  return { validas, rechazadas };
}

export function esVisible(v: string): boolean {
  return BOOL_TRUE.has((v ?? '').toLowerCase());
}
