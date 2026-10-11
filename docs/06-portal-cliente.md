# 06 · Portal cliente

> Revisado contra el código el 11/10/2026.

## Objetivo

Reemplazar la vista que hoy el cliente tiene en Monday.com, con dos mejoras:
1. El cliente **no paga asiento** (aquí está el ahorro real frente a las licencias de Monday)
2. Es imposible que vea contenido interno (ver [02 · Visibilidad](./02-visibilidad.md))

## Referencia visual

El cliente viene de Monday. La UI debe resultarle familiar: tablas limpias, chips de estado
con color sólido, tipografía clara, mucho espacio en blanco.

**Paleta de estados** (inspirada en el lenguaje visual que el cliente ya conoce):

| Estado cliente | Color | Hex |
|---|---|---|
| Completado | Verde | `#0B7A3B` |
| En proceso | Azul | `#0073EA` |
| Por iniciar | Gris | `#C4C4C4` |
| Esperando tu aprobación | Ámbar | `#FDAB3D` |

Los colores están en `frontend/tailwind.config.ts` (`estado.*`).

Nunca rojo. El cliente no ve "atrasado" ni "bloqueado por nosotros".

Cómo se traduce cada estado interno (`mapEstadoCliente`, ver [02 · Visibilidad](./02-visibilidad.md)):
`completado` se muestra como Completado; `backlog` y `priorizado`, como Por iniciar; todos los demás, como En
proceso. Eso incluye `cancelado`, que se muestra como «En proceso» por decisión explícita (04/09/2026, Luis). Las
tareas visibles canceladas aparecen como hitos en proceso, pero no cuentan en el avance del portal (decisión del
11/10/2026, Luis).

---

## Acceso

**Sin login, sin cuenta, sin contraseña.** URL con un token aleatorio:

```
https://backio.vercel.app/p/{portal_token}
```

- `portal_token`: 32 bytes aleatorios en base64url, único por proyecto (`backend/src/lib/portal/token.ts`). No
  está firmado: vale como una contraseña larga.
- Se puede rotar (invalida el anterior) desde la ficha del proyecto, con `POST /proyectos/:id/portal/rotar`
- Se puede desactivar (`portal_activo = false`). Nace inactivo
- Expira automáticamente 60 días después de `fecha_entrega`
- El backend solo sirve proyectos con `portal_activo = true` y sin borrar (`deleted_at` nulo), y de esos solo los
  requerimientos sin borrar (`getProyectoByPortalToken` en `backend/src/lib/db/proyectos.ts`)
- No indexable: la API del portal responde con `X-Robots-Tag: noindex, nofollow`, la página lleva
  `robots: noindex` y el `robots.txt` del frontend bloquea todo el sitio, no solo `/p/` (`frontend/app/robots.ts`)

**Por qué sin login:** cada credencial es fricción, y la fricción hace que el cliente no
entre. Si no entra, el portal no cumple su función. El contenido es sanitizado por diseño,
así que el riesgo de exposición es bajo.

Para cuentas que exijan más control (bancos) se puede poner un PIN. Funciona así:

- Es por cliente, no por proyecto: vale para todos los portales de ese cliente.
- Tiene de 4 a 6 dígitos. Se fija o se quita en Admin → Clientes, que llama a `PATCH /clientes/:id` con
  `portal_pin` (`null` lo quita).
- Se guarda con hash scrypt y sal en la tabla `portal_pines`, que solo lee el service role
  (`backend/src/lib/portal/pin.ts`, migración `20261010000027_seguridad_auditoria_1010.sql`). Mientras un PIN
  antiguo no se migre, el backend todavía acepta el que quedó en claro en `clientes.config`.
- Los intentos fallidos se cuentan en ventanas de 15 minutos (`backend/src/routes/portal.ts`). Con 8 fallos
  desde la misma IP, esa IP queda bloqueada para ese enlace. Con 30 fallos desde cualquier IP, el enlace queda
  bloqueado para todos. Los contadores viven en Postgres, así que sobreviven a un reinicio.
- El visitante ve «PIN incorrecto.» o «Demasiados intentos. Espera 15 minutos.»
  (`frontend/app/p/[token]/_components/PortalView.tsx`).

---

## Estructura de la página

```
┌────────────────────────────────────────────────────┐
│  [logo cliente]        Campaña Navidad 2026        │
│                        Geeks · Entrega 15/12/2026  │
├────────────────────────────────────────────────────┤
│                                                    │
│   ████████████████░░░░░░░░░░  62%                  │
│   Avance del proyecto                              │
│                                                    │
├────────────────────────────────────────────────────┤
│  ⚠  Esperando tu aprobación                        │
│     Propuesta creativa · 4 días                    │
├────────────────────────────────────────────────────┤
│  HITOS                                             │
│  ✓  Investigación de mercado        Completado     │
│  ✓  Propuesta creativa              Completado     │
│  ◐  Ajustes solicitados             En proceso     │
│  ○  Producción                      Por iniciar    │
│  ○  Entrega                         Por iniciar    │
├────────────────────────────────────────────────────┤
│  [ Ver resumen ejecutivo ]                         │
└────────────────────────────────────────────────────┘
```

Mobile-first. Los clientes lo van a abrir desde el celular.

---

## Resumen ejecutivo con IA

