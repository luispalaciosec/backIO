import { supabaseServer } from './supabase/server';
import { BACKEND, ApiError } from './api';

export async function apiServer<T>(path: string): Promise<T> {
  const { data } = await supabaseServer().auth.getSession();
  const t = data.session?.access_token;
  const res = await fetch(`${BACKEND}/api/v1${path}`, { headers: t ? { Authorization: `Bearer ${t}` } : {}, cache: 'no-store' });
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Error ${res.status}`);
  return body;
}
