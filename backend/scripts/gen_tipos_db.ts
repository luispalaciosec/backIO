/**
 * Genera src/lib/db/database.types.ts desde el esquema que publica PostgREST (GET /rest/v1/ con la service role).
 * Uso: `pnpm --filter @backio/backend db:types` después de aplicar una migración. Solo lee.
 * (Equivale a `supabase gen types typescript` sin necesitar la CLI ni el acceso a la cuenta de Supabase.)
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Prop = { type?: string; format?: string; enum?: string[]; items?: { type?: string }; default?: unknown; description?: string };
type Def = { properties: Record<string, Prop>; required?: string[] };
type Spec = {
  definitions: Record<string, Def>;
  paths: Record<string, Record<string, { parameters?: { in: string; schema?: { properties?: Record<string, Prop>; required?: string[] } }[] }>>;
};

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en backend/.env');

const res = await fetch(`${url}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' } });
if (!res.ok) throw new Error(`PostgREST respondió ${res.status}`);
const spec = (await res.json()) as Spec;

const enums = new Map<string, string[]>();
function tipo(p: Prop): string {
  if (p.enum) {
    const nombre = (p.format ?? '').replace(/^public\./, '');
    if (nombre && !nombre.includes('character') && !nombre.includes('text')) enums.set(nombre, p.enum);
    return p.enum.map((v) => JSON.stringify(v)).join(' | ');
  }
  const f = p.format ?? '';
  if (p.type === 'array') return `${tipo({ type: p.items?.type, format: f.replace(/\[\]$/, '') })}[]`;
  if (f === 'jsonb' || f === 'json') return 'Json';
  if (p.type === 'integer' || p.type === 'number') return 'number';
  if (p.type === 'boolean') return 'boolean';
  return 'string';
}
const prop = (k: string) => (/^[a-z_][a-z0-9_]*$/.test(k) ? k : JSON.stringify(k));

const esTabla = (n: string) => !!spec.paths[`/${n}`]?.post;
// PostgREST no publica algunos defaults (jsonb, arreglos, claves seriales): esas columnas quedan opcionales al
// insertar y la base decide (si no tienen default, el insert falla con un error claro de Postgres).
const tieneDefault = (p: Prop) =>
  p.default !== undefined ||
  p.format === 'jsonb' ||
  p.format === 'json' ||
  p.type === 'array' ||
  (p.type === 'integer' && (p.description ?? '').includes('<pk/>'));
/** Relaciones desde las notas de clave foránea (<fk table='x' column='y'/>): permiten los select con embebidos. */
function relaciones(nombre: string, def: Def): string {
  const rels = Object.entries(def.properties).flatMap(([col, p]) => {
    const m = /<fk table='([^']+)' column='([^']+)'\/>/.exec(p.description ?? '');
    return m
      ? [
          `          { foreignKeyName: ${JSON.stringify(`${nombre}_${col}_fkey`)}; columns: [${JSON.stringify(col)}]; isOneToOne: false; referencedRelation: ${JSON.stringify(m[1])}; referencedColumns: [${JSON.stringify(m[2])}] },`,
        ]
      : [];
  });
  return rels.length ? `[\n${rels.join('\n')}\n        ]` : '[]';
}
const tablas: string[] = [];
const vistas: string[] = [];
for (const [nombre, def] of Object.entries(spec.definitions).sort(([a], [b]) => a.localeCompare(b))) {
  const req = new Set(def.required ?? []);
  const cols = Object.entries(def.properties);
  const row = cols.map(([k, p]) => `          ${prop(k)}: ${tipo(p)}${req.has(k) ? '' : ' | null'};`).join('\n');
  if (!esTabla(nombre)) {
    vistas.push(`      ${nombre}: {\n        Row: {\n${row}\n        };\n        Relationships: ${relaciones(nombre, def)};\n      };`);
    continue;
  }
  // Insert: opcional si admite null o tiene default.
  const ins = cols
    .map(([k, p]) => `          ${prop(k)}${req.has(k) && !tieneDefault(p) ? '' : '?'}: ${tipo(p)}${req.has(k) ? '' : ' | null'};`)
    .join('\n');
  const upd = cols.map(([k, p]) => `          ${prop(k)}?: ${tipo(p)}${req.has(k) ? '' : ' | null'};`).join('\n');
  tablas.push(
    `      ${nombre}: {\n        Row: {\n${row}\n        };\n        Insert: {\n${ins}\n        };\n        Update: {\n${upd}\n        };\n        Relationships: ${relaciones(nombre, def)};\n      };`,
  );
}

const funciones = Object.entries(spec.paths)
  .filter(([p]) => p.startsWith('/rpc/'))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([p, ops]) => {
    const body = (ops.post?.parameters ?? []).find((x) => x.in === 'body')?.schema;
    const req = new Set(body?.required ?? []);
    const args = Object.entries(body?.properties ?? {})
      // En SQL todo argumento admite null; la función decide qué hacer con él.
      .map(([k, v]) => `${prop(k)}${req.has(k) ? '' : '?'}: ${tipo(v)} | null`)
      .join('; ');
    return `      ${p.slice(5)}: {\n        Args: ${args ? `{ ${args} }` : 'Record<PropertyKey, never>'};\n        Returns: Json;\n      };`;
  });

const salida = `/**
 * GENERADO por scripts/gen_tipos_db.ts desde el esquema de PostgREST. No editar a mano: correr \`pnpm db:types\`.
 */
// jsonb sin estructura fija en la base: se tipa como unknown y su forma la fijan los tipos de @backio/shared.
export type Json = unknown;

export type Database = {
  public: {
    Tables: {
${tablas.join('\n')}
    };
    Views: {
${vistas.join('\n')}
    };
    Functions: {
${funciones.join('\n')}
    };
    Enums: {
${[...enums.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([n, v]) => `      ${n}: ${v.map((x) => JSON.stringify(x)).join(' | ')};`)
  .join('\n')}
    };
    CompositeTypes: Record<string, never>;
  };
};
`;
const destino = resolve(import.meta.dirname, '../src/lib/db/database.types.ts');
writeFileSync(destino, salida);
console.log(`${tablas.length} tablas, ${vistas.length} vistas, ${funciones.length} funciones → ${destino}`);
