// Sentry en el navegador (Next 15 carga este archivo antes que la app). Inactivo sin NEXT_PUBLIC_SENTRY_DSN.
import * as Sentry from '@sentry/nextjs';
import { SENTRY_DSN, opcionesSentry } from './lib/sentry';

if (SENTRY_DSN) Sentry.init(opcionesSentry);
