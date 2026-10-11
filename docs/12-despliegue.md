# 12 · Despliegue

> Revisado contra el código el 11/10/2026.

Frontend en **Vercel** (https://backio.vercel.app), backend en **Railway** (https://backiobackend-production.up.railway.app).
Ambos salen del mismo repo, `luispalaciosec/backIO`, rama `main`.

- **Backend:** Railway despliega solo en cada push a `main`.
- **Frontend:** el workflow `.github/workflows/deploy-frontend.yml` despliega a Vercel producción cuando el CI de un
  push a `main` termina en verde. Necesita el secreto `VERCEL_TOKEN` en el repo (Settings → Secrets and variables →
  Actions); sin él, el job deja un aviso y no despliega.

---

## CI

`.github/workflows/ci.yml` corre en cada push a `main` y en cada pull request, con Node 22:

1. `pnpm install --frozen-lockfile`
2. `pnpm audit --prod --audit-level=high` (falla con vulnerabilidades altas o críticas en dependencias de producción)
3. `pnpm typecheck`
4. `pnpm lint`
5. `pnpm test`
6. Build del frontend
7. Regenera la [referencia de la API](./referencia-api.md) y falla si quedó distinta de la del repo
8. Build de este sitio de documentación (falla si hay enlaces rotos entre páginas)

Si el CI falla, el frontend no se despliega. Railway no espera al CI: el backend sale igual.
Dependabot (`.github/dependabot.yml`) propone actualizaciones de dependencias una vez por semana.

---

## Backend en Railway

1. New Project → Deploy from GitHub repo → `luispalaciosec/backIO`.
2. En Settings → Source del servicio:
   - **Root Directory**: vacío (la raíz del repo). El Dockerfile necesita `shared/` y el lockfile.
     Si Railway lo puso en `backend` al detectar el monorepo, bórralo.
   - El builder y la ruta del Dockerfile (`backend/Dockerfile`) los toma de `railway.json` en la raíz. Si prefieres
     forzarlo por variable: `RAILWAY_DOCKERFILE_PATH=backend/Dockerfile`.
   - `railway.json` también fija el healthcheck en `/health` (espera hasta 120 s) y el reinicio ante fallo
     (`ON_FAILURE`, hasta 5 intentos).
   - La imagen usa Node 22 y la versión de pnpm de `packageManager`, y arranca con `ENABLE_INTERNAL_CRON=1` y
     `NODE_ENV=production`.
3. Variables (Settings → Variables). La lista completa, con qué hace cada una y cuáles son opcionales, está en
   `backend/.env.example`. Las que producción necesita:

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | `https://gckjyjvqvdfayjrtfbmj.supabase.co` |
| `SUPABASE_ANON_KEY` | anon key del proyecto |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key (solo aquí, nunca en el frontend) |
| `FRONTEND_URL` | `https://backio.vercel.app`. Orígenes admitidos por CORS, separados por coma. En producción deben ser https y sin `localhost`: si no, el backend lo avisa en el log al arrancar |
| `BACKEND_PUBLIC_URL` | `https://backiobackend-production.up.railway.app` (emisor OAuth y URL del webhook de Basecamp) |
| `ANTHROPIC_API_KEY` | Activa todas las funciones de IA (daily, weekly, informes, brief, recordatorios, resumen del portal). Sin ella se ocultan |
| `BASECAMP_CLIENT_ID` / `BASECAMP_CLIENT_SECRET` / `BASECAMP_ACCOUNT_ID` | de la app OAuth de Basecamp |
| `BASECAMP_REDIRECT_URI` | `https://backiobackend-production.up.railway.app/api/basecamp/oauth/callback` (debe coincidir en Basecamp) |
| `BASECAMP_USER_AGENT` | Identificación que exige la API de Basecamp (nombre de la app y un correo de contacto) |
| `BASECAMP_WEBHOOK_SECRET` | token aleatorio largo; va en la URL del webhook `/api/webhooks/basecamp/<token>` (Basecamp no firma payloads). Para rotarlo, ver [Operación](./operacion.md#rotar-el-secreto-del-webhook-de-basecamp) |
| `PROMETIO_WEBHOOK_SECRET` | secreto compartido con PrometIO (HMAC en `X-Prometio-Signature`) |
| `RESEND_API_KEY` | API key de Resend (cuenta geeks, dominio `crm.geeks.com.ec` verificado). Sin ella no salen correos |
| `EMAIL_FROM` | `BackIO <no-reply@crm.geeks.com.ec>` |
| `CRON_SECRET` | Solo si algo externo dispara `/api/cron`. Sin ella, en producción esos endpoints responden 401 |
| `SENTRY_DSN` | Errores del backend a Sentry (opcional) |
| `TURNSTILE_SECRET_KEY` | Captcha en login y recuperar contraseña (opcional; sin ella no se pide) |

Opcionales que también lee el backend: `LOG_LEVEL` (por defecto `info` en producción), `PROMETIO_URL` (solo para el
chequeo de salud de Admin → Servicios) y `BACKEND_PORT` (solo en local). `ENABLE_INTERNAL_CRON` y `NODE_ENV` ya
vienen en el Dockerfile.

Railway inyecta `PORT`; el backend lo usa automáticamente.

4. Settings → Networking → Generate Domain. Esa URL es la que va en
   `NEXT_PUBLIC_BACKEND_URL` del frontend y en los webhooks de Basecamp y PrometIO.

Tareas programadas: con `ENABLE_INTERNAL_CRON=1` el propio proceso corre todas las de `backend/src/lib/jobs.ts`
(reconciliación y estructura de Basecamp, horas, señales del weekly, recurrencias, KPIs, evolutivo y otras), más un
vigía que avisa si alguna no corre. No hace falta configurar nada más en Railway. La tabla con horarios está en
[Operación](./operacion.md#lo-que-corre-solo).

---

## Frontend en Vercel

El proyecto de Vercel ya existe y tiene **Root Directory** `frontend`. Install y build están en
`frontend/vercel.json` (instala desde la raíz del monorepo). El deploy normal es el automático descrito arriba.

La documentación viaja con el frontend: su `pnpm build` compila `docs/` con VitePress, la copia a
`frontend/public/docs` y queda en `https://backio.vercel.app/docs`, pública y sin pedir sesión, con una política de
seguridad de contenido propia (`frontend/middleware.ts`).

Deploy manual, si hace falta (por ejemplo, sin `VERCEL_TOKEN`): desde la **raíz** del repo,

```bash
vercel deploy --prod
```

Variables (Project → Settings → Environment Variables). La lista con comentarios está en `frontend/.env.example`:

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://gckjyjvqvdfayjrtfbmj.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key (la misma del backend) |
| `NEXT_PUBLIC_BACKEND_URL` | `https://backiobackend-production.up.railway.app` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Clave del sitio de Turnstile (opcional; va junto con `TURNSTILE_SECRET_KEY` del backend) |
| `NEXT_PUBLIC_SENTRY_DSN` | Errores del navegador y del servidor de Next a Sentry (opcional) |

Las variables `NEXT_PUBLIC_*` se fijan al compilar: después de cambiarlas hay que volver a desplegar el frontend.
Todo lo que empieza con `NEXT_PUBLIC_` llega al navegador, así que ahí nunca va una clave secreta.

Si cambia la URL del frontend, actualizar `FRONTEND_URL` del backend en Railway para que CORS acepte el dominio.

---

## Supabase Auth

Authentication → URL Configuration:
- **Site URL**: `https://backio.vercel.app`.
- **Redirect URLs**: la misma más `http://localhost:3000` para desarrollo.

El registro público está deshabilitado y «Confirm email» activo: las cuentas entran solo por invitación
(ver [Setup](./11-setup.md#usuarios)).

---

## Dominios (cuando toque)

| Servicio | Dominio sugerido |
|---|---|
| Frontend | `backio.geeks.ec` |
| Backend | `api.backio.geeks.ec` |

El portal cliente vive en `backio.geeks.ec/p/<token>`. Al cambiar dominios, actualizar
`FRONTEND_URL`, `BACKEND_PUBLIC_URL`, `NEXT_PUBLIC_BACKEND_URL`, `BASECAMP_REDIRECT_URI` y la Site URL de Supabase,
y volver a desplegar el frontend.

---

## Orden recomendado (montaje desde cero)

1. Railway primero (para tener la URL del backend).
2. Vercel con esa URL.
3. Volver a Railway a poner `FRONTEND_URL`.
4. Supabase Auth con la URL de Vercel.
5. Probar login y `/health`.
