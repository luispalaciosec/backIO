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

// ---------------------------------------------------------------------------------------------------------------
// Página del esquema para la documentación (docs/esquema.md), desde el mismo esquema de PostgREST.
// Las descripciones de cada tabla se escriben aquí a mano: Postgres no tiene comentarios en las tablas.
// ---------------------------------------------------------------------------------------------------------------
const TEMAS: [tema: string, tablas: Record<string, string>][] = [
  [
    'Organización y personas',
    {
      tenants: 'Organizaciones. Hoy solo Geeks; toda tabla de negocio lleva su `tenant_id`.',
      usuarios: 'Personas con acceso: rol, capacidad semanal, área y su usuario de Basecamp.',
      clientes: 'Clientes de la agencia (mismo id que en PrometIO), con su proyecto de Basecamp y su mesa.',
      mesas: 'Equipos de trabajo (Orión, Omega) con su proyecto y sus boards de Basecamp.',
      invitaciones: 'Invitaciones pendientes para crear cuentas.',
    },
  ],
  [
    'Trabajo',
    {
      proyectos: 'Proyectos de un cliente (una lista de to-dos en Basecamp), con fecha de entrega, brief y portal.',
      requerimientos: 'Las tareas del backlog: estado, aprobación, prioridad, fechas, responsables, visibilidad y enlace a Basecamp.',
      plantillas: 'Proyectos tipo que usa el Builder.',
      plantilla_bloques: 'Bloques de una plantilla, con su peso.',
      plantilla_tareas: 'Tareas de un bloque de plantilla, con su visibilidad por defecto y su desfase en días.',
      tipos_pieza: 'Formatos de entregable con su flujo de pasos (post, carrusel, reel…).',
      recurrencias: 'Fees que generan el proyecto del mes siguiente el día configurado.',
      proyecto_borradores: 'Borradores de proyecto creados por cotizaciones aprobadas en PrometIO.',
      mapeo_servicios: 'Servicio de PrometIO → plantilla sugerida para el borrador.',
      bitacora: 'Notas por tarea; algunas pueden ser visibles al cliente.',
      notas_cuenta: 'Sin uso en el código: la reemplazó `bitacora`.',
      horas: 'Entradas del timesheet de Basecamp, atribuidas a cliente, tarea y persona.',
    },
  ],
  [
    'Cumplimiento',
    {
      reprogramaciones: 'Cada cambio de fecha de entrega, con motivo, origen y a quién se atribuye.',
      reprocesos: 'Cada vez que una tarea se reabre (rechazo del cliente o completado reabierto).',
      aprobacion_eventos: 'Cada cambio de estado de aprobación, con su ronda (alimenta KPIs).',
    },
  ],
  [
    'Rituales',
    {
      semanas: 'Semanas ISO del weekly, con marcas de plan y acta publicados.',
      senales: 'Alertas calculadas por el motor de señales para una semana.',
      acuerdos: 'Compromisos del weekly con responsable y fecha.',
      actas: 'Plan Operativo, Acta de Cierre e informe mensual: el texto y si se publicó.',
      daily_snapshots: 'Foto diaria de cada mesa (evolutivo).',
      weekly_snapshots: 'Foto semanal de cada mesa (evolutivo).',
    },
  ],
  [
    'KPIs',
    {
      kpi_definiciones: 'Cada KPI: área, cálculo, meta y operador.',
      kpi_mediciones: 'Resultado de un KPI por periodo y persona o equipo (automático, congelado o ajustado).',
    },
  ],
  [
    'Basecamp',
    {
      basecamp_huerfanos: 'To-dos de Basecamp sin tarea en BackIO: pendientes, adoptados o ignorados.',
      integracion_credenciales: 'Tokens de Basecamp. Sin políticas: solo la lee el servidor.',
    },
  ],
  [
    'Portal del cliente',
    {
      portal_pines: 'PIN del portal por cliente, guardado con hash. Solo lo lee el servidor.',
      portal_resumenes: 'Caché del resumen ejecutivo que redacta la IA para el portal.',
    },
  ],
  [
    'IA, agentes y acceso',
    {
      ia_generaciones: 'Registro y caché de cada texto que redactó la IA (tokens usados, quién lo pidió).',
      api_keys: 'Claves de API (solo el hash), con perfil, scopes y, si es de un cliente, a qué cliente pertenece.',
      agent_plans: 'Planes de cambios que proponen los agentes por MCP, a la espera de confirmación.',
      oauth_clients: 'Agentes registrados por OAuth.',
      oauth_codes: 'Códigos de autorización OAuth de corta vida.',
      oauth_tokens: 'Tokens de acceso y renovación de los agentes OAuth.',
    },
  ],
  [
    'Sistema',
    {
      audit_log: 'Quién hizo qué y cuándo. Lo leen Admin → Auditoría y el Día a día.',
      notificaciones: 'Cola de correos y avisos por persona.',
      limites: 'Contadores del límite de peticiones (login, PIN, OAuth, MCP). Tabla global, sin `tenant_id`.',
      cron_runs: 'Cada corrida de cada tarea programada (y los avisos del vigía). Tabla global, sin `tenant_id`.',
    },
  ],
  [
    'Vistas',
    {
      v_requerimientos_metricas: 'Requerimientos con días de atraso y días sin movimiento calculados (hora de Guayaquil).',
      v_proyectos_avance: 'Avance de cada proyecto según el peso de sus tareas completadas.',
    },
  ],
];

