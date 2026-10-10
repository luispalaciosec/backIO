/**
 * Log de peticiones sin credenciales (auditoría 10/10, S1). El logger() de Hono escribía la ruta completa, y dos
 * rutas llevan un secreto en el propio path: el webhook de Basecamp (el secreto de la URL registrada) y el portal
 * (el token del cliente). Las query strings tampoco se registran (p. ej. ?code=&state= del callback OAuth).
 */
import type { MiddlewareHandler } from 'hono';

const SECRETOS_EN_RUTA: [RegExp, string][] = [
  [/^(\/api\/webhooks\/basecamp\/)[^/]+/, '$1[redactado]'],
  [/^(\/api\/portal\/)[^/]+/, '$1[redactado]'],
];

export function redactarRuta(path: string): string {
  const sinQuery = path.split('?')[0] ?? '';
  return SECRETOS_EN_RUTA.reduce((p, [re, rep]) => p.replace(re, rep), sinQuery);
}

export const logPeticiones: MiddlewareHandler = async (c, next) => {
  const inicio = Date.now();
  await next();
  console.log(`${c.req.method} ${redactarRuta(c.req.path)} ${c.res.status} ${Date.now() - inicio}ms`);
};
