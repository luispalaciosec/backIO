# 19 · KPIs por persona y por equipo (25/09/2026)

Reemplaza la hoja `Plantilla_KPIs.xlsx`. 17 indicadores de 5 áreas (Ejecutiva de Cuentas, Producción,
Arte y Diseño, Creatividad, Content). Cada KPI se mide **a cada persona del área y al equipo**.

## Dónde vive

| Pantalla | Quién | Qué |
|---|---|---|
| Equipo → KPIs (`/kpis`) | Roles de gestión | Vista por equipo (valor del equipo + matriz de integrantes, tendencia de 6 meses) y por persona. Clic en una celda: tareas que componen el cálculo y formulario de seguimiento |
| Personas → modal → pestaña KPIs | Roles de gestión | Ficha de la persona en el mes en curso |
| Admin → Catálogo → KPIs | Admin | Meta, operador, periodicidad, cálculo, textos, activo |
| Admin → Usuarios → Área | Admin | Área de cada persona: define qué KPIs le aplican. Admin, gerencia y operaciones no se miden (Marcia, 26/09) |

| Menú → Mis KPIs (`/kpis`, `GET /kpis/mios`) | Colaboradores | Solo su propia ficha y el agregado de su equipo, nunca a sus compañeros |

Registrar mediciones (manuales, ajustes, causa, plan de mejora): **admin, gerencia y operaciones**.

**Ficha lúdica (26/09).** Debajo de la ficha de cada persona, «¿Cómo se calcula cada KPI?» explica cada
indicador con sus propios números: la regla en lenguaje simple, un cuadrito por tarea (verde suma, rojo
resta), la cuenta A de B = %, una barra con la meta marcada, cuánto le falta (o cuánto margen le queda) y un
consejo concreto para mejorarlo (`frontend/components/kpis/ComoSeCalcula.tsx`).

## Cómo se mide

- **Persona**: tareas donde está en `owner_agencia`; en Cuentas también las de proyectos donde es `owner_ejecutiva`.
- **Equipo**: Σ A / Σ B sobre las tareas únicas de sus integrantes (una tarea compartida cuenta una vez).
  Si hay personas ajustadas a mano o el KPI es manual, el equipo agrega Σ A / Σ B de las personas.
- **Proactividad**: meta por persona (3 y 10 al mes); el equipo usa meta × integrantes.
- **Resultado y cumplimiento** no se guardan: se derivan de A, B, meta y operador.
- **Mes en curso** se calcula en vivo. El **día 1 a las 08:10** el mes anterior se congela como `auto`
  (y el trimestre si cerró); lo manual o ajustado nunca se pisa.
- Periodos en hora Guayaquil. Trimestrales (`2026-T3`) se muestran en cualquier mes del trimestre.

## Cálculos automáticos (`backend/src/lib/kpis.ts`)

| Cálculo | KPIs | A | B |
|---|---|---|---|
| `a_tiempo` | PRO-01, DIS-01, CRE-03, CON-01 | completadas ≤ fecha original, o ≤ vigente si todas sus reprogramaciones fueron del cliente/neutras | completadas en el mes |
| `retrabajo` | PRO-02, DIS-03, CRE-02, CON-04 | completadas con reproceso `atribuible = equipo` del área | completadas |
| `levantamiento` | CUE-01 | completadas sin reproceso por brief o levantamiento incompleto | completadas |
| `aprobacion_primera` | DIS-02 | aprobadas en ronda 1 (`aprobacion_eventos`); sin rondas: proxy «sin reproceso del cliente» marcado *estimado* | aprobadas en el mes |
| `propuestas_aprobadas` | CRE-01 | `clase = propuesta` aprobadas | propuestas con decisión |
| `sla_respuesta` | CUE-03 | creadas con «Respondido» dentro del SLA hábil de su prioridad | creadas en el mes |
| `sla_incidencia` | CON-02 | `clase = incidencia` completadas dentro del SLA hábil | incidencias completadas |
| `proactividad` | CRE-04, CON-03 | tareas `proactiva` creadas | meta fija del catálogo |
| `manual` | CUE-02, PRO-03 | se ingresa | se ingresa |

SLA (`lib/horas_habiles.ts`): Alta 30 min, Media 1,5 h, Baja 8 h, en horas hábiles L-V 09:00–18:00 Guayaquil.
Los cálculos que dependen de datos nuevos solo miden meses completos desde el 25/09/2026 (`FEATURES_DESDE`):
septiembre sale «sin dato» y arrancan en octubre.

**Backlog heredado excluido (`OPERACION_DESDE = 2026-09-04`).** Las tareas con fecha original anterior al
inicio de BackIO no cuentan: el 7-8/09 se cerraron en bloque 385 tareas importadas con una mediana de 62 días
de atraso, y medirlas castigaba al equipo por la limpieza (a tiempo de Diseño pasaba de 47% a 19%).

## Datos nuevos que los alimentan (migración 22)

| Dato | Dónde se marca |
|---|---|
| `usuarios.area` | Admin → Usuarios |
| `requerimientos.clase` (tarea · propuesta · incidencia) y `proactiva` | Columna «Clase» y ✦ del backlog, alta rápida, o prefijos `[PROPUESTA]`, `[INCIDENCIA]`, `[PROACTIVA]` en el título del to-do de Basecamp |
| `requerimientos.primera_respuesta_at` | Botón «Respondido» en el historial ↺ (regla 1: nada se lee de comentarios) |
| `reprocesos.atribuible` y `area_responsable` | Formulario de reproceso (prellenados desde el motivo). Motivo nuevo: «Info incompleta o incorrecta del levantamiento» |
| `aprobacion_eventos` | Automático: trigger en cada cambio de `estado_aprobacion` (UI, MCP, portal) |

## API

`GET /kpis?periodo=YYYY-MM` · `GET /kpis/:codigo?periodo&usuario` · `PUT /kpis/:codigo/mediciones`
(ajustar un automático exige `justificacion_ajuste`) · `DELETE /kpis/:codigo/mediciones/:id` ·
`GET/PUT /kpis/definiciones` · `GET /kpis/export?hasta&meses` (CSV con columnas de la plantilla) ·
`POST /requerimientos/:id/respondido`.