function paginaEsquema(): string {
  const documentadas = new Set(TEMAS.flatMap(([, t]) => Object.keys(t)));
  const sinTema = Object.keys(spec.definitions).filter((n) => !documentadas.has(n));
  const temas: [string, Record<string, string>][] = [
    ...TEMAS,
    ...(sinTema.length ? [['Sin clasificar', Object.fromEntries(sinTema.map((n) => [n, 'Sin descripción: agrégala en `backend/scripts/gen_tipos_db.ts`.']))] as [string, Record<string, string>]] : []),
  ];
  const tipoDoc = (p: Prop): string => {
    if (p.enum) return p.enum.map((v) => `\`${v}\``).join(' · ');
    const f = (p.format ?? p.type ?? '').replace(/^public\./, '');
    return f.replace('timestamp with time zone', 'fecha y hora').replace('character varying', 'texto').replace(/^text$/, 'texto');
  };
  const out = [
    '---',
    'outline: [2, 3]',
    '---',
    '',
    '# Esquema de la base de datos',
    '',
    '::: info Generado',
    'Esta página se genera desde la base de producción con `pnpm --filter @backio/backend db:types`, el mismo comando que',
    'genera los tipos del backend. Se corre después de aplicar cada migración. Las descripciones de las tablas se editan en',
    '`backend/scripts/gen_tipos_db.ts`.',
    ':::',
    '',
    'Qué guarda cada tabla y sus columnas. Para entender cómo se relacionan y qué reglas protegen los datos, lee primero el',
    '[modelo de datos](./01-modelo-datos.md). Todas las tablas tienen seguridad por fila (RLS); las de negocio llevan',
    '`tenant_id`.',
    '',
  ];
  for (const [tema, tablas] of temas) {
    const presentes = Object.entries(tablas).filter(([n]) => spec.definitions[n]);
    if (!presentes.length) continue;
    out.push(`## ${tema}`, '');
    for (const [nombre, desc] of presentes) {
      const def = spec.definitions[nombre]!;
      const req = new Set(def.required ?? []);
      out.push(`### ${nombre}`, '', desc, '', '| Columna | Tipo | Obligatoria | Notas |', '|---|---|---|---|');
      for (const [col, p] of Object.entries(def.properties)) {
        const notas: string[] = [];
        if ((p.description ?? '').includes('<pk/>')) notas.push('clave primaria');
        const fk = /<fk table='([^']+)' column='([^']+)'\/>/.exec(p.description ?? '');
        if (fk) notas.push(`→ [${fk[1]}](#${fk[1]}).${fk[2]}`);
        if (p.default !== undefined && !String(p.default).includes('gen_random_uuid')) notas.push(`por defecto \`${String(p.default)}\``);
        out.push(`| \`${col}\` | ${tipoDoc(p)} | ${req.has(col) ? 'sí' : ''} | ${notas.join('; ')} |`);
      }
      out.push('');
    }
  }
  return out.join('\n');
}

const destinoDocs = resolve(import.meta.dirname, '../../docs/esquema.md');
writeFileSync(destinoDocs, paginaEsquema());
console.log(`esquema → ${destinoDocs}`);
