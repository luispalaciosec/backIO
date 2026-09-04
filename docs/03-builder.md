# 03 · Builder de proyectos (multistep)

## Propósito

La ejecutiva de cuenta recibe una solicitud del cliente ("necesitamos una propuesta de
campaña de Navidad") y en menos de 5 minutos debe tener: brief estructurado, árbol de
tareas creado, to-dos en Basecamp y portal cliente listo.

Reemplaza la carga manual tarea por tarea de Monday.

---

## Los cinco pasos

### Paso 1 — Tipo de trabajo

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
| Cotización PrometIO | Select | No (auto si viene de webhook) |
| Archivos de referencia | Upload | No |

El brief se guarda en `proyectos.brief` como JSONB versionado. Cambios posteriores generan
nueva versión, no sobrescriben.

### Paso 3 — Alcance

Se muestra el árbol de bloques. Los marcados `opcional = true` se pueden desmarcar.

Por cada bloque activo se define cantidad de piezas por canal:

```
▼ Producción                                    45% del proyecto
  ☑ Instagram    [ 8 ] piezas
  ☑ Facebook     [ 4 ] piezas
  ☐ TikTok       [ 0 ]
  ☑ Mailing      [ 2 ] piezas
```

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

Esta alerta es informativa, no bloqueante. Pero se registra: si se ignora y luego el bloque
se retrasa, la señal del weekly lo referencia.

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

Al confirmar:
1. Se crea `proyectos`
2. Se crean N `requerimientos` con peso, visibilidad y fechas
3. Se crea el todolist y los to-dos en Basecamp (ver `04-basecamp.md`)
4. Se genera `portal_token` (portal inactivo por defecto)
5. Se notifica a los owners asignados

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
- Import es transaccional: o entran todas o ninguna
- Se puede importar contra proyecto existente o crear uno nuevo

---

## Componentes

```
app/proyectos/nuevo/
  page.tsx                    -- shell del wizard, maneja estado
  _steps/
    Step1Plantilla.tsx
    Step2Brief.tsx
    Step3Alcance.tsx
    Step4EquipoFechas.tsx
    Step5Revision.tsx         -- usa sanitizeForClient para el preview
  _components/
    ArbolTareas.tsx
    AlertaCapacidad.tsx
    PreviewPortal.tsx

app/proyectos/importar/
  page.tsx
  _components/PreviewImport.tsx
```

**Estado del wizard:** React state en memoria + autosave a `localStorage` únicamente como
borrador de UI. Nada de negocio se persiste hasta el paso 5.

---

## Regla de UI

El preview del paso 5 debe usar **la misma función** `sanitizeForClient` que el portal real.
No una versión "para preview". Si divergen, el preview miente.
