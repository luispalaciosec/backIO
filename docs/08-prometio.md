# 08 · Interconexión BackIO ↔ PrometIO

> Revisado contra el código el 11/10/2026.

## Contexto

PrometIO es el CRM de Geeks (construido internamente). BackIO es el sistema de backlog y
gestión de cuenta. Son sistemas hermanos que hoy comparten entidades sin saberlo.

**Decisión cerrada: `cliente_id` es el mismo UUID en ambos sistemas.**

Sin esto, en seis meses habría reconciliación manual permanente entre "Cliente Ejemplo" en
PrometIO y "Cliente Ejemplo" en BackIO. Es una hora de trabajo hoy o un dolor indefinido
después.

---

## Fuente de verdad por entidad

| Entidad | Fuente de verdad | El otro sistema |
|---|---|---|
| Cliente / cuenta | **PrometIO** | BackIO consume (read-only) |
| Contacto del cliente | **PrometIO** | BackIO consume para el portal |
| Cotización | **PrometIO** | BackIO referencia por ID |
| Etapa comercial | **PrometIO** | BackIO no toca |
| Proyecto en ejecución | **BackIO** | PrometIO consume para ver entrega |
| Requerimiento / tarea | **BackIO** | PrometIO no toca |
| Avance de entrega | **BackIO** | PrometIO lo muestra en la ficha |

Regla: cada dato tiene un dueño. Ninguno se edita en ambos lados.

---

## Flujo 1 — Cotización ganada dispara proyecto

Este es el flujo que cierra el ciclo comercial-operativo que hoy vive en WhatsApp.

```
PrometIO: cotización aprobada
        ↓
POST https://backiobackend-production.up.railway.app/api/v1/webhooks/prometio
{
  "evento": "cotizacion.aprobada",
  "timestamp": "2026-10-11T15:04:05Z",
  "data": {
    "cotizacion_id": "uuid",
    "numero": "COT-0123",
    "oportunidad_id": "uuid",
    "empresa": { "id": "uuid", "nombre": "...", "activo": true, "ruc": "...", "logo_url": "..." },
    "valor": 12500.00,
    "valido_hasta": "2026-12-15",
    "lineas": [
      { "servicio": "Campaña 360", "cantidad": 1, "descripcion": "..." },
      { "servicio": "Piezas Instagram", "cantidad": 8 }
    ]
  }
}
        ↓
Si el cliente no existe en BackIO, se crea con el MISMO id de la empresa
        ↓
BackIO guarda un BORRADOR de proyecto (nunca un proyecto)
  - Sugiere plantilla según la primera línea
        ↓
Aviso a las personas con rol ejecutiva y operaciones
        ↓
La ejecutiva abre el borrador en el Builder:
  - con plantilla sugerida, entra al paso 2 (brief) con cliente, nombre, fecha
    y piezas prellenados
  - sin plantilla sugerida, entra al paso 1 para elegirla
Revisa, ajusta, confirma en el paso 5
        ↓
Se crean requerimientos + to-dos en Basecamp
```

En `data.empresa`, `ruc` y `logo_url` son opcionales. En cada línea, `descripcion` también. El
esquema exacto está en `backend/src/routes/webhooks/prometio.ts`. La lógica del Builder está en
`frontend/app/(app)/proyectos/nuevo/page.tsx`.

**El webhook no crea nada ejecutable.** Crea un borrador que requiere confirmación humana.
Misma lógica que el patrón preview + confirm de MCP.

### Mapeo servicio → plantilla

La tabla `mapeo_servicios` relaciona el nombre de un servicio de PrometIO con una plantilla
(`plantilla_id`) o con un tipo de pieza (`tipo_pieza_id`, agregado en la migración de tipos de pieza). Es
configurable, no está en el código.

BackIO busca la primera línea de la cotización en `servicio_prometio` sin distinguir mayúsculas
(`plantillaParaServicio` en `backend/src/lib/db/proyectos.ts`). Si encuentra una plantilla, la deja como
sugerida en el borrador. Si el servicio no está mapeado, el borrador queda sin plantilla y la ejecutiva elige
en el paso 1.

Las cantidades de piezas se prellenan en el Builder: cada línea se compara por nombre con los tipos de pieza y
la cantidad se pone en el bloque de mayor peso de la plantilla.

---

## Flujo 2 — PrometIO muestra estado de entrega

En la ficha de cliente de PrometIO, un widget que consulta BackIO:

```
GET /api/v1/clientes/{cliente_id}/resumen
Authorization: Bearer {prometio_api_key}    ← scope: read:proyectos
```

```json
{
  "cliente_id": "uuid",
  "proyectos_activos": 3,
  "proyectos": [
    { "nombre": "Campaña Navidad", "avance": 62, "entrega": "2026-12-15", "estado": "en_ejecucion" },
    { "nombre": "Fee Octubre", "avance": 88, "entrega": "2026-10-31", "estado": "en_ejecucion" }
  ],
  "requerimientos_atrasados": 2,
  "dias_sin_movimiento": 3,
  "esperando_cliente": 1
}
```

**Valor comercial:** Juan y el equipo comercial dejan de preguntar por Slack cómo va tal
cuenta. Y antes de una reunión de renovación, ven el estado real de entrega.

**Valor de riesgo:** `dias_sin_movimiento` en la ficha comercial es una alerta temprana de
cuenta en riesgo, visible para quien tiene la relación.

---

## Flujo 3 — Sincronización de clientes

PrometIO es la fuente. BackIO recibe altas y cambios:

```
POST /api/v1/webhooks/prometio
{ "evento": "empresa.creada" | "empresa.actualizada",
  "timestamp": "...",
  "data": { "id": "uuid", "nombre": "...", "activo": true, "ruc": "...", "logo_url": "..." } }
```

