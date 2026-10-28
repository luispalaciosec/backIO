/**
 * Cliente HTTP de Basecamp 3.
 *  - User-Agent obligatorio (Basecamp bloquea sin él).
 *  - Rate limit 50 req / 10 s → cola con backoff exponencial.
 *  - Dos clases de token (migración 33): el de cada persona (`forActor`, lo que alguien hace desde BackIO sale a su
 *    nombre en Basecamp) y el del tenant (`forTenant`, lo automático, con un usuario «BackIO»). Solo servidor, con
 *    refresh automático (credenciales.ts).
 * Las respuestas se tipan SOLO con los campos que BackIO necesita. Nunca se guardan enteras.
 */
import { log } from '../logger';
import { env } from '../../config/env';
import { DbError } from '../db/client';

export interface BasecampTokens {
  access_token: string;
  refresh_token: string;
  expires_at: string; // ISO
}

export interface BcTodolistRef {
  id: number;
  app_url: string;
}
export interface BcTodoRef {
  id: number;
  app_url: string;
}

const MAX_POR_VENTANA = 45;
const VENTANA_MS = 10_000;

/**
 * El GET de un to-do devuelve la descripción ya renderizada: cada adjunto (imagen, archivo, mención) trae adentro su
 * <figure><img>…</figure>. Si eso se devuelve tal cual en el PUT, Basecamp lo toma como contenido y el adjunto se
 * desarma (pierde nombre y enlace, se duplica la vista previa) cada vez que BackIO cambia la fecha.
 * La API espera el adjunto vacío: <bc-attachment sgid="…"></bc-attachment> (con caption si lo tenía).
 * Solo se reescriben los adjuntos; el resto de la descripción pasa intacto y nunca se guarda en BackIO (regla 1).
 */
export function descripcionParaGuardar(html: string): string {
  const limpio = html.replace(/<bc-attachment\b([^>]*)>[\s\S]*?<\/bc-attachment>/gi, (completo, attrs: string) => {
    const sgid = /\ssgid="([^"]+)"/i.exec(attrs)?.[1];
    if (!sgid) return completo;
    const caption = /\scaption="([^"]*)"/i.exec(attrs)?.[1];
    return `<bc-attachment sgid="${sgid}"${caption ? ` caption="${caption}"` : ''}></bc-attachment>`;
  });
  // Restos de guardados anteriores: la foto de perfil de una mención quedó suelta fuera del adjunto. Con los adjuntos
  // ya vacíos, una <figure> con un avatar solo puede venir de ese error (nadie pega su avatar en una nota).
  return limpio.replace(/<figure\b[^>]*>(?:(?!<\/figure>)[\s\S])*?<img\b[^>]*class="[^"]*\bavatar\b[^"]*"[\s\S]*?<\/figure>/gi, '');
}

/** La persona no conectó su Basecamp: BackIO no escribe a nombre de otro (decisión de Luis, 16/10/2026). */
export class BasecampSinConectar extends DbError {
  readonly codigo = 'basecamp_sin_conectar';
  constructor(mensaje?: string) {
    super(
      mensaje ??
        'Para que esto salga a tu nombre en Basecamp, primero conecta tu cuenta con «Conectar mi Basecamp» (arriba en la pantalla).',
      428,
    );
  }
}

export class BasecampClient {
  private timestamps: number[] = [];
  constructor(
    private readonly tenantId: string,
    private tokens: BasecampTokens,
    /** Dueño del token si es el de una persona; null = el del tenant. */
    private readonly usuarioId: string | null = null,
  ) {}

  /**
   * Para lo automático que tiene una persona responsable (el fee de una ejecutiva, la fecha que alguien cambió): su
   * cuenta si la conectó. Si no, null: NO se escribe con la cuenta de otro (decisión de Luis, 19/10/2026: nada puede
   * salir en Basecamp a nombre de quien no lo hizo). Quien llama lo deja pendiente y avisa.
   */
  static async forResponsable(tenantId: string, usuarioId: string | null): Promise<BasecampClient | null> {
    if (!usuarioId) return null;
    const { leerCredencialesPersona } = await import('../db/credenciales');
    const c = await leerCredencialesPersona(usuarioId);
    if (!c?.access_token || !c.refresh_token || !c.expires_at) return null;
    return new BasecampClient(
      tenantId,
      { access_token: c.access_token, refresh_token: c.refresh_token, expires_at: c.expires_at },
      usuarioId,
    );
  }

