# Endurecimiento de BackIO · auditoría del 10/10/2026

Fuente: `~/claude-projects/auditorias/2026-10-10/` (`backIO.md`, `backIO-checklist20.md`, `backIO-basura-calidad.md`,
`backIO-SUPERHERO-PROMPT.md`), auditada sobre el commit `f2e30e2`. Se trabaja por olas en `main`; cada ola se
despliega con typecheck y tests en verde. Las migraciones van a revisión de Luis antes de aplicarse.

Estados: **hecho** (en producción y verificado) · **parcial** · **pendiente-humano** (depende de un panel externo o de
una acción de Luis) · **pendiente** (ola futura).

## Ola 0 · Urgentes

| Hallazgo | Estado | Archivos | Verificación |
|---|---|---|---|
| B1 · CORS sin `PUT` (plantillas, tipos de pieza, definiciones y mediciones de KPI no guardaban) | hecho | `backend/src/app.ts` | Test de preflight (falla con el código anterior); preflight `OPTIONS` contra Railway después del deploy |
| B2 · El scheduler podía tumbar el proceso | hecho | `backend/src/lib/scheduler.ts`, `backend/src/index.ts` | Cada job captura su error; el tick por minuto tiene `.catch`; handlers globales de `unhandledRejection` y `uncaughtException`. Typecheck |
| S13 · El portal devolvía el mensaje de error interno | hecho | `backend/src/routes/portal.ts` | Test: el resumen responde 503 con mensaje fijo y sin el texto interno |
| S14 · Los 5xx de base devolvían el texto de Postgres | hecho | `backend/src/app.ts` | En producción, `Error interno` si `status >= 500`; el detalle queda en el log |
| S15 · Tres enlaces «Ver en Basecamp» sin `hrefExterno` | hecho | `DailyPublicar.tsx`, `informes/page.tsx`, `WeeklyActions.tsx` | Typecheck del frontend |
| B11 · La alerta de escritura masiva de API keys nunca se enviaba | hecho | `backend/src/lib/db/audit.ts` | Usa `notificar()` a admin y operaciones (antes: insert perezoso sin `await` y sin destinatario) |
| B13 · La paginación de horas ignoraba errores | hecho | `backend/src/lib/horas.ts` | `throwIf(error)` en cada página |
| [PENDIENTE-HUMANO] Revisar en el navegador que guardar una plantilla y una medición de KPI funciona | pendiente-humano | — | — |
