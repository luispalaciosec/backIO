import { supabaseServer } from './supabase/server';
import { BACKEND, pedir } from './api';

/** API v1 desde componentes de servidor, con la sesión de las cookies. */
export async function apiServer<T>(path: string): Promise<T> {
  const { data } = await (await supabaseServer()).auth.getSession();
  return pedir<T>(`${BACKEND}/api/v1${path}`, { token: data.session?.access_token });
}