  /**
   * Cliente para escribir en Basecamp: SIEMPRE con la cuenta de una persona, así el to-do, el mensaje o el cambio salen
   * a su nombre. Una API key (agente o integración) escribe a nombre de quien la creó. Sin persona, o si la persona no
   * conectó su cuenta, lanza BasecampSinConectar: nunca se escribe con la cuenta de la integración (19/10/2026). Hay
   * que llamarlo ANTES de cambiar nada en BackIO. La cuenta de la integración (forTenant) queda solo para leer.
   */
  static async forActor(ctx: { tenantId: string; usuarioId: string | null; apiKeyId?: string | null }): Promise<BasecampClient> {
    let persona = ctx.usuarioId;
    if (!persona && ctx.apiKeyId) {
      const { creadorDeApiKey } = await import('../db/auth');
      persona = await creadorDeApiKey(ctx.apiKeyId);
    }
    const c = await BasecampClient.forResponsable(ctx.tenantId, persona);
    if (!c) throw new BasecampSinConectar(persona ? undefined : 'Esta acción no tiene una persona a cuyo nombre escribir en Basecamp.');
    return c;
  }

  static async forTenant(tenantId: string): Promise<BasecampClient> {
    const { leerCredencialesBasecamp } = await import('./credenciales');
    const cfg = await leerCredencialesBasecamp(tenantId);
    if (!cfg?.access_token || !cfg.refresh_token || !cfg.expires_at)
      throw new Error('Basecamp no está conectado para este tenant (falta OAuth)');
    return new BasecampClient(tenantId, { access_token: cfg.access_token, refresh_token: cfg.refresh_token, expires_at: cfg.expires_at });
  }

  private base(): string {
    return `https://3.basecampapi.com/${env().BASECAMP_ACCOUNT_ID}`;
  }

  private async throttle(): Promise<void> {
    const ahora = Date.now();
    this.timestamps = this.timestamps.filter((t) => ahora - t < VENTANA_MS);
    if (this.timestamps.length >= MAX_POR_VENTANA) {
      const espera = VENTANA_MS - (ahora - this.timestamps[0]!) + 50;
      await new Promise((r) => setTimeout(r, espera));
      return this.throttle();
    }
    this.timestamps.push(Date.now());
  }

  private async refreshIfNeeded(): Promise<void> {
    if (new Date(this.tokens.expires_at).getTime() - Date.now() > 60_000) return;
    const { refreshTokens } = await import('./oauth');
    if (this.usuarioId) {
      // Token de una persona: mismo criterio (reutilizar si otra petición ya refrescó), en su propia fila.
      const { leerCredencialesPersona, actualizarTokensPersona } = await import('../db/credenciales');
      const actual = await leerCredencialesPersona(this.usuarioId);
      if (!actual) throw new BasecampSinConectar();
      if (actual.access_token !== this.tokens.access_token && new Date(actual.expires_at).getTime() - Date.now() > 60_000) {
        this.tokens = { access_token: actual.access_token, refresh_token: actual.refresh_token, expires_at: actual.expires_at };
        return;
      }
      this.tokens = await refreshTokens(this.tokens);
      await actualizarTokensPersona(this.usuarioId, { ...actual, ...this.tokens });
      return;
    }
    const { leerCredencialesBasecamp, guardarCredencialesBasecamp } = await import('./credenciales');
    // Si otra instancia (scheduler u otra petición) ya refrescó, se reutiliza ese token en vez de pisarlo.
    const actual = await leerCredencialesBasecamp(this.tenantId);
    if (
      actual?.access_token &&
      actual.refresh_token &&
      actual.expires_at &&
      actual.access_token !== this.tokens.access_token &&
      new Date(actual.expires_at).getTime() - Date.now() > 60_000
    ) {
      this.tokens = { access_token: actual.access_token, refresh_token: actual.refresh_token, expires_at: actual.expires_at };
      return;
    }
    this.tokens = await refreshTokens(this.tokens);
    await guardarCredencialesBasecamp(this.tenantId, { ...(actual ?? {}), ...this.tokens });
  }

