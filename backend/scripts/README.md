# Scripts operativos

Se corren en local con `npx tsx scripts/<nombre>.ts` y **hablan con producción** (usan el `.env` del
backend: service role de Supabase y token de Basecamp del tenant). No hay ambiente de pruebas: lo que
un script escribe, queda escrito.

Reglas:

- Antes de correr uno que escriba, leerlo completo. Los que aceptan `--ver` hacen solo lectura primero.
- Para hablar con Basecamp hace falta `BASECAMP_ACCOUNT_ID=4186385` en el entorno del comando.
- Los scripts de un solo uso (altas/bajas de clientes, renombres, limpiezas) ya se ejecutaron; se conservan
  como registro. No volver a correrlos sin revisar los ids que llevan dentro.
- Los experimentos con `PUT` crudo a Basecamp se eliminaron el 23/09/2026: un `PUT` parcial borra los
  asignados del to-do (incidente del 22/09, `docs/04-basecamp.md`).

| Script | Escribe | Para qué |
|---|---|---|
| `diag_fechas.ts`, `diag_fechas_bc.ts`, `diag_asignados.ts`, `diag_informe_canal.ts`, `verificar_todo.ts`, `verificar_put.ts`, `sin_owner_mapeable.ts`, `audit_resumen.ts`, `bc_projects.ts`, `ver_clientes_cn.ts`, `duplicados_detectar.ts` | No | Diagnóstico |
| `reparar_asignados.ts` (`--ver` para simular) | Basecamp | Reenvía asignados perdidos |
| `restaurar_y_reconciliar.ts` | Basecamp + DB | Restaura asignados de un to-do y corre la reconciliación |
| `duplicados_limpiar.ts` | DB | Borra requerimientos duplicados detectados |
| `cancelar_tareas_baja.ts`, `baja_clientes.ts`, `crear_clientes_abinbev.ts`, `reasignar_ramas_abinbev.ts`, `renombrar_abinbev.ts`, `presets_informe_canal.ts` | DB | Un solo uso, ya ejecutados |

Deuda registrada en `docs/17-arquitectura-tecnica.md` §8: convertir las reparaciones recurrentes en
endpoints de admin con auditoría.