BackIO hace upsert por `id`. Si llega `logo_url`, solo se guarda cuando el cliente todavía no tiene logo.

Un admin también puede crear clientes a mano en Admin → Clientes (`POST /clientes`). Sirve para casos que
PrometIO no cubre, como un cliente con un proyecto de Basecamp por rama. Ese cliente recibe un id propio; si
después PrometIO envía la empresa, se enlaza por nombre desde Admin.

**Empresa con varios fees** (migración 36, 28/10/2026). En PrometIO una empresa puede ser una sola, aunque en
BackIO y Basecamp su trabajo se lleve en varios clientes, uno por fee. Es el caso de Cervecería Nacional C.N., dueña
de los 7 fees «AB-Inbev ||…» de la mesa Orión. Cada fee tiene `empresa_id` apuntando a la empresa. Al usar una
cotización ganada de esa empresa en el Builder, el cliente se elige entre sus fees.

**Duplicados.** Si PrometIO tiene la misma empresa dos veces, se unifica allá (PrometIO vuelve a crear o activar el
cliente con el mismo id). En BackIO se desactiva el que sobra (migración 36, 28/10/2026): «Cervecería Nacional»
(queda «Cervecería Nacional C.N.») y «Torres & Torres» (queda «Grupo Torres & Torres»).

Campos que BackIO agrega y PrometIO no conoce:
- `empresa_id` (empresa dueña de un fee)
- `basecamp_project_id`
- `color_primario`, `logo_url` (branding del portal)
- Configuración de PIN del portal

---

## Formato real del emisor (PrometIO `app/core/webhook_saliente.py`)

PrometIO ya tenía un mecanismo de webhooks salientes por organización (`organizacion_webhook`).
BackIO se registra como destino y consume su envelope tal cual:

```
POST https://backiobackend-production.up.railway.app/api/v1/webhooks/prometio
X-Prometio-Signature: sha256=<hmac_sha256_hex(secreto, body)>
X-Prometio-Timestamp: <unix>

{ "evento": "cotizacion.aprobada", "timestamp": "...", "data": { ... } }
```

| Evento | `data` | Efecto en BackIO |
|---|---|---|
| `cotizacion.aprobada` | `cotizacion_id, numero, oportunidad_id, empresa{id,nombre,activo,ruc?,logo_url?}, valor, valido_hasta, lineas[{servicio,cantidad,descripcion?}]` | Crea el cliente si falta, guarda un borrador de proyecto y avisa a ejecutiva y operaciones |
| `empresa.creada` / `empresa.actualizada` | `id, nombre, activo, ruc?, logo_url?` | Upsert de cliente con el mismo id; logo solo si falta |
| Cualquier otro | — | Responde 200 `{ ignorado: evento }` para que PrometIO no reintente |

El `secreto` lo genera PrometIO al crear la fila de `organizacion_webhook`; el mismo valor va en
`PROMETIO_WEBHOOK_SECRET` de BackIO. Una fila por evento, las tres con el mismo secreto.

### Controles del webhook

- La firma se valida con HMAC-SHA256 sobre el cuerpo. Se lee de `X-Prometio-Signature: sha256=<hmac>`; si no
  viene, se acepta `X-Signature` como respaldo.
- Anti-replay: el `timestamp` del cuerpo (que va firmado) debe estar a menos de 5 minutos de la hora de
  BackIO. Si además llega `X-Prometio-Timestamp`, también se revisa. Un cuerpo idéntico que se repite dentro de
  10 minutos se descarta como duplicado.
- Los rechazos quedan en la auditoría: `webhook_rechazado` (firma inválida o secreto sin configurar) y
  `webhook_payload_invalido` (cuerpo que no cumple el esquema).
- En producción, si `PROMETIO_WEBHOOK_SECRET` no está configurado, todo webhook recibe 401.

## Autenticación entre sistemas

| Dirección | Método |
|---|---|
| PrometIO → BackIO (consulta) | API key de perfil `prometio` (`read:proyectos`, `write:proyectos`) |
| PrometIO → BackIO (webhook) | HMAC-SHA256 con secreto compartido en `X-Prometio-Signature` |
| BackIO → PrometIO | Ninguna llamada autenticada. BackIO solo usa `PROMETIO_URL` para revisar `/health` en Admin → Servicios |

El secreto del webhook va en las variables del backend en Railway, nunca en el repo.

---

## Migración: unificar los IDs existentes

PrometIO ya tiene clientes con IDs. BackIO arranca vacío.

**Procedimiento (una sola vez, Fase 0):**

1. Export de clientes de PrometIO: `id`, `nombre`, `activo`
2. Insert directo en `clientes` de BackIO usando **el mismo `id`** (por eso `clientes.id`
   no tiene `default gen_random_uuid()`)
3. Completar manualmente `basecamp_project_id` por cliente activo
4. Verificar: `select count(*)` debe coincidir en ambos sistemas para clientes activos

```sql
-- Verificación
-- En BackIO:
select id, nombre from clientes where activo = true order by nombre;
-- Comparar contra el mismo query en PrometIO. Los IDs deben ser idénticos.
```

Si algún ID no coincide después de la migración, **detener** y corregir antes de crear
cualquier proyecto. Corregir después implica reescribir referencias.

---

## Lo que NO se comparte

| No compartido | Razón |
|---|---|
| Comisiones y montos por vendedor | Dato sensible de PrometIO, BackIO no lo necesita |
| Actividades comerciales (llamadas, visitas) | Vive en PrometIO |
| Notas internas de cuenta (`notas_cuenta`) | Vive en BackIO |
| Señales del weekly | Operativo, no comercial |
| Comentarios de producción | No existen en ninguno de los dos. Viven en Basecamp |
