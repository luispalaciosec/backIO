# 08 · Interconexión BackIO ↔ PrometIO

## Contexto

PrometIO es el CRM de Geeks (construido internamente). BackIO es el sistema de backlog y
gestión de cuenta. Son sistemas hermanos que hoy comparten entidades sin saberlo.

**Decisión cerrada: `cliente_id` es el mismo UUID en ambos sistemas.**

Sin esto, en seis meses habría reconciliación manual permanente entre "Banco Amazonas" en
PrometIO y "Banco Amazonas" en BackIO. Es una hora de trabajo hoy o un dolor indefinido
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
PrometIO: cotización pasa a "ganada"
        ↓
POST https://backio.geeks.ec/api/v1/webhooks/prometio
{
  "evento": "cotizacion_ganada",
  "cotizacion_id": "uuid",
  "cliente_id": "uuid",            ← el MISMO id
  "monto": 12500.00,
  "fecha_cierre_estimada": "2026-12-15",
  "lineas": [
    { "servicio": "Campaña 360", "cantidad": 1 },
    { "servicio": "Piezas Instagram", "cantidad": 8 },
    { "servicio": "Mailing", "cantidad": 2 }
  ]
}
        ↓
BackIO crea un BORRADOR de proyecto (no lo ejecuta)
  - Sugiere plantilla según la línea principal
  - Prellena alcance desde las líneas
  - Prellena fecha de entrega
        ↓
Notifica a la ejecutiva de cuenta
        ↓
Ejecutiva abre el Builder en paso 2 (brief) — pasos 1 y 3 ya prellenados
Revisa, ajusta, confirma en paso 5
        ↓
Se crean requerimientos + to-dos en Basecamp
```

**El webhook no crea nada ejecutable.** Crea un borrador que requiere confirmación humana.
Misma lógica que el patrón preview + confirm de MCP.

### Mapeo servicio → plantilla

Tabla configurable, no hardcodeada:

```sql
create table mapeo_servicios (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  servicio_prometio text not null,
  plantilla_id      uuid references plantillas(id),
  bloque_nombre     text,          -- si el servicio mapea a un bloque, no a plantilla completa
  unique (tenant_id, servicio_prometio)
);
```

Si un servicio no está mapeado, el borrador se crea sin plantilla y la ejecutiva elige en
el paso 1.

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
{ "evento": "cliente_creado" | "cliente_actualizado",
  "cliente": { "id": "uuid", "nombre": "...", "activo": true } }
```

BackIO hace upsert por `id`. Nunca crea clientes por su cuenta — solo la interfaz de admin
puede, y solo para casos excepcionales.

Campos que BackIO agrega y PrometIO no conoce:
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
| `cotizacion.aprobada` | `cotizacion_id, numero, oportunidad_id, empresa{id,nombre,activo}, valor, valido_hasta, lineas[{servicio,cantidad}]` | Borrador de proyecto + correo a ejecutivas/operaciones |
| `empresa.creada` / `empresa.actualizada` | `id, nombre, activo, ruc, logo_url` | Upsert de cliente con el mismo id |

El `secreto` lo genera PrometIO al crear la fila de `organizacion_webhook`; el mismo valor va en
`PROMETIO_WEBHOOK_SECRET` de BackIO. Una fila por evento, las tres con el mismo secreto.

## Autenticación entre sistemas

| Dirección | Método |
|---|---|
| PrometIO → BackIO | API key con scope `read:proyectos`, `write:proyectos` |
| BackIO → PrometIO | API key de PrometIO, scope de lectura de clientes y cotizaciones |
| Webhooks | HMAC-SHA256 con secreto compartido en header `X-Signature` |

Los secretos viven en variables de entorno de Vercel, nunca en el repo.

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
