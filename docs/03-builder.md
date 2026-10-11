# 03 · Builder de proyectos (multistep)

> Revisado contra el código el 11/10/2026.

## Propósito

La ejecutiva de cuenta recibe una solicitud del cliente ("necesitamos una propuesta de
campaña de Navidad") y en menos de 5 minutos debe tener: brief estructurado, árbol de
tareas creado, to-dos en Basecamp y portal cliente listo.

Reemplaza la carga manual tarea por tarea de Monday.

El wizard empieza mostrando las cotizaciones aprobadas en PrometIO que esperan convertirse en proyecto
(`GET /proyectos/borradores`, componente `Borradores.tsx`). Elegir una prellena plantilla, brief y cantidades;
también se puede descartar. Ver [08 · PrometIO](./08-prometio.md).

---

## Los cinco pasos

### Paso 1 — Tipo de trabajo

**Catálogo consolidado (04/09/2026).** El paso 1 muestra las 25 familias vendibles del
`Catalogo_Pilares_v3` agrupadas por pilar, más "Lanzamiento de producto" y "Pieza suelta":

| Pilar | Familias |
|---|---|
| Marca | Kit de Identidad de Marca · Gestión de Redes Sociales (recurrente) · Reportería y Escucha Activa RRSS (recurrente) · Piezas de Imagen Corporativa · Diseño de Piezas ATL / Prensa · Empaque y Etiquetas |
| Crecimiento | Desarrollo Web · Desarrollo de Apps · CRM y Marketing Directo · Dashboards Básicos · Meta CAPI / Eventos de Conversión · SEO / SEM (recurrente) · Automatización de Performance |
| Transformación | Chatbots y Agentes de IA · Automatización de Procesos / RPA · Minería de Procesos · Analítica Predictiva · IA Generativa a Medida · Arquitectura de Datos · Dashboards con Analítica Automatizada · Proyectos Especiales de Innovación |
| Transversal | Producción Audiovisual · Creatividad de Campañas · BTL / Activaciones · Kit de Activación POP |

Medios (Audela) no tiene plantilla: no se produce por pieza. Las 37 líneas del tarifario 2024 y
los nombres de servicio de PrometIO están mapeados a su familia en `mapeo_servicios`, así que una
cotización aprobada sugiere la plantilla correcta. Cada familia lleva pilar, unidad (proyecto, mes,
pieza) y precio de referencia. Las plantillas se editan en Admin → Plantillas, pueden ser generales o
de un cliente, y cualquier proyecto se puede "guardar como plantilla". Seed: `backend/supabase/seed_catalogo.sql`.


Selección de plantilla. Cards visuales, no dropdown.

| Plantilla | Cuándo | Bloques |
|---|---|---|
| Campaña 360 | Campaña con múltiples canales | Investigación, Creativo, Aprobación, Producción, Entrega |
| Lanzamiento de producto | Producto o servicio nuevo | Research, Estrategia, Creativo, Producción, Medición |
| Fee mensual | Contenido recurrente | Planificación, Producción, Publicación, Reporte |
| Pieza suelta | Requerimiento aislado | Brief, Producción, Entrega |
| Trade / Retail | Material POP, cadenas | Brief, Diseño, Artes finales, Entrega |

Al seleccionar, se carga el árbol completo de bloques y tareas con sus pesos y visibilidad.

### Paso 2 — Brief estructurado

Formulario, no texto libre. El texto libre no es consultable ni comparable.

| Campo | Tipo | Obligatorio |
|---|---|---|
| Cliente | Select (desde `clientes`) | Sí |
| Nombre del proyecto | Texto | Sí |
| Objetivo de negocio | Textarea | Sí |
| Público objetivo | Textarea | Sí |
| Canales | Multi-select | Sí |
| Mandatorios de marca | Textarea | No |
| Fecha de entrega final | Date | Sí |
| Presupuesto aprobado | Moneda | No |
| Cotización PrometIO | Texto (id de la cotización) | No (auto si viene de webhook) |

El paso 2 no tiene carga de archivos. Arriba del formulario hay un cuadro donde se puede pegar el correo o las
notas del cliente: la IA llena el brief, sugiere plantilla y cuenta las piezas, y nada se guarda hasta crear el
proyecto. Ver [15 · IA](./15-ia.md).

El brief se guarda en `proyectos.brief` como JSONB con la forma `{ actual: { …, version: 1 }, historial: [] }`
(`backend/src/lib/builder/service.ts`). La estructura está pensada para versionar, pero hoy no hay forma de
editar el brief después de crear el proyecto: `PATCH /proyectos/:id` no acepta el campo `brief`. En la práctica
cada proyecto tiene solo la versión 1.

### Paso 3 — Alcance

Se muestra el árbol de bloques. Los marcados `opcional = true` se pueden desmarcar.

En cada bloque activo se indica cuántas piezas de cada **tipo de pieza** lleva (ver la sección siguiente).
Eso es lo que genera los to-dos de piezas y reparte el peso del bloque. Si el brief tiene canales, el bloque
también muestra un campo de cantidad por canal; esas cantidades solo quedan como número de piezas en las tareas
del bloque cuando no se usó ningún tipo de pieza (`backend/src/lib/builder/plan.ts`).

Al desmarcar un bloque, su peso se **redistribuye proporcionalmente** entre los restantes.
El total siempre suma 100.

### Tipos de pieza (sprint 2, 04/09/2026)

Dentro de un fee conviven piezas con flujos distintos. Tres tipos, editables en Admin → Tipos de pieza:

| Tipo | Esfuerzo | Flujo |
|---|---|---|
| Post estático | 1 | Copy → Diseño → Revisión DA → Aprobación cliente → Posteo |
| Carrusel | 1,5 | Copy → Diseño → Revisión DA → Aprobación cliente → Posteo |
| Reel | 4 | Ideas → Guiones → Aprobación de guiones → Storyboards → Grabación → Edición → Aprobación cliente → Posteo |

En el paso 3 se indican cantidades por tipo en cada bloque. BackIO genera **un to-do por paso por
lote** ("Guiones · Reel (4)"), o uno por pieza si se marca "una tarea por pieza". El peso del bloque
se reparte por esfuerzo × cantidad: 4 reels pesan como 16 posts. Los pasos de aprobación son visibles
al cliente y disparan `esperando_cliente` en el portal; los pasos internos no. Las líneas de una
cotización de PrometIO prellenan las cantidades por nombre de servicio.

### Paso 4 — Equipo y fechas

Asignación de owner por bloque (no por tarea — demasiado granular para este momento).

Las fechas se calculan **hacia atrás** desde `fecha_entrega` usando `dias_offset` de cada
plantilla_tarea.

**Alerta de capacidad en vivo:** si un responsable queda con más del 30% de las tareas de
alguna semana, se muestra advertencia inline.

> ⚠️ Elías queda con 9 de 21 tareas en la semana del 10/08 (43%).
> Considera redistribuir o mover fechas.

Esta alerta es informativa, no bloqueante. Al crear el proyecto queda guardada en la auditoría
(`crear_proyecto`, campo `detalle.alertas`). No está conectada con las señales del weekly.

### Paso 5 — Revisión (NO OPCIONAL)

Pantalla dividida:

```
┌─────────────────────────┬─────────────────────────┐
│  VISTA INTERNA          │  VISTA CLIENTE          │
│  (lo que ve el equipo)  │  (preview del portal)   │
├─────────────────────────┼─────────────────────────┤
│  ▸ Kickoff interno      │  Investigación          │
│  ▸ Research y benchmark │  Propuesta creativa     │
│  ▸ Ruta creativa v1     │  Ajustes solicitados    │
│  ▸ Revisión de DA       │  Producción             │
│  ▸ Ruta creativa v2     │  Entrega                │
│  ▸ Presentación         │                         │
│  ▸ Ajustes post-feedback│  Avance: 0%             │
│  ▸ Producción de piezas │  Entrega: 15/12/2026    │
│  ▸ Control de calidad   │                         │
│  ▸ Entrega final        │                         │
│                         │                         │
│  10 tareas · 5 visibles │                         │
└─────────────────────────┴─────────────────────────┘

      [ Volver ]              [ Crear proyecto ]
```

**La ejecutiva ve exactamente la pantalla del cliente antes de que exista.** Si algo no
debe estar ahí, se corrige antes, no después.

El preview se pide al backend con `POST /proyectos/preview`. El backend arma el mismo plan que se va a
ejecutar y le aplica `sanitizeForClient`; el frontend muestra la vista cliente con
`frontend/components/VistaCliente.tsx`, el mismo componente que usa el portal.

Al confirmar (`crearProyectoDesdePlantilla` en `backend/src/lib/builder/service.ts`):
1. Se crean el proyecto y sus requerimientos en una sola transacción, con la función `crear_lote` de la base
   (migración `20261011000029_transacciones.sql`). Si falla una tarea, no queda un proyecto a medias. El
   proyecto ya lleva su `portal_token`; el portal queda inactivo por defecto.
2. Si el proyecto vino de una cotización de PrometIO, el borrador se marca como convertido.
3. Se avisa por notificación y correo a los responsables asignados.
4. Si el cliente tiene proyecto en Basecamp, se crean la lista, los grupos y los to-dos (ver
   [04 · Basecamp](./04-basecamp.md)). Si eso falla, el proyecto queda con `sync_estado = 'incompleto'`.

Un proyecto con la estructura incompleta se puede reintentar desde su ficha, que llama a
`POST /proyectos/:id/basecamp/reintentar`. Los to-dos que ya existen no se recrean.

Desde la misma ficha, **«Guardar como plantilla»** crea una plantilla a partir del proyecto
(`POST /plantillas/desde-proyecto/:proyectoId`). Toma los bloques con su peso y las tareas con su desfase respecto
de la entrega; deja fuera las canceladas y las piezas, que salen de los tipos de pieza
(`backend/src/lib/builder/desde_proyecto.ts`). La plantilla puede ser general o solo de ese cliente.

---

## Carga masiva (bulk import)

Además del builder, se necesita carga masiva para migración y para cuentas de alto volumen
tipo Trade (185 tareas, 4,069 piezas en 7 meses).

**Formato CSV:**

```csv
cliente_slug,proyecto,titulo_interno,etiqueta_cliente,visible,bloque,peso,tipo,prioridad,fecha_pedido,fecha_entrega,owner_email,piezas
cerveceria,Trade Q4,POP PROMO CADENAS,Material POP,true,Producción,3,fee,alta,2026-08-20,2026-08-31,elias@geeks.ec,29
```

Reglas del importador:
- `visible = true` requiere `etiqueta_cliente` no vacía → si falta, la fila se rechaza
- Preview obligatorio antes de confirmar: muestra filas válidas, rechazadas y el motivo
- Import es transaccional: o entran todas o ninguna. Usa la misma función `crear_lote` que el Builder
  (`POST /requerimientos/bulk`, con `POST /requerimientos/bulk/preview` para el preview)
- Se puede importar contra proyecto existente o crear uno nuevo

---

## Componentes

El wizard vive en `frontend/app/(app)/proyectos/nuevo/`:

| Archivo | Qué hace |
|---|---|
| `page.tsx` | Shell del wizard |
| `wizard.ts` | Estado del wizard y su autoguardado |
| `_steps/Step1Plantilla.tsx` … `_steps/Step5Revision.tsx` | Un archivo por paso |
| `_components/Borradores.tsx` | Cotizaciones de PrometIO pendientes de convertir |

La carga masiva está en `frontend/app/(app)/proyectos/importar/page.tsx`. La vista cliente del paso 5 es
`frontend/components/VistaCliente.tsx`.

**Estado del wizard:** React state en memoria + autoguardado en `sessionStorage` únicamente como borrador de UI.
Se pierde al cerrar la pestaña. Nada de negocio se persiste hasta el paso 5.

---

## Regla de UI

El preview del paso 5 debe usar **la misma función** `sanitizeForClient` que el portal real.
No una versión "para preview". Si divergen, el preview miente. Hoy se cumple: el backend aplica la función de
`shared/src/visibility/sanitize.ts` en `POST /proyectos/preview`.


## Recurrencia mensual (D2, decidido 04/09/2026)

Un fee se crea una sola vez en el Builder marcando **«Repetir cada mes»** en el paso 5 (aparece si la plantilla
es recurrente o de tipo `fee_mensual`), o desde un proyecto existente con **«↻ Repetir cada mes»**. Eso guarda una
`recurrencia` con la configuración completa (plantilla, brief, bloques, piezas por tipo, responsables, ejecutiva).

Cada día a las 08:05 (Guayaquil) el scheduler revisa las recurrencias activas: si el día del mes ≥ `dia_generacion`
(por defecto **25**) y el mes siguiente aún no existe, genera el proyecto por el mismo camino que el Builder
(plan → requerimientos → estructura en Basecamp → correo a los responsables), lo marca con `periodo = YYYY-MM`
y avisa a la ejecutiva y a operaciones. El nombre sale del `nombre_patron` propio de la recurrencia (`{mes}`,
`{año}`), que al crearla se copia del `patron_nombre` de la plantilla o, si no tiene, queda como
«nombre de la plantilla - {mes} {año}» (`backend/src/lib/recurrencias.ts`). Inicio
el día 1 y entrega el último día del mes. Idempotente por periodo. Admin → Recurrencias permite pausar, cambiar día,
patrón y ejecutiva, y **generar ahora**.

## Proyectos armados desde Basecamp (23/09/2026)

El Builder sigue existiendo para proyectos que nacen de una cotización de PrometIO o de una plantilla. Pero la
mayoría de los proyectos de fee nacen como listas en Basecamp: desde el 23/09 esas listas se convierten solas en
proyectos cada 15 min, y en unos 20 segundos cuando el webhook avisa de un to-do nuevo (ver
[04 · Basecamp](./04-basecamp.md), «Basecamp como origen aceptado»), con `brief.origen =
'importacion_basecamp'`, fechas tomadas de los to-dos y estado según su avance. La ejecutiva no crea: clasifica.
