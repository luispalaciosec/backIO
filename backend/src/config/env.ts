import { z } from 'zod';

// Carga backend/.env en desarrollo (Node >= 21). En producción las variables vienen de la plataforma.
try {
  if (!process.env.SUPABASE_URL) process.loadEnvFile?.(new URL('../../.env', import.meta.url).pathname);
} catch {
  /* sin .env: se validará abajo */
}

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  BACKEND_PORT: z.coerce.number().default(4000),
  FRONTEND_URL: z.string().default('http://localhost:3000'), // una o varias URLs separadas por coma
  ANTHROPIC_API_KEY: z.string().optional(),
  BASECAMP_CLIENT_ID: z.string().optional(),
  BASECAMP_CLIENT_SECRET: z.string().optional(),
  BASECAMP_ACCOUNT_ID: z.string().optional(),
  BASECAMP_REDIRECT_URI: z.string().optional(),
  BASECAMP_USER_AGENT: z.string().default('BackIO Geeks (luis@geeks.ec)'),
  BASECAMP_WEBHOOK_SECRET: z.string().optional(),
  PROMETIO_WEBHOOK_SECRET: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function frontendOrigins(): string[] {
  return env().FRONTEND_URL.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
}

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const faltan = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Variables de entorno inválidas o faltantes: ${faltan}`);
  }
  cached = parsed.data;
  return cached;
}
