# 09 · Plan de fases

## Estimación total: 37 días hábiles (~7-8 semanas)

Nota de calibración: el CRM (PrometIO) se construyó en semana y media. BackIO no es
comparable — tiene integración con un sistema de producción vivo, una frontera de
visibilidad cliente con consecuencias comerciales, y una capa MCP con scopes. Planificar
con 7-8 semanas y ajustar si el ritmo lo permite.

---

| Fase | Alcance | Días | Depende de |
|---|---|---|---|
| **0** | Esquema Supabase, RLS, `cliente_id` unificado, migración de clientes | 3 | Decisión: product owner |
| **1** | Builder 5 pasos, tabla, Kanban, notificaciones | 5 | Fase 0 |
| **2** | Integración Basecamp: crear to-dos + webhook + polling | 5 | Fase 1 |
| **2.5** | Motor de señales, Plan Operativo, Acta de Cierre, vista Daily | 4 | Decisión: ¿GG en backlog? |
| **2.7** | API REST + MCP Server + scopes + adaptador OpenAPI | 4 | Fase 2 |
| **3** | Portal cliente + resumen ejecutivo IA | 5 | Fase 2, tests de visibilidad |
| **3.5** | Webhooks bidireccionales con PrometIO | 2 | Fase 2.7 |
| **4** | Dashboards, vista weekly con arrastre, métricas de piezas | 4 | Fase 2.5 |
| **5** | Migración de cuentas activas, coexistencia, baja de Monday | 5 | Todas |

---

## Definition of Done por fase

### Fase 0
- [ ] Migraciones versionadas aplicadas
- [ ] RLS verificada: usuario de tenant B no lee datos de tenant A (0 filas)
- [ ] Clientes migrados con **IDs idénticos** a PrometIO, verificado por conteo
- [ ] `basecamp_project_id` poblado para clientes activos
- [ ] Trigger de visibilidad monotónica aplicado y probado

### Fase 1
- [ ] Builder completo, paso 5 usando `sanitizeForClient` real
- [ ] Bulk import CSV con preview y validación de `etiqueta_cliente`
- [ ] Notificaciones funcionando (canal decidido por Marcia)
- [ ] Alerta de concentración de carga en paso 4

### Fase 2
- [ ] OAuth Basecamp funcionando con refresh automático
- [ ] Creación probada primero en proyecto sandbox de Basecamp
- [ ] Webhook recibiendo y aplicando `completed`
- [ ] Polling de reconciliación cada 30 min
- [ ] **Test de fuga de texto pasando** (ver `02-visibilidad.md`)
- [x] Límite de 50 to-dos por operación implementado

### Fase 2.5
- [ ] Las 8 reglas de señales implementadas y parametrizables
- [ ] Plan Operativo genera markdown en el formato actual de Geeks
- [ ] Acta de Cierre genera markdown en el formato actual de Geeks
- [ ] Constraint de fecha real en `acuerdos` (sin "Próxima Weekly")
- [ ] Vista `/daily` en una pantalla sin scroll

### Fase 2.7
- [ ] MCP server desplegado con OAuth
- [ ] Tools de escritura con patrón preview + confirm, `plan_id` expira en 15 min
- [ ] Scopes verificados: key de lectura no puede escribir
- [ ] Spec OpenAPI autogenerada para Gemini
- [ ] `audit_log` registrando todas las escrituras

### Fase 3
- [ ] **Checklist completo de `02-visibilidad.md` firmado**
- [ ] Test de integración: endpoint público no devuelve campos internos
- [ ] Portal responsive verificado en móvil
- [ ] Resumen IA cacheado 6 horas
- [ ] `noindex` y `robots.txt` configurados

### Fase 5
- [ ] Las cuentas activas migradas y verificadas
- [ ] 4 semanas de coexistencia con Monday completadas sin incidentes
- [ ] Card Table de Basecamp archivado
- [ ] Suscripción de Monday dada de baja

---

## Riesgos del proyecto

| Riesgo | Impacto | Mitigación |
|---|---|---|
| **Fuga de contenido interno al cliente** | Pérdida de cuenta. Excede varios años del ahorro | Tres defensas en `02-visibilidad.md` + revisión humana obligatoria |
| **Escritura masiva errónea en Basecamp** | Ensucia producción real | Sandbox primero, límite de 60, idempotencia, rollback |
| **Falta de adopción** | BackIO muere como murieron los intentos anteriores de WorkOS | Product owner designado + notificaciones desde Fase 1 + el GG modela cumplimiento |
| **Baja de Monday prematura** | Operación sin herramienta | No dar de baja hasta completar Fase 5 con 4 semanas de coexistencia |
| **Alcance creciente hacia SaaS** | Meses de trabajo sin retorno en el año de extracción | `tenant_id` sí, billing/onboarding/soporte **no** en 2026 |

---

## Decisiones que bloquean fases

Todas tomadas el 03/09/2026:

| Decisión | Resultado |
|---|---|
| Product owner de BackIO en Geeks | **Marcia** (jefe de operaciones). Luis solo como último recurso |
| ¿CoreIO antes de Fase 0? | **No.** Modelo actual: tablas propias + `cliente_id` compartido + webhook de PrometIO. Revisar cuando BackIO esté en uso |
| ¿Gantt y Calendario entran al alcance? | **Fase 2**, no Fase 1 |
| ¿El GG aparece en el backlog operativo? | **Opción A: no.** El weekly es de Marcia; Luis no participa. Sus compromisos no entran al backlog operativo |
| Canal de notificación | **Correo** |
| Límite de to-dos por operación en Basecamp | **50** |

---

## Lo que NO entra en 2026

| Descartado | Cuándo revisarlo |
|---|---|
| Billing, planes, self-signup | 2027, si un piloto externo lo justifica |
| Onboarding autoservicio | 2027 |
| Marketing site y docs públicas | 2027 |
| Aprobación de entregables con firma | v2, después de 6 meses de uso |
| Comentarios del cliente en el portal | Probablemente nunca |
| Sincronización de comentarios de Basecamp | Nunca. Rompe la arquitectura |
