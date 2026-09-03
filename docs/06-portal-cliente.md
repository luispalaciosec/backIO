# 06 · Portal cliente

## Objetivo

Reemplazar la vista que hoy el cliente tiene en Monday.com, con dos mejoras:
1. El cliente **no paga asiento** (aquí está el ahorro real de ~$15,000/año)
2. Es imposible que vea contenido interno (ver `02-visibilidad.md`)

## Referencia visual

El cliente viene de Monday. La UI debe resultarle familiar: tablas limpias, chips de estado
con color sólido, tipografía clara, mucho espacio en blanco.

**Paleta de estados** (inspirada en el lenguaje visual que el cliente ya conoce):

| Estado cliente | Color | Hex |
|---|---|---|
| Completado | Verde | `#00C875` |
| En proceso | Azul | `#0073EA` |
| Por iniciar | Gris | `#C4C4C4` |
| Esperando tu aprobación | Ámbar | `#FDAB3D` |

Nunca rojo. El cliente no ve "atrasado" ni "bloqueado por nosotros".

---

## Acceso

**Sin login, sin cuenta, sin contraseña.** URL con token firmado:

```
https://backio.geeks.ec/p/{portal_token}
```

- `portal_token`: 32 bytes aleatorios, único por proyecto
- Se puede rotar (invalida el anterior)
- Se puede desactivar (`portal_activo = false`)
- Expira automáticamente 60 días después de `fecha_entrega`
- No indexable: `X-Robots-Tag: noindex`, `robots.txt` bloqueando `/p/*`

**Por qué sin login:** cada credencial es fricción, y la fricción hace que el cliente no
entre. Si no entra, el portal no cumple su función. El contenido es sanitizado por diseño,
así que el riesgo de exposición es bajo.

Para cuentas que exijan más control (bancos), opción de agregar PIN de 6 dígitos por
proyecto. Configurable en `clientes.config`.

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
  "cliente": "Banco Amazonas",
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

**Prompt del sistema:**

```
Eres el asistente de comunicación de Geeks Ecuador, agencia creativa.
Escribes para un cliente corporativo en español de Ecuador neutro.

Redacta un resumen ejecutivo de máximo 3 párrafos cortos sobre el estado
del proyecto, usando ÚNICAMENTE los datos del JSON.

Reglas:
- Tono profesional, cálido, directo. Sin superlativos ni marketing.
- Si hay elementos en "esperando_cliente", menciónalos con naturalidad,
  sin tono de reclamo. Es información, no presión.
- No inventes fechas, nombres, personas ni actividades que no estén en el JSON.
- No uses jerga de agencia.
- Nunca uses voseo argentino.
- Si no hay datos suficientes para un párrafo, escribe menos. No rellenes.
```

El modelo no puede alucinar contenido interno porque no lo tiene.

**Caché:** el resumen se cachea 6 horas. Evita costo y evita que el cliente vea textos
distintos al recargar.

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

```
app/p/[token]/
  page.tsx              -- server component, sin auth
  _components/
    AvanceBar.tsx
    HitosList.tsx
    EsperandoCliente.tsx
    ResumenEjecutivo.tsx  -- client, llama /api/portal/[token]/resumen

app/api/portal/[token]/
  route.ts              -- devuelve ClientSafeProject y NADA MÁS
  resumen/route.ts      -- llama Anthropic API con payload sanitizado
```

**Regla dura:** `app/api/portal/` es el único directorio que puede servir datos sin
autenticación interna, y todo lo que sale de ahí pasa por `sanitizeForClient()`.

Test de integración obligatorio:
```typescript
it('el endpoint público nunca devuelve campos internos', async () => {
  const res = await fetch(`/api/portal/${token}`);
  const body = await res.text();
  ['titulo_interno','owner_agencia','basecamp','peso','prioridad','estado_operativo']
    .forEach(campo => expect(body).not.toContain(campo));
});
```