  /**
   * Basecamp rechazó un token que no había vencido por fecha (p. ej. «OAuth token expired (rekeyed_identity)»). Se pide uno
   * nuevo con el refresh; si eso falla y la cuenta es de una persona, se borra su conexión: BackIO deja de mostrarla como
   * conectada y le pide conectar otra vez («Mi Basecamp»), en vez de fallar en silencio en cada cambio (Grace, 19/10/2026).
   */
  private async renovarTrasRechazo(): Promise<void> {
    try {
      this.tokens = { ...this.tokens, expires_at: new Date(0).toISOString() };
      await this.refreshIfNeeded();
    } catch (err) {
      await this.desconectarPersona();
      throw err;
    }
  }

  private async desconectarPersona(): Promise<void> {
    if (!this.usuarioId) return;
    const { borrarCredencialesPersona } = await import('../db/credenciales');
    await borrarCredencialesPersona(this.usuarioId);
    log.warn('[basecamp] conexión de la persona rechazada por Basecamp; se borra para que vuelva a conectar', this.usuarioId);
    throw new BasecampSinConectar('Tu conexión con Basecamp venció. Vuelve a conectarla en «Mi Basecamp» y repite el cambio.');
  }

  async request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, intento = 0, renovado = false): Promise<T> {
    await this.refreshIfNeeded();
    await this.throttle();
    const res = await fetch(`${this.base()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.tokens.access_token}`,
        'User-Agent': env().BASECAMP_USER_AGENT,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429 || res.status >= 500) {
      if (intento >= 5) throw new Error(`Basecamp ${res.status} tras ${intento} reintentos: ${path}`);
      const retryAfter = Number(res.headers.get('Retry-After')) || 2 ** intento;
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return this.request<T>(method, path, body, intento + 1, renovado);
    }
    if (res.status === 401) {
      if (!renovado) {
        await this.renovarTrasRechazo();
        return this.request<T>(method, path, body, intento, true);
      }
      await this.desconectarPersona();
    }
    if (!res.ok) throw new Error(`Basecamp ${res.status} ${method} ${path}: ${await res.text()}`);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** Devuelve el id del todoset del proyecto (necesario para crear todolists). */
  async getTodosetId(projectId: number): Promise<number> {
    const p = await this.request<{ dock: { name: string; id: number }[] }>('GET', `/projects/${projectId}.json`);
    const todoset = p.dock.find((d) => d.name === 'todoset');
    if (!todoset) throw new Error(`Proyecto ${projectId} sin todoset`);
    return todoset.id;
  }

  /** Dock del proyecto: herramientas con id y título (todoset, message_board ×N, vault, schedule…). Solo metadatos. */
  async getDock(projectId: number): Promise<{ name: string; title: string; id: number; enabled: boolean }[]> {
    const p = await this.request<{ dock: { name: string; title: string; id: number; enabled: boolean }[] }>(
      'GET',
      `/projects/${projectId}.json`,
    );
    return p.dock.map((d) => ({ name: d.name, title: d.title, id: d.id, enabled: d.enabled }));
  }

  /** Listas de to-dos del proyecto: solo id y nombre (para reutilizar por nombre). */
  /**
   * Todas las listas activas del proyecto, con todas sus páginas. Antes se pedía solo la primera página (15 listas):
   * lo que quedaba más abajo nunca entraba a BackIO (Campaña Factoring y Neo cuenta de Banco Amazonas, 28/10/2026).
   */
  async listTodolists(projectId: number, todosetId: number): Promise<{ id: number; name: string; completed: boolean }[]> {
    const r = await this.requestAll<{ id: number; name: string; completed?: boolean }>(
      `/buckets/${projectId}/todosets/${todosetId}/todolists.json?status=active`,
      100,
    );
    return r.map((l) => ({ id: l.id, name: l.name, completed: l.completed === true }));
  }

  /** Grupos de una lista, con todas sus páginas. */
  async listGroups(projectId: number, todolistId: number): Promise<{ id: number; name: string }[]> {
    const r = await this.requestAll<{ id: number; name: string }>(`/buckets/${projectId}/todolists/${todolistId}/groups.json`, 50);
    return r.map((g) => ({ id: g.id, name: g.name }));
  }

  async createGroup(projectId: number, todolistId: number, name: string): Promise<{ id: number; name: string }> {
    const r = await this.request<{ id: number; name: string }>('POST', `/buckets/${projectId}/todolists/${todolistId}/groups.json`, {
      name,
    });
    return { id: r.id, name: r.name };
  }

  async createMessage(
    projectId: number,
    boardId: number,
    input: { subject: string; content: string },
  ): Promise<{ id: number; app_url: string }> {
    const r = await this.request<{ id: number; app_url: string }>('POST', `/buckets/${projectId}/message_boards/${boardId}/messages.json`, {
      ...input,
      status: 'active',
    });
    return { id: r.id, app_url: r.app_url };
  }

  async createTodolist(projectId: number, todosetId: number, input: { name: string; description?: string }): Promise<BcTodolistRef> {
    const r = await this.request<{ id: number; app_url: string }>(
      'POST',
      `/buckets/${projectId}/todosets/${todosetId}/todolists.json`,
      input,
    );
    return { id: r.id, app_url: r.app_url };
  }

  async createTodo(
    projectId: number,
    todolistId: number,
    input: { content: string; due_on?: string | null; assignee_ids?: number[]; completion_subscriber_ids?: number[] },
  ): Promise<BcTodoRef> {
    const r = await this.request<{ id: number; app_url: string }>(
      'POST',
      `/buckets/${projectId}/todolists/${todolistId}/todos.json`,
      input,
    );
    return { id: r.id, app_url: r.app_url };
  }

  /**
   * PUT parcial seguro. Basecamp trata el PUT de un to-do como REEMPLAZO: si no se envían
   * `assignee_ids`, `content`, `description`, etc., los borra. Por eso se lee el to-do vivo y se
   * reenvían esos campos tal cual (sin leer ni guardar descripción: solo se reenvía la que ya está allá).
   */
  async updateTodo(
    projectId: number,
    todoId: number,
    input: { due_on?: string | null; assignee_ids?: number[]; content?: string },
  ): Promise<void> {
    const vivo = await this.request<{
      content?: string;
      description?: string;
      due_on?: string | null;
      starts_on?: string | null;
      assignees?: { id: number }[];
      completion_subscribers?: { id: number }[];
      notify?: boolean;
    }>('GET', `/buckets/${projectId}/todos/${todoId}.json`);
    const cuerpo = {
      content: input.content ?? vivo.content,
      description: descripcionParaGuardar(vivo.description ?? ''),
      due_on: input.due_on !== undefined ? input.due_on : (vivo.due_on ?? null),
      starts_on: vivo.starts_on ?? null,
      assignee_ids: input.assignee_ids ?? (vivo.assignees ?? []).map((a) => a.id),
      completion_subscriber_ids: (vivo.completion_subscribers ?? []).map((a) => a.id),
      notify: false,
    };
    await this.request('PUT', `/buckets/${projectId}/todos/${todoId}.json`, cuerpo);
  }

  /** Desmarca un to-do completado (reproceso). */
  async uncompleteTodo(projectId: number, todoId: number): Promise<void> {
    await this.request('DELETE', `/buckets/${projectId}/todos/${todoId}/completion.json`);
  }

  /** GET paginado (Link: rel="next"). Devuelve la unión de páginas. */
  /** Personas de la cuenta Basecamp: solo id, nombre y email (para enlazar usuarios). */
  async listPeopleSafe(): Promise<
    { id: number; nombre: string; email: string | null; admin: boolean; avatar_url: string | null; sgid: string | null }[]
  > {
    const raw = await this.requestAll<{
      id: number;
      name: string;
      email_address?: string | null;
      admin?: boolean;
      avatar_url?: string | null;
      attachable_sgid?: string | null;
    }>('/people.json');
    // attachable_sgid: identificador para @mencionar a la persona en mensajes (bc-attachment). Sin él no hay etiqueta.
    return raw.map((p) => ({
      id: p.id,
      nombre: p.name,
      email: p.email_address ? p.email_address.toLowerCase() : null,
      admin: Boolean(p.admin),
      avatar_url: typeof p.avatar_url === 'string' ? p.avatar_url : null,
      sgid: typeof p.attachable_sgid === 'string' ? p.attachable_sgid : null,
    }));
  }

  async requestAll<T>(path: string, maxPages = 20): Promise<T[]> {
    const out: T[] = [];
    let url: string | null = `${this.base()}${path}`;
    let renovadoAll = false;
    for (let i = 0; i < maxPages && url; i++) {
      await this.refreshIfNeeded();
      await this.throttle();
      const res: Response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.tokens.access_token}`, 'User-Agent': env().BASECAMP_USER_AGENT },
      });
      if (res.status === 401 && !renovadoAll) {
        renovadoAll = true;
        await this.renovarTrasRechazo();
        i -= 1;
        continue;
      }
      if (res.status === 401) await this.desconectarPersona();
      if (!res.ok) throw new Error(`Basecamp ${res.status} GET ${url}: ${await res.text()}`);
      const page = (await res.json()) as T[];
      out.push(...(Array.isArray(page) ? page : []));
      const link = res.headers.get('Link') ?? '';
      const m = /<([^>]+)>;\s*rel="next"/.exec(link);
      url = m ? m[1]! : null;
    }
    // Se agotó el tope de páginas y Basecamp todavía tenía más: se avisa en vez de cortar en silencio.
    if (url) log.warn('[basecamp] requestAll cortó en el tope de páginas; faltan datos', path, maxPages);
    return out;
  }

  /**
   * To-dos de una lista o grupo. SOLO campos permitidos (docs/02 + excepción D1 para el título):
   * id, title, due_on, completed, completed_at, assignee ids, creator id/name, app_url. Nunca description ni comments.
   */
  async listTodosSafe(
    projectId: number,
    todolistId: number,
    incluirCompletados = true,
  ): Promise<
    {
      id: number;
      titulo: string;
      due_on: string | null;
      completed: boolean;
      completed_at: string | null;
      assignee_ids: number[];
      creator_id: number | null;
      creator_nombre: string | null;
      app_url: string | null;
      created_at: string | null;
    }[]
  > {
    type Raw = {
      id: number;
      title?: string;
      content?: string;
      due_on?: string | null;
      completed?: boolean;
      completed_at?: string | null;
      assignees?: { id: number }[];
      creator?: { id: number; name?: string };
      app_url?: string;
      created_at?: string;
    };
    const activos = await this.requestAll<Raw>(`/buckets/${projectId}/todolists/${todolistId}/todos.json`);
    const done = incluirCompletados
      ? await this.requestAll<Raw>(`/buckets/${projectId}/todolists/${todolistId}/todos.json?completed=true`)
      : [];
    const vistos = new Set<number>();
    return [...activos, ...done]
      .filter((t) => (vistos.has(t.id) ? false : (vistos.add(t.id), true)))
      .map((t) => ({
        id: t.id,
        titulo: String(t.title ?? t.content ?? '')
          .replace(/<[^>]+>/g, '')
          .trim()
          .slice(0, 200),
        due_on: t.due_on ?? null,
        completed: t.completed === true,
        completed_at: t.completed_at ?? null,
        assignee_ids: (t.assignees ?? []).map((a) => a.id),
        creator_id: t.creator?.id ?? null,
        creator_nombre: t.creator?.name ?? null,
        app_url: t.app_url ?? null,
        created_at: t.created_at ?? null,
      }));
  }

  /**
   * Reporte de timesheet de TODA la cuenta en un rango (paginado). Basecamp ignora bucket_id en este
   * reporte y devuelve siempre la cuenta completa, por eso se llama una sola vez y cada entrada trae su
   * propio proyecto (bucket_id). SOLO: id, date, hours, person id, parent id/type, bucket id.
   * La description de cada entrada es texto de Basecamp y se descarta aquí mismo.
   */
  async timesheetSafe(
    desde: string,
    hasta: string,
  ): Promise<
    {
      id: number;
      fecha: string;
      horas: number;
      person_id: number | null;
      parent_id: number | null;
      parent_type: string | null;
      bucket_id: number | null;
    }[]
  > {
    type Raw = {
      id: number;
      date?: string;
      hours?: number | string;
      person?: { id: number };
      parent?: { id: number; type?: string };
      bucket?: { id: number };
    };
    const raw = await this.requestAll<Raw>(`/reports/timesheet.json?start_date=${desde}&end_date=${hasta}`, 50);
    const vistos = new Set<number>();
    return raw
      .filter((e) => typeof e.id === 'number' && e.date && !vistos.has(e.id) && vistos.add(e.id))
      .map((e) => ({
        id: e.id,
        fecha: String(e.date).slice(0, 10),
        horas: parseHoras(e.hours),
        person_id: e.person?.id ?? null,
        parent_id: e.parent?.id ?? null,
        parent_type: e.parent?.type ?? null,
        bucket_id: e.bucket?.id ?? null,
      }));
  }

  /** Polling de reconciliación: devuelve el to-do crudo; el llamador DEBE pasar por extractSafeTodo. */
  async getTodoRaw(projectId: number, todoId: number): Promise<unknown> {
    return this.request<unknown>('GET', `/buckets/${projectId}/todos/${todoId}.json`);
  }

  async createDocument(
    projectId: number,
    vaultId: number,
    input: { title: string; content: string; status?: 'active' | 'drafted' },
  ): Promise<{ id: number; app_url: string }> {
    const r = await this.request<{ id: number; app_url: string }>('POST', `/buckets/${projectId}/vaults/${vaultId}/documents.json`, {
      status: 'active',
      ...input,
    });
    return { id: r.id, app_url: r.app_url };
  }

  /** Diagnóstico: solo metadatos de entregas (fecha y código HTTP). NUNCA el body (contiene texto de Basecamp). */
  async getWebhookDeliveries(
    projectId: number,
    webhookId: number,
  ): Promise<{ activo: boolean; payload_url: string; entregas: { at: string; status: number | null }[] }> {
    const r = await this.request<{
      active: boolean;
      payload_url: string;
      recent_deliveries?: { created_at: string; response?: { code?: number } }[];
    }>('GET', `/buckets/${projectId}/webhooks/${webhookId}.json`);
    return {
      activo: r.active,
      payload_url: r.payload_url,
      entregas: (r.recent_deliveries ?? []).slice(0, 10).map((d) => ({ at: d.created_at, status: d.response?.code ?? null })),
    };
  }

  async registerWebhook(projectId: number, payloadUrl: string): Promise<{ id: number }> {
    return this.request<{ id: number }>('POST', `/buckets/${projectId}/webhooks.json`, {
      payload_url: payloadUrl,
      types: ['Todo'],
    });
  }

  /** Cambia la URL de un webhook ya registrado (rotación del secreto). */
  async updateWebhook(projectId: number, webhookId: number, payloadUrl: string): Promise<void> {
    await this.request('PUT', `/buckets/${projectId}/webhooks/${webhookId}.json`, {
      payload_url: payloadUrl,
      types: ['Todo'],
      active: true,
    });
  }
}

/** "1.5" | "1:30" | 1.5 → horas decimales */
export function parseHoras(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return 0;
  const m = /^(\d+):(\d{1,2})$/.exec(v.trim());
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
