/** Cuenta de Basecamp de cada persona (migración 33): lo que hace desde BackIO sale a su nombre en Basecamp. */
import { api } from './api';

export interface MiBasecamp {
  conectado: boolean;
  conectado_at: string | null;
  email: string | null;
}

export const leerMiBasecamp = () => api<MiBasecamp>('/basecamp/mi-cuenta');

/** Lleva al navegador a Basecamp para autorizar la cuenta propia; vuelve a /mi-basecamp. */
export async function conectarMiBasecamp(): Promise<void> {
  const { url } = await api<{ url: string }>('/basecamp/mi-cuenta/url');
  window.location.href = url;
}
