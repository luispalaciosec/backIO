# 12 · Despliegue

Frontend en **Vercel** (https://backio.vercel.app), backend en **Railway** (URL pendiente). Ambos desde el mismo repo
`luispalaciosec/backIO`, rama `main`. Cada push a `main` despliega los dos.

---

## Backend en Railway

1. New Project → Deploy from GitHub repo → `luispalaciosec/backIO`.
2. En Settings → Source del servicio:
   - **Root Directory**: vacío (la raíz del repo). El Dockerfile necesita `shared/` y el lockfile.
     Si Railway lo puso en `backend` al detectar el monorepo, bórralo.
   - El builder y la ruta del Dockerfile los toma de `railway.json` en la raíz. Si prefieres
     forzarlo por variable: `RAILWAY_DOCKERFILE_PATH=backend/Dockerfile`.
   - Healthcheck `/health` también viene de `railway.json`.
3. Variables (Settings → Variables):

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | `https://gckjyjvqvdfayjrtfbmj.supabase.co` |
| `SUPABASE_ANON_KEY` | anon key del proyecto |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key (solo aquí, nunca en el frontend) |
| `FRONTEND_URL` | `https://backio.vercel.app` (para CORS) |
| `ANTHROPIC_API_KEY` | para el resumen ejecutivo del portal |
| `BASECAMP_CLIENT_ID` / `BASECAMP_CLIENT_SECRET` / `BASECAMP_ACCOUNT_ID` | de la app OAuth de Basecamp |
| `BASECAMP_REDIRECT_URI` | `https://<backend>/api/basecamp/oauth/callback` (debe coincidir en Basecamp) |
| `BASECAMP_WEBHOOK_SECRET` / `PROMETIO_WEBHOOK_SECRET` | secretos compartidos |
| `ENABLE_INTERNAL_CRON` | `1` (ya viene en el Dockerfile; los crons corren dentro del proceso) |
| `NODE_ENV` | `production` |

Railway inyecta `PORT`; el backend lo usa automáticamente.

4. Settings → Networking → Generate Domain. Esa URL es la que va en
   `NEXT_PUBLIC_BACKEND_URL` del frontend y en los webhooks de Basecamp y PrometIO.

Crons: con `ENABLE_INTERNAL_CRON=1` el proceso reconcilia Basecamp cada 30 min y calcula
señales los domingos 18:00 (Guayaquil). No hace falta configurar nada más en Railway.

---

## Frontend en Vercel

1. Add New → Project → importar `luispalaciosec/backIO`.
2. Configuración:
   - **Root Directory**: `frontend`
   - **Framework Preset**: Next.js (lo detecta solo)
   - Install y build ya están en `frontend/vercel.json` (instala desde la raíz del monorepo)
3. Environment Variables:

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://gckjyjvqvdfayjrtfbmj.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key (la misma del backend) |
| `NEXT_PUBLIC_BACKEND_URL` | URL del backend en Railway, sin barra final |

4. Deploy. Luego copiar la URL de Vercel en `FRONTEND_URL` del backend (Railway) y
   redeployar el backend para que CORS acepte el dominio.

---

## Supabase Auth

Authentication → URL Configuration:
- **Site URL**: `https://backio.vercel.app`.
- **Redirect URLs**: la misma más `http://localhost:3000` para desarrollo.

---

## Dominios (cuando toque)

| Servicio | Dominio sugerido |
|---|---|
| Frontend | `backio.geeks.ec` |
| Backend | `api.backio.geeks.ec` |

El portal cliente vive en `backio.geeks.ec/p/<token>`. Al cambiar dominios, actualizar
`FRONTEND_URL`, `NEXT_PUBLIC_BACKEND_URL`, `BASECAMP_REDIRECT_URI` y la Site URL de Supabase.

---

## Orden recomendado

1. Railway primero (para tener la URL del backend).
2. Vercel con esa URL.
3. Volver a Railway a poner `FRONTEND_URL`.
4. Supabase Auth con la URL de Vercel.
5. Probar login y `/health`.
