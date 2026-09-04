/**
 * Cliente HTTP de Basecamp 3.
 *  - User-Agent obligatorio (Basecamp bloquea sin él).
 *  - Rate limit 50 req / 10 s → cola con backoff exponencial.
 *  - OAuth2 a nivel de organización; tokens en tenants.config.basecamp (refresh automático).
 * Las respuestas se tipan SOLO con los campos que BackIO necesita. Nunca se guardan enteras.
 */
import { env } from '../../config/env';
import { serviceClient } from '../db/client';

export interface BasecampTokens {
  access_token: string;
  refresh_token: string;
  expires_at: string; // ISO
}

export interface BcTodolistRef { id: number; app_url: string }
export interface BcTodoRef { id: number; app_url: string }

const MAX_POR_VENTANA = 45;
const VENTANA_MS = 10_000;

export class BasecampClient {
  private timestamps: number[] = [];
  constructor(
    private readonly tenantId: string,
    private tokens: BasecampTokens,
  ) {}

  static async forTenant(tenantId: string): Promise<BasecampClient> {
    const db = serviceClient();
    const { data, error } = await db.from('tenants').select('config').eq('id', tenantId).single();
    if (error) throw new Error(`No se pudo leer config del tenant: ${error.message}`);
    const cfg = (data as { config: { basecamp?: BasecampTokens } }).config;
    if (!cfg.basecamp?.access_token) throw new Error('Basecamp no está conectado para este tenant (falta OAuth)');
    return new BasecampClient(tenantId, cfg.basecamp);
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
    this.tokens = await refreshTokens(this.tokens);
    const db = serviceClient();
    const { data } = await db.from('tenants').select('config').eq('id', this.tenantId).single();
    const cfg = (data as { config: Record<string, unknown> } | null)?.config ?? {};
    const prev = (cfg.basecamp as Record<string, unknown> | undefined) ?? {};
    await db.from('tenants').update({ config: { ...cfg, basecamp: { ...prev, ...this.tokens } } }).eq('id', this.tenantId);
  }

  async request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, intento = 0): Promise<T> {
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
      return this.request<T>(method, path, body, intento + 1);
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

  async createTodolist(projectId: number, todosetId: number, input: { name: string; description?: string }): Promise<BcTodolistRef> {
    const r = await this.request<{ id: number; app_url: string }>('POST', `/buckets/${projectId}/todosets/${todosetId}/todolists.json`, input);
    return { id: r.id, app_url: r.app_url };
  }

  async createTodo(projectId: number, todolistId: number, input: { content: string; due_on?: string | null; assignee_ids?: number[] }): Promise<BcTodoRef> {
    const r = await this.request<{ id: number; app_url: string }>('POST', `/buckets/${projectId}/todolists/${todolistId}/todos.json`, input);
    return { id: r.id, app_url: r.app_url };
  }

  async updateTodo(projectId: number, todoId: number, input: { due_on?: string | null; assignee_ids?: number[] }): Promise<void> {
    await this.request('PUT', `/buckets/${projectId}/todos/${todoId}.json`, input);
  }

  /** Polling de reconciliación: devuelve el to-do crudo; el llamador DEBE pasar por extractSafeTodo. */
  async getTodoRaw(projectId: number, todoId: number): Promise<unknown> {
    return this.request<unknown>('GET', `/buckets/${projectId}/todos/${todoId}.json`);
  }

  async createDocument(projectId: number, vaultId: number, input: { title: string; content: string; status?: 'active' | 'drafted' }): Promise<{ id: number; app_url: string }> {
    const r = await this.request<{ id: number; app_url: string }>('POST', `/buckets/${projectId}/vaults/${vaultId}/documents.json`, { status: 'active', ...input });
    return { id: r.id, app_url: r.app_url };
  }

  async registerWebhook(projectId: number, payloadUrl: string): Promise<{ id: number }> {
    return this.request<{ id: number }>('POST', `/buckets/${projectId}/webhooks.json`, {
      payload_url: payloadUrl,
      types: ['Todo'],
    });
  }
}
