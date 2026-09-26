# BackIO

**Sistema operativo de backlog de Geeks Ecuador.** Reemplaza Monday.com como tablero de
requerimientos y vista de cuenta del cliente, apoyándose en Basecamp como sistema de ejecución.

En producción desde el 04/09/2026 · `backio.vercel.app` · 15 clientes sincronizados con Basecamp.

---

## Qué hace

| Para | Qué resuelve |
|---|---|
| **Ejecutivas de cuenta** | Backlog por cliente estilo Monday (filtros en la URL, columnas fijas, edición en línea), bitácora con el cliente, hoja de estatus imprimible, reprogramaciones con motivo, reprocesos |
| **Mesas de operación** | Daily por mesa (elegir tareas, tablero, apertura y cierre publicados en Basecamp con menciones y métricas), Weekly con motor de señales, Plan Operativo y Acta de Cierre |
| **Gerencia** | Dashboard, cumplimiento a fecha original vs vigente, personas (performance con evidencia del timesheet), informes mensuales y por canal |
| **Clientes** | Portal por token con lo que la agencia decidió mostrar. Nada interno puede llegar ahí por diseño |
| **Agentes de IA** | API REST con scopes y MCP Server con preview + confirmación para toda escritura |

Basecamp sigue siendo donde el equipo trabaja. BackIO lee de ahí solo lo estructural (títulos,
fechas, responsables, completado, horas) y escribe de vuelta fechas, to-dos nuevos y mensajes.

---

## Las cinco reglas que nunca se rompen

1. **El texto de Basecamp jamás entra a BackIO.** Descripciones, comentarios y adjuntos se quedan
   allá. Solo entran títulos (excepción D1), fechas, responsables, completado y horas. Es la
   garantía estructural de que un comentario interno no llegue al cliente.
2. **La visibilidad al cliente se hereda, nunca se abre.** Un trigger de base de datos impide
   pasar de oculto a visible.
3. **Los estados no se sincronizan en dos direcciones.** Basecamp manda sobre `completed`;
   BackIO sobre todo lo demás.
4. **Toda escritura desde un agente requiere preview + confirmación.**
5. **`tenant_id` y RLS en toda tabla**, aunque hoy solo exista un tenant.

Detalle y defensas en `docs/02-visibilidad.md`. Zonas que no se cambian sin revisión humana:
`lib/visibility/`, `lib/basecamp/write.ts`, tools MCP de escritura y políticas RLS (`CLAUDE.md`).

---

## Stack

| Capa | Tecnología |
|---|---|
| Base de datos y auth | Supabase (Postgres + RLS + Auth) |
| Backend | Hono sobre Node 20, TypeScript estricto, zod · Railway |
| Frontend | Next.js 14 (App Router) + Tailwind · Vercel |
| Ejecución | Basecamp 3 API (OAuth2, webhooks, polling) |
| CRM | PrometIO (webhook, `cliente_id` compartido) |
| IA | Claude (Anthropic API): redacta dailies, weeklies, briefs e informes; una persona publica |
| Agentes | MCP Server + API REST con OpenAPI |

---

## Correr en local

```bash
pnpm install
cp backend/.env.example backend/.env      # Supabase, Basecamp, Anthropic, Resend
cp frontend/.env.example frontend/.env.local
pnpm dev                                   # backend :4000 · frontend :3000
pnpm test && pnpm typecheck
```

Variables, usuarios de prueba y verificación de RLS: `docs/11-setup.md`. Despliegue:
`docs/12-despliegue.md`.

---

## Estructura

```
shared/     tipos compartidos y sanitizeForClient (única salida al cliente)
backend/    src/app.ts (routers) · src/routes/v1 · src/lib (dominio, db, basecamp, ia, mcp)
            supabase/migrations (SQL versionado, 01–20) · scripts (operación)
frontend/   app/(app) área interna · app/p portal · components · lib
docs/       specs, arquitectura técnica, manual de uso (HTML + PDF)
```

Cómo está armado por dentro, ciclo de una petición, crons, integraciones y deuda técnica:
**`docs/17-arquitectura-tecnica.md`**.

---

## Documentación

| Doc | Contenido |
|---|---|
| `CLAUDE.md` | Reglas, convenciones, zonas de revisión humana |
| `docs/00-arquitectura.md` | Modelo mental y alcance de la suite (PrometIO, DatIO, BackIO) |
| `docs/01-modelo-datos.md` | Esquema, RLS, índices |
| `docs/02-visibilidad.md` | Frontera cliente/interno. **El documento más importante** |
| `docs/03-builder.md` | Creación de proyectos (Builder, importación, desde Basecamp) |
| `docs/04-basecamp.md` | Integración: qué entra, qué sale, incidentes y lecciones |
| `docs/05-rituales.md` | Daily, Weekly, motor de señales, formato de mensajes |
| `docs/06-portal-cliente.md` | Portal público y resumen ejecutivo |
| `docs/07-api-mcp.md` · `docs/13-mcp.md` | API REST, scopes, MCP Server |
| `docs/08-prometio.md` | Interconexión con el CRM |
| `docs/09-fases.md` · `docs/14-plan-v2.md` | Plan de ejecución y v2 |
| `docs/11-setup.md` · `docs/12-despliegue.md` | Entorno local, Railway, Vercel, Supabase |
| `docs/15-ia.md` | Capa de IA: qué redacta, con qué datos, quién publica |
| `docs/16-cumplimiento.md` | Reprogramaciones, reprocesos, bitácora, estatus por cliente |
| `docs/17-arquitectura-tecnica.md` | Arquitectura a nivel de código, operación, deuda técnica |
| `docs/18-seguridad.md` | Revisión de seguridad: hallazgos, correcciones y pendientes |
| `docs/19-kpis.md` | KPIs por persona y por equipo |
| `docs/manual/` | Manual de uso para el equipo (HTML y PDF con pantallas) |

---

## Estado y deuda técnica

Fases 0 a 4 y sprints v2 1 a 4 en producción. Pendiente de plataforma: CI en GitHub Actions,
ambiente de staging, alertas de crons, tests de integración con Basecamp y despliegue automático
del frontend. Lista completa y priorizada en `docs/17-arquitectura-tecnica.md` §8.

## Decisiones vigentes

| Decisión | Resultado |
|---|---|
| Product owner | Marcia (jefa de operaciones) |
| Basecamp como origen de trabajo | **Aceptado (23/09/2026).** Lo creado allá entra solo cada 30 min; la ejecutiva clasifica en «Entradas desde Basecamp» |
| Colaboradores | Editan solo sus tareas (estado, fecha con motivo, entregables, piezas, daily) |
| Daily | Es de una mesa; ninguna tarea entra sin responsable |
| Canal de notificación | Correo |
| Todo SQL | Archivo numerado en `backend/supabase/migrations/`, lo aplica Luis |

---

## Riesgo #1

**Fuga de contenido interno al cliente.** Un comentario de dirección de arte visible en el portal
es la pérdida de una cuenta. Mitigación: las tres defensas de `docs/02-visibilidad.md`, tests que
las protegen (`sanitize.test.ts`, `sync.test.ts`, `portal.test.ts`) y revisión humana obligatoria
en las zonas listadas arriba.
