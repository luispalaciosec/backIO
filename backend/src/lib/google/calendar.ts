/**
 * Lectura del Google Calendar de una persona (docs/23). Regla 1: a Google se le pide solo id, estado, inicio, fin y la
 * respuesta de cada invitado (parámetro `fields`): nunca el título, la descripción, el lugar ni las notas. De los
 * invitados se calcula aquí el DOMINIO de los externos y los correos se descartan.
 */
import { actualizarTokensGoogle, leerTokensGoogle } from '../db/google';
import { ErrorGoogle, renovarTokensGoogle } from './oauth';

export interface EventoGoogleSafe {
  id: string;
  inicio: string;
  fin: string;
  todo_el_dia: boolean;
  cancelado: boolean;
  respuesta: 'aceptada' | 'tentativa' | 'sin_respuesta' | 'rechazada';
  /** Dominios de los invitados que no son de la agencia (para saber el cliente). */
  dominios_externos: string[];
}

const CAMPOS = 'nextPageToken,items(id,status,start,end,attendees(email,self,responseStatus))';

interface RawEvento {
  id?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string; self?: boolean; responseStatus?: string }[];
}

const dominio = (email?: string) => (email?.split('@')[1] ?? '').trim().toLowerCase();

/** Pasa un evento crudo de Google a su forma segura, sin ningún texto. */
export function eventoSeguro(e: RawEvento, dominioPropio: string): EventoGoogleSafe | null {
  if (!e.id) return null;
  const todoElDia = !e.start?.dateTime || !e.end?.dateTime;
  const yo = (e.attendees ?? []).find((a) => a.self);
  const r = yo?.responseStatus;
  return {
    id: e.id,
    inicio: e.start?.dateTime ?? `${e.start?.date ?? ''}T00:00:00Z`,
    fin: e.end?.dateTime ?? `${e.end?.date ?? ''}T00:00:00Z`,
    todo_el_dia: todoElDia,
    cancelado: e.status === 'cancelled',
    // Sin lista de invitados es un evento propio: cuenta como aceptado.
    respuesta: !yo
      ? 'aceptada'
      : r === 'accepted'
        ? 'aceptada'
        : r === 'tentative'
          ? 'tentativa'
          : r === 'declined'
            ? 'rechazada'
            : 'sin_respuesta',
    dominios_externos: [
      ...new Set(
        (e.attendees ?? [])
          .filter((a) => !a.self)
          .map((a) => dominio(a.email))
          .filter((d) => d && d !== dominioPropio && !d.endsWith('.calendar.google.com')),
      ),
    ],
  };
}

/** Token vigente de la persona (renueva si vence en menos de un minuto). null si no conectó su calendario. */
async function tokenDe(usuarioId: string): Promise<string | null> {
  const t = await leerTokensGoogle(usuarioId);
  if (!t) return null;
  if (Date.parse(t.expires_at) - Date.now() > 60_000) return t.access_token;
  const nuevos = await renovarTokensGoogle(t);
  await actualizarTokensGoogle(usuarioId, nuevos);
  return nuevos.access_token;
}

/** Eventos del calendario principal de la persona entre dos instantes, cada repetición por separado. */
export async function eventosGoogleSafe(
  usuarioId: string,
  email: string,
  desdeIso: string,
  hastaIso: string,
): Promise<EventoGoogleSafe[] | null> {
  const token = await tokenDe(usuarioId);
  if (!token) return null;
  const out: EventoGoogleSafe[] = [];
  let pagina: string | undefined;
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ singleEvents: 'true', timeMin: desdeIso, timeMax: hastaIso, maxResults: '250', fields: CAMPOS });
    if (pagina) q.set('pageToken', pagina);
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new ErrorGoogle(`calendar ${res.status}`, res.status);
    const body = (await res.json()) as { items?: RawEvento[]; nextPageToken?: string };
    for (const e of body.items ?? []) {
      const s = eventoSeguro(e, dominio(email));
      if (s) out.push(s);
    }
    pagina = body.nextPageToken;
    if (!pagina) break;
  }
  return out;
}
