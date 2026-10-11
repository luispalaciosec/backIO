// Sentry en el servidor de Next (componentes de servidor, middleware). Inactivo sin NEXT_PUBLIC_SENTRY_DSN.
import * as Sentry from '@sentry/nextjs';
import { SENTRY_DSN, opcionesSentry } from './lib/sentry';

export async function register() {
  if (SENTRY_DSN) Sentry.init(opcionesSentry);
}

export const onRequestError = Sentry.captureRequestError;
