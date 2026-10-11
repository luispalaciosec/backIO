/**
 * Genera docs/referencia-api.md desde el OpenAPI que publica el backend (routes/openapi.ts, que usa los mismos
 * esquemas zod que validan las rutas). Uso: `pnpm --filter @backio/backend docs:api`. El CI falla si el archivo
 * quedó desactualizado, así la referencia no se separa del código.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSpec } from '../src/routes/openapi';

type Schema = {
  type?: string;
  format?: string;
  enum?: unknown[];
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  nullable?: boolean;
  $ref?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  default?: unknown;
  description?: string;
  additionalProperties?: Schema | boolean;
  anyOf?: Schema[];
};
type Param = { name: string; in: string; description?: string; required?: boolean; schema?: Schema };
type Op = {
  summary?: string;
  description?: string;
  parameters?: Param[];
  requestBody?: { content?: Record<string, { schema?: Schema }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: Schema }> }>;
};

const spec = buildSpec('https://<backend>') as unknown as {
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, Op>>;
  components: { schemas: Record<string, Schema> };
};

const nombreRef = (ref: string) => ref.split('/').pop()!;
const enlace = (ref: string) => `[${nombreRef(ref)}](#${nombreRef(ref).toLowerCase()})`;
const celda = (t: string) => t.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function tipo(s: Schema | undefined): string {
  if (!s) return '—';
  if (s.$ref) return enlace(s.$ref);
  if (s.anyOf) return s.anyOf.map(tipo).join(' o ');
  if (s.enum) return s.enum.map((v) => `\`${String(v)}\``).join(' · ');
  if (s.type === 'array') return `lista de ${tipo(s.items)}`;
  if (s.type === 'object' && s.properties) return 'objeto';
  if (s.type === 'object') return 'objeto libre';
  return `${s.type ?? '—'}${s.format ? ` (${s.format})` : ''}`;
}

function notas(s: Schema): string {
  const n: string[] = [];
  if (s.nullable) n.push('admite null');
  if (s.minLength !== undefined || s.maxLength !== undefined) n.push(`largo ${s.minLength ?? 0}–${s.maxLength ?? '∞'}`);
  if (s.minimum !== undefined) n.push(`mínimo ${s.minimum}`);
  if (s.maximum !== undefined) n.push(`máximo ${s.maximum}`);
  if (s.default !== undefined) n.push(`por defecto \`${JSON.stringify(s.default)}\``);
  if (s.format === 'date' || s.description === 'YYYY-MM-DD') n.push('fecha YYYY-MM-DD');
  if (s.description && s.description !== 'YYYY-MM-DD') n.push(s.description);
  return n.join('; ');
}

function tablaCampos(s: Schema): string {
  const req = new Set(s.required ?? []);
  const filas = Object.entries(s.properties ?? {}).map(
    ([k, v]) => `| \`${k}\` | ${celda(tipo(v))} | ${req.has(k) ? 'sí' : ''} | ${celda(notas(v))} |`,
  );
  return ['| Campo | Tipo | Obligatorio | Notas |', '|---|---|---|---|', ...filas].join('\n');
}

const grupos = new Map<string, string[]>();
for (const [ruta, ops] of Object.entries(spec.paths)) {
  const grupo = ruta.split('/')[1] ?? 'otros';
  for (const [metodo, op] of Object.entries(ops)) {
    const partes = [`### \`${metodo.toUpperCase()} ${ruta}\``, ''];
    if (op.summary) partes.push(op.summary, '');
    if (op.description) partes.push(op.description, '');
    if (op.parameters?.length) {
      partes.push('| Parámetro | En | Tipo | Descripción |', '|---|---|---|---|');
      for (const p of op.parameters)
        partes.push(
          `| \`${p.name}\`${p.required ? ' (obligatorio)' : ''} | ${p.in === 'path' ? 'ruta' : p.in === 'query' ? 'query' : p.in} | ${celda(tipo(p.schema))} | ${celda(p.description ?? '')} |`,
        );
      partes.push('');
    }
    const cuerpo = op.requestBody?.content?.['application/json']?.schema ?? op.requestBody?.content?.['text/csv']?.schema;
    if (cuerpo) partes.push(`**Cuerpo:** ${cuerpo.$ref ? enlace(cuerpo.$ref) : tipo(cuerpo)}`, '');
    if (op.responses) {
      partes.push('**Respuestas:**', '');
      for (const [codigo, r] of Object.entries(op.responses)) {
        const sch = r.content?.['application/json']?.schema;
        const detalle = sch?.$ref
          ? ` — ${enlace(sch.$ref)}`
          : sch?.properties?.items?.items?.$ref
            ? ` — lista de ${enlace(sch.properties.items.items.$ref)} en \`items\``
            : '';
        partes.push(`- \`${codigo}\` ${r.description ?? ''}${detalle}`);
      }
      partes.push('');
    }
    grupos.set(grupo, [...(grupos.get(grupo) ?? []), partes.join('\n')]);
  }
}

const salida = [
  '---',
  'outline: [2, 3]',
  '---',
  '',
  '# Referencia de la API REST',
  '',
  '::: info Generado',
  'Esta página se genera desde el código (`backend/scripts/gen_docs_api.ts`, a partir de `routes/openapi.ts`). No se',
  'edita a mano: `pnpm --filter @backio/backend docs:api`. El CI falla si quedó desactualizada.',
  ':::',
  '',
  `Versión ${spec.info.version}. Base: \`https://<backend>/api/v1\`. El spec completo en JSON está en \`GET /api/openapi.json\`.`,
  '',
  'Son las rutas pensadas para integraciones (PrometIO, agentes, reportes). Las que usa solo la interfaz de BackIO no se',
  'publican aquí; están en `backend/src/routes/v1/` y se resumen en [Arquitectura técnica](./17-arquitectura-tecnica.md).',
  '',
  '**Autenticación.** Cada petición lleva `Authorization: Bearer <credencial>`: la sesión de un usuario de BackIO, una',
  'API key (`bk_live_…`, se crean en Admin → API keys) o un token OAuth de un agente. Lo que se puede hacer depende de los',
  'scopes de la credencial y del rol de la persona (ver [API y agentes](./07-api-mcp.md)).',
  '',
  '**Errores.** Toda respuesta de error trae `{ "error": "texto para mostrar" }`; los de validación agregan',
  '`detalle` con el campo y el motivo (`400 · Revisa: fecha_entrega, piezas`).',
  '',
  ...[...grupos.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([g, ops]) => [`## ${g}`, '', ...ops]),
  '## Esquemas',
  '',
  ...Object.entries(spec.components.schemas).flatMap(([nombre, s]) => [
    `### ${nombre}`,
    '',
    s.properties ? tablaCampos(s) : `Tipo: ${tipo(s)}`,
    '',
  ]),
].join('\n');

const destino = resolve(import.meta.dirname, '../../docs/referencia-api.md');
writeFileSync(destino, salida.replace(/\n{3,}/g, '\n\n'));
console.log(`${Object.keys(spec.paths).length} rutas, ${Object.keys(spec.components.schemas).length} esquemas → ${destino}`);