Botón que genera 3 párrafos en lenguaje natural.

**El modelo nunca ve el canal de producción.** Recibe únicamente el payload sanitizado:

```json
{
  "proyecto": "Campaña Navidad 2026",
  "cliente": "Cliente Ejemplo",
  "avance_ponderado": 62,
  "completados": ["Investigación de mercado", "Propuesta creativa"],
  "en_curso": ["Ajustes solicitados"],
  "por_iniciar": ["Producción", "Entrega"],
  "fecha_entrega": "2026-12-15",
  "esperando_cliente": [
    { "titulo": "Propuesta creativa", "dias": 4 }
  ]
}
```

**Prompt del sistema** (`SYSTEM_PROMPT` en `backend/src/lib/portal/resumen.ts`):

```
Eres el asistente de comunicación de Geeks Ecuador, agencia creativa.
Escribes para un cliente corporativo en español de Ecuador neutro.

Redacta un resumen ejecutivo de máximo 3 párrafos cortos sobre el estado
del proyecto, usando ÚNICAMENTE los datos del JSON.

Reglas:
- Tono sobrio. Sin superlativos ni marketing.
- Si algo espera al cliente ("esperando_cliente"), di qué es y desde cuándo, en una frase, sin tono de reclamo.
- No inventes fechas, nombres, personas ni actividades que no estén en el JSON.
- No uses jerga de agencia ni las fórmulas "no es X, es Y", "clave", "potenciar" o enumeraciones de tres adjetivos.
- Nunca uses voseo argentino.
- Si no hay datos suficientes para un párrafo, escribe menos.
```

El modelo es `claude-sonnet-5`. Antes de llamarlo, el backend vuelve a pasar el payload por `assertClientSafe`.

El modelo no puede alucinar contenido interno porque no lo tiene.

**Caché:** el resumen se guarda en `portal_resumenes` junto con un hash del payload. Si en las últimas 6 horas el
payload no cambió, se devuelve el mismo texto. Evita costo y evita que el cliente vea textos distintos al
recargar. Si el payload cambia, se redacta uno nuevo.

**Límite:** cada enlace puede pedir como máximo 10 resúmenes por hora.

---

## `esperando_cliente`: la mejor herramienta comercial del sistema

Este campo documenta, sin confrontación, cuándo el retraso es del cliente.

En el acta del 03/08 aparecen 5 dependencias marcadas "Alto — Cliente" (briefs de Navidad
y Black Friday, aprobaciones de Factoring, Cash Management y Playbook). Ninguna con
responsable ni acción definida.

Con el portal, esas cinco esperas quedan visibles para el cliente **en tiempo real y con
contador de días**, sin que nadie tenga que escribir un correo incómodo.

Es la diferencia entre "ustedes se atrasaron" y un registro compartido de dónde estuvo cada
espera.

---

## Lo que el portal NO tiene

| Descartado | Razón |
|---|---|
| Comentarios del cliente | Genera un canal paralelo que nadie va a monitorear. El feedback va por correo o reunión, como hoy |
| Aprobación con un click | Tentador, pero una aprobación sin trazabilidad legal es un riesgo. v2 |
| Descarga de entregables | Los archivos finales siguen entregándose por los canales actuales |
| Nombres del equipo interno | El cliente no necesita saber quién hizo qué |
| Fechas de tareas internas | Solo la fecha de entrega del proyecto y de hitos visibles |

---

## Implementación

| Pieza | Archivo |
|---|---|
| Página del portal | `frontend/app/p/[token]/page.tsx`. Es solo un contenedor de servidor, sin auth |
| Carga de datos, PIN y vista | `frontend/app/p/[token]/_components/PortalView.tsx`, en el navegador. Usa `frontend/components/VistaCliente.tsx` |
| Botón de resumen | `frontend/app/p/[token]/_components/ResumenEjecutivo.tsx` |
| Barra de avance y chips de estado | `frontend/components/ui/AvanceBar.tsx`, `frontend/components/ui/EstadoChip.tsx` |
| API del portal | `backend/src/routes/portal.ts` (Hono), montada en `/api/portal` |
| Resumen con IA | `backend/src/lib/portal/resumen.ts` |

Endpoints públicos:

| Endpoint | Qué devuelve |
|---|---|
| `GET /api/portal/:token` | `ClientSafeProject` más nombre, logo y color del cliente. Nada más |
| `POST /api/portal/:token/resumen` | El resumen ejecutivo |

Si el portal tiene PIN, el navegador lo manda en la cabecera `x-portal-pin`.

**Regla dura:** `backend/src/routes/portal.ts` es el único lugar que sirve datos sin autenticación interna, y
todo lo que sale de ahí pasa por `sanitizeForClient()` y después por `assertClientSafe()`, que lanza un error si
aparece un campo prohibido.

Test de integración obligatorio. Vive en `backend/src/__tests__/portal.test.ts` («nunca devuelve campos
internos»). La idea es esta:
```typescript
it('el endpoint público nunca devuelve campos internos', async () => {
  const res = await fetch(`/api/portal/${token}`);
  const body = await res.text();
  ['titulo_interno','owner_agencia','basecamp','peso','prioridad','estado_operativo']
    .forEach(campo => expect(body).not.toContain(campo));
});
```
