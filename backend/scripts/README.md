# Scripts operativos

Se corren en local con `npx tsx scripts/<nombre>.ts` desde `backend/` y **hablan con producción** (usan el `.env`
del backend: service role de Supabase y token de Basecamp del tenant). No hay ambiente de pruebas: lo que un script
escribe, queda escrito.

Reglas:

- Antes de correr uno que escriba, leerlo completo. Los que aceptan `--ver` hacen solo lectura primero.
- Para hablar con Basecamp hace falta `BASECAMP_ACCOUNT_ID=4186385` en el entorno del comando.
- Nunca escribir en Basecamp con un `PUT` crudo: un `PUT` parcial borra los asignados del to-do (incidente del 22/09,
  `docs/04-basecamp.md`). Usar `BasecampClient.updateTodo`, que reenvía responsables y descripción.
- Los scripts de un solo uso se borran cuando ya se ejecutaron: el registro queda en git. El 10/10/2026 se borraron
  13 (altas, bajas y renombres de AB-Inbev, presets, diagnósticos de incidentes cerrados y `verificar_put.ts`).

| Script | Escribe | Para qué |
|---|---|---|
| `diag_asignados.ts`, `diag_informe_canal.ts`, `sin_owner_mapeable.ts`, `audit_resumen.ts` | No | Diagnóstico |

Las reparaciones (responsables perdidos en Basecamp, duplicados, huérfanos adoptados sin enlace) se hacen desde
**Admin → Mantenimiento**, con revisión previa y auditoría. Los scripts que las hacían se borraron el 11/10/2026.
