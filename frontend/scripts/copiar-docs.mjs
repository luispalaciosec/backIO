/**
 * Copia el sitio de documentación (docs/, VitePress) a public/docs para servirlo en backio.vercel.app/docs.
 * Los scripts en línea de VitePress (tema claro/oscuro, mapa de archivos) se pasan a archivos .js propios: así
 * /docs corre con una CSP sin 'unsafe-inline' (ver middleware.ts), en el mismo dominio donde vive la sesión.
 * Lo corre `pnpm build` del frontend después de compilar los docs.
 */
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const raiz = resolve(import.meta.dirname, '..');
const origen = resolve(raiz, '../docs/.vitepress/dist');
const destino = resolve(raiz, 'public/docs');

rmSync(destino, { recursive: true, force: true });
cpSync(origen, destino, { recursive: true });
mkdirSync(join(destino, '_inline'), { recursive: true });

const html = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? html(p) : n.endsWith('.html') ? [p] : [];
  });

let paginas = 0;
const scripts = new Set();
for (const archivo of html(destino)) {
  const texto = readFileSync(archivo, 'utf8').replace(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g, (_, attrs, codigo) => {
    const nombre = `${createHash('sha256').update(codigo).digest('hex').slice(0, 16)}.js`;
    if (!scripts.has(nombre)) {
      writeFileSync(join(destino, '_inline', nombre), codigo);
      scripts.add(nombre);
    }
    return `<script${attrs} src="/docs/_inline/${nombre}"></script>`;
  });
  writeFileSync(archivo, texto);
  paginas += 1;
}
console.log(`docs → public/docs: ${paginas} páginas, ${scripts.size} scripts en línea pasados a archivos`);
