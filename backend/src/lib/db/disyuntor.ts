/**
 * Disyuntor de la base (caída del 18/11/2026). Cuando Postgres no responde, cada petición del navegador y cada
 * tarea programada esperaban hasta un minuto por una conexión (con los reintentos de postgrest-js) y fallaban: 532
 * errores en tres horas que además ocupaban el pool que la base necesitaba para recuperarse.
 *
 * Con el disyuntor, la primera falla abre el circuito: durante la pausa ninguna llamada a Supabase sale del
 * servidor, se responde al instante «la base no responde» (PGRST003, que `throwIf` convierte en BaseNoDisponible).
 * Al vencer la pausa pasa una sola petición de prueba: si responde, todo vuelve a la normalidad; si falla, la pausa
 * se duplica (15 s, 30 s, 1 min, 2 min como máximo).
 */
import { log } from '../logger';

const PAUSA_MIN_MS = 15_000;
const PAUSA_MAX_MS = 120_000;
/** Respuestas que dicen que la base (no la consulta) falló: PostgREST sin conexión o el gateway sin respuesta. */
const STATUS_CAIDA = [502, 504, 520, 522, 544];
const CODIGO_CAIDA = /"code"\s*:\s*"PGRST00[0-3]"/;

let abiertoHasta = 0;
let pausaMs = PAUSA_MIN_MS;
let pruebaEnCurso = false;
let pruebaDesde = 0;
/** Una prueba que no responde en este tiempo se da por fallida (18/11: una prueba colgada durante el reinicio de
 * Supabase dejó el circuito abierto con la base ya sana). */
const PRUEBA_MAX_MS = 15_000;

const pruebaColgada = (ahora: number) => pruebaEnCurso && ahora - pruebaDesde > PRUEBA_MAX_MS;

/** ¿Está la base en pausa? El scheduler no corre tareas mientras tanto. */
export function baseEnPausa(ahora = Date.now()): boolean {
  return ahora < abiertoHasta || (pruebaEnCurso && !pruebaColgada(ahora));
}

/** Solo para tests. */
export function reiniciarDisyuntor(): void {
  abiertoHasta = 0;
  pausaMs = PAUSA_MIN_MS;
  pruebaEnCurso = false;
  pruebaDesde = 0;
}

/** 504 no lo reintenta postgrest-js (sí el 503): la respuesta llega al instante. */
function respuestaCaida(detalle = 'La base no responde (disyuntor abierto)'): Response {
  return new Response(JSON.stringify({ code: 'PGRST003', message: detalle, details: null, hint: null }), {
    status: 504,
    headers: { 'content-type': 'application/json' },
  });
}

function abrir(): void {
  const primera = abiertoHasta === 0 || Date.now() - abiertoHasta > PAUSA_MAX_MS;
  abiertoHasta = Date.now() + pausaMs;
  log.error(`[db] la base no responde; pausa de ${pausaMs / 1000} s sin consultas${primera ? '' : ' (otra vez)'}`);
  pausaMs = Math.min(pausaMs * 2, PAUSA_MAX_MS);
}

function cerrar(): void {
  if (pausaMs !== PAUSA_MIN_MS) log.info('[db] la base volvió a responder');
  abiertoHasta = 0;
  pausaMs = PAUSA_MIN_MS;
}

async function esCaida(res: Response, esRest: boolean): Promise<boolean> {
  if (!esRest) return false; // Auth puede fallar por otras razones; solo PostgREST abre el circuito.
  if (STATUS_CAIDA.includes(res.status)) return true;
  if (res.status !== 503) return false;
  const cuerpo = await res
    .clone()
    .text()
    .catch(() => '');
  return CODIGO_CAIDA.test(cuerpo);
}

/** Envuelve el fetch de supabase-js (global.fetch en createClient). */
export function fetchConDisyuntor(base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const esRest = url.includes('/rest/v1/');
    const ahora = Date.now();
    if (ahora < abiertoHasta) return respuestaCaida();
    // Pausa vencida: pasa una sola petición de prueba; las demás esperan su resultado como si siguiera abierto.
    const esPrueba = abiertoHasta !== 0;
    if (esPrueba) {
      if (pruebaEnCurso && !pruebaColgada(ahora)) return respuestaCaida();
      pruebaEnCurso = true;
      pruebaDesde = ahora;
    }
    // La prueba lleva tiempo límite: sin él, una conexión colgada la dejaba «en curso» para siempre.
    const limite = esPrueba ? new AbortController() : null;
    const reloj = limite ? setTimeout(() => limite.abort(new Error('la prueba de la base no respondió')), PRUEBA_MAX_MS) : null;
    // Una prueba vieja que termina después de otra más nueva no decide nada.
    const vigente = () => !esPrueba || pruebaDesde === ahora;
    try {
      const signal = limite ? (init?.signal ? AbortSignal.any([init.signal, limite.signal]) : limite.signal) : init?.signal;
      const res = await base(input, limite ? { ...init, signal } : init);
      if (await esCaida(res, esRest)) {
        if (vigente()) abrir();
        const cuerpo = await res.text().catch(() => '');
        return respuestaCaida(CODIGO_CAIDA.test(cuerpo) ? JSON.parse(cuerpo).message : undefined);
      }
      if (esPrueba && esRest && vigente()) cerrar();
      return res;
    } catch (err) {
      // Sin respuesta (red, DNS, timeout): igual que una caída si era una consulta.
      if (esRest) {
        if (vigente()) abrir();
        return respuestaCaida(err instanceof Error ? err.message : undefined);
      }
      throw err;
    } finally {
      if (reloj) clearTimeout(reloj);
      if (esPrueba && vigente()) pruebaEnCurso = false;
    }
  };
}
