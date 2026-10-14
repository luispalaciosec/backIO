# 02 · Frontera de visibilidad cliente/interno

> Revisado contra el código el 11/10/2026.

> Léelo antes de tocar el portal o la sincronización.
> Un error aquí no genera un bug: genera la pérdida de una cuenta.
> Zona de revisión humana obligatoria. Sin commit automático.

---

## El riesgo concreto

Un director de arte escribe en una revisión: *"esto está horrible, hay que rehacerlo"*.
Si ese texto llega al portal del cliente, el daño es inmediato e irreversible.

En Geeks, pocos clientes concentran buena parte de la facturación. El costo de un solo incidente
excede varios años del ahorro que justifica todo este proyecto.

---

## Las tres defensas

La protección es en capas. Cada una sola es insuficiente; las tres juntas hacen el fallo
prácticamente imposible.

### Defensa 1 — Separación física (estructural)

El texto de producción **nunca entra a la base de datos de BackIO**.

Del webhook de Basecamp se extraen únicamente estos campos. La interfaz real está en
`backend/src/lib/basecamp/sync.ts`:

```typescript
// backend/src/lib/basecamp/sync.ts
export interface BasecampSyncPayload {
  todo_id: number;
  /** null = el evento no informa el estado; hay que consultar el to-do vivo. */
  completed: boolean | null;
  bucket_id: number | null;
  completed_at: string | null;
  due_on: string | null;
  assignee_ids: number[];
  updated_at: string;
  /** true = el to-do fue enviado a la papelera o archivado; false = restaurado. */
  eliminado?: boolean;
}
// NADA MÁS. Ni content, ni description, ni comments, ni attachments.
```

`extractSafePayload` y `extractSafeTodo` arman este objeto campo a campo. `bucket_id` es el id del proyecto de
Basecamp y sirve para verificar que el evento corresponde al cliente correcto.

```typescript
// PROHIBIDO. Si aparece en el código, es un defecto crítico.
const payload = { ...basecampTodo };          // ❌ spread del objeto completo
const desc = basecampTodo.description;         // ❌
const comments = await bc.getComments(todoId); // ❌
```

**Test obligatorio.** Vive en `backend/src/lib/basecamp/sync.test.ts` («nunca persiste texto proveniente de
Basecamp»). La idea es esta:

```typescript
it('nunca persiste texto proveniente de Basecamp', async () => {
  const raw = mockBasecampTodo({
    description: 'ESTO ESTA HORRIBLE',
    comments: [{ content: 'el cliente no sabe lo que quiere' }]
  });
  await syncFromBasecamp(raw);
  const all = await db.raw('select * from requerimientos');
  const dump = JSON.stringify(all);
  expect(dump).not.toContain('HORRIBLE');
  expect(dump).not.toContain('no sabe lo que quiere');
});
```

**El webhook no confía en el payload.** Basecamp no firma sus webhooks y el secreto de la URL es el mismo para
todos los proyectos. Por eso, cuando el to-do ya está gestionado por BackIO, el estado se lee del to-do vivo en
Basecamp, dentro del proyecto del cliente guardado en BackIO y no del que diga el payload
(`estadoVivo` en `backend/src/routes/webhooks/basecamp.ts`). Si el evento no corresponde a ese proyecto, se
descarta. Si Basecamp no responde, el webhook devuelve 503 y Basecamp reintenta la entrega.

**Los tokens de Basecamp tampoco quedan al alcance del equipo.** Con el token de acceso se pueden leer
comentarios y adjuntos de todos los proyectos, lo que rompería esta defensa por fuera de BackIO. Desde la
revisión del 23/09/2026 viven en la tabla `integracion_credenciales`, con RLS activo y sin políticas: solo el
service role del backend la lee (migración `20260923000021_seguridad_rls.sql`).

**Excepción acotada D1 (aprobada por Luis, 04/09/2026).** Para importar el trabajo que ya vive en
Basecamp y para detectar to-dos creados fuera de BackIO, entra el **título** del to-do como
`titulo_interno`, siempre con `visible_cliente = false` y sin etiqueta. Un título es el nombre de una
tarea, no una conversación. Siguen fuera, sin excepción: descripción, comentarios, adjuntos y la
descripción de las entradas de timesheet. Se implementa en `BasecampClient.listTodosSafe` y
`timesheetSafe`, que construyen el objeto campo a campo.

**Excepción D1b (aprobada por Luis, 13/10/2026).** El **nombre de la lista** de Basecamp entra como nombre del
proyecto (`lib/basecamp/importar.ts`) y el cliente lo ve en su portal. Es el nombre que el equipo le da al proyecto, no
una conversación, y el portal necesita uno. Consecuencia para el equipo: en Basecamp, las listas se nombran como las
vería el cliente.

### Defensa 2 — Visibilidad heredada, monotónica (lógica)

`visible_cliente` se hereda de `plantilla_tareas.visible_cliente_default`.

**Solo se puede restringir. Nunca abrir.**

```sql
create or replace function enforce_visibilidad_monotonica()
returns trigger as $$
begin
  if NEW.visible_cliente = true and OLD.visible_cliente = false then
    raise exception 'No se puede abrir visibilidad al cliente. Se hereda de plantilla.';
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger trg_visibilidad_monotonica
  before update on requerimientos
  for each row execute function enforce_visibilidad_monotonica();
```

Ese trigger solo actúa al actualizar. Desde la revisión del 23/09/2026 hay un segundo trigger para la creación
(`trg_requerimientos_visibilidad_insert`, migración `20260923000021_seguridad_rls.sql`, endurecido en la
`20261013000032_escaneo_triggers.sql`). Una tarea nace visible solo si su `plantilla_tarea_id` apunta a una tarea de
plantilla del mismo tenant marcada como visible por defecto, o si la crea alguien de gestión. En cualquier otro caso
nace oculta. Así un agente con permiso de escritura no puede crear una tarea visible al cliente por fuera de una
plantilla, ni mandando un `plantilla_tarea_id` cualquiera (antes bastaba con que no fuera nulo).

Enforced en base de datos, no en UI. Un bug de frontend, una llamada directa a la API o un
agente LLM mal configurado no pueden saltarse un trigger.

Para hacer visible algo que no lo era: se edita la plantilla y se crea un requerimiento
nuevo. Fricción intencional.

### Defensa 3 — Payload sanitizado (salida)

El portal cliente y las tools MCP con perfil cliente **no** consultan `requerimientos` directamente. Consumen
una función única, `sanitizeForClient`.

La implementación está en `shared/src/visibility/sanitize.ts`, en el paquete compartido, para que el preview
del Builder y el portal usen exactamente la misma función. `backend/src/lib/visibility/index.ts` solo
re-exporta `sanitizeForClient` y `assertClientSafe`.

```typescript
// shared/src/visibility/sanitize.ts
export interface ClientSafeRequirement {
  id: string;
  titulo: string;            // etiqueta_cliente, NUNCA titulo_interno
  estado: 'pendiente' | 'en_proceso' | 'completado';
  fecha_estimada: string | null;
  esperando_cliente: boolean;
}

export interface ClientSafeProject {
  nombre: string;
  avance: number;            // ponderado y RENORMALIZADO sobre visibles
  fecha_entrega: string;
  hitos: ClientSafeRequirement[];
  bloqueado_por_cliente: { titulo: string; dias: number }[];
}

export function sanitizeForClient(
  p: SanitizableProject,            // solo nombre y fecha_entrega
  reqs: SanitizableRequirement[],   // solo los campos que la función necesita
  ahora: Date = new Date(),
): ClientSafeProject
```

Qué hace la función:

1. Filtra dos veces. Un requerimiento solo pasa si `visible_cliente` es `true` **y** tiene `etiqueta_cliente`
   no vacía. La base ya lo exige con un constraint, pero la función no confía en eso.
2. Calcula el avance con los pesos de los visibles que pasaron el filtro (ver «Renormalización» abajo).
3. Arma los hitos con `etiqueta_cliente` como título y el estado colapsado.
4. Lista lo que espera al cliente (`estado_aprobacion = 'pendiente_cliente'`) con los días desde la última
   actualización.

El módulo exporta además:

| Export | Para qué |
|---|---|
| `assertClientSafe` | Revisa el payload ya armado y lanza un error si aparece algún campo prohibido. El portal lo llama antes de responder (`backend/src/routes/portal.ts`) |
| `CAMPOS_PROHIBIDOS_CLIENTE` | Lista de campos que nunca pueden salir: `titulo_interno`, `owner_agencia`, `peso`, `prioridad`, `estado_operativo`, `notas_cuenta`, `tenant_id`, todo lo de `basecamp`, entre otros |
| `mapEstadoCliente` | Traduce el estado operativo al estado que ve el cliente |
| `diasDesde` | Cuenta los días para «esperando tu aprobación» |

**Regla de estados:** `completado` se muestra como completado; `backlog` y `priorizado`, como pendiente
(«Por iniciar»). Todos los demás se colapsan a `en_proceso`: `en_ejecucion`, `en_revision`, `reprogramado`,
`bloqueado` y también `cancelado`. El cliente no ve la palabra "atrasado" ni "bloqueado por nosotros".

Que `cancelado` se muestre como «En proceso» fue una decisión explícita (04/09/2026, Luis). Las tareas
visibles canceladas siguen apareciendo como hitos en proceso, pero desde el 11/10/2026 (decisión de Luis) no
cuentan en el avance: `sanitizeForClient` lo calcula solo sobre las visibles no canceladas.

**Agentes con perfil cliente.** Una API key de perfil «cliente» queda atada a un cliente
(`api_keys.cliente_id`, migración `20261010000027_seguridad_auditoria_1010.sql`). La tool MCP
`get_project_status` con ese perfil solo responde por proyectos de ese cliente y devuelve la salida de
`sanitizeForClient`. Una key de perfil cliente sin cliente asignado no ve ningún proyecto
(`backend/src/lib/mcp/tools/read.ts`).

---

## Renormalización del avance

Si el proyecto tiene 10 tareas y el cliente ve 5, el porcentaje debe calcularse **solo
sobre esas 5**, con pesos renormalizados.

Mostrar 62% derivado de 10 tareas cuando el cliente ve 5 produce números que no cuadran
con lo que tiene en pantalla. Va a preguntar, y la respuesta es incómoda.

| | Peso interno | Visible | Peso renormalizado |
|---|---|---|---|
| Kickoff interno | 5 | No | — |
| Research | 10 | Sí | 15.4 |
| Ruta creativa v1 | 10 | No | — |
| Revisión DA | 5 | No | — |
| Ruta creativa v2 | 10 | No | — |
| Presentación concepto | 15 | Sí | 23.1 |
| Ajustes | 10 | Sí | 15.4 |
| Producción | 25 | Sí | 38.5 |
| QA | 5 | No | — |
| Entrega final | 5 | Sí | 7.7 |
| **Total** | **100** | | **100** |

---

## Por qué NO se cuenta por conteo simple

Rechazado explícitamente: "10 tareas, 6 completadas = 60%".

Si esas 6 son kickoff, research y administrativas, y faltan las 4 de producción, el
proyecto real va en ~20%. El cliente planea sobre 60%, no llegas, y el daño es mayor que
si nunca hubieras mostrado el número.

Los pesos se definen por plantilla y se recalibran con datos reales después de 3-4
proyectos cerrados.

---

## Checklist de revisión (obligatorio antes de exponer cualquier portal)

- [ ] Ningún campo de texto de Basecamp existe en el esquema de BackIO, salvo el título del to-do (excepción D1)
- [ ] Trigger de visibilidad monotónica aplicado y probado
- [ ] Todo lo que sale hacia el cliente pasa por `sanitizeForClient` y luego por `assertClientSafe`
- [ ] No existe endpoint que devuelva `titulo_interno` sin autenticación interna
- [ ] `notas_cuenta.visible_cliente = false` es el default
- [ ] Tools MCP de lectura usan `sanitizeForClient` cuando el scope es cliente, y la key está atada a su cliente
- [ ] Test de fuga de texto pasando
- [ ] Test de intento de apertura de visibilidad falla correctamente
- [ ] Preview del paso 5 del Builder muestra exactamente lo que verá el cliente

---

## Test suite mínima

Las pruebas reales de `sanitizeForClient` y `assertClientSafe` están en `shared/src/__tests__/sanitize.test.ts`.
La del endpoint público está en `backend/src/__tests__/portal.test.ts` y la de extracción desde Basecamp, en
`backend/src/lib/basecamp/sync.test.ts`. El primer caso de abajo (el trigger que impide abrir visibilidad) no
tiene hoy una prueba automatizada en el repositorio: depende de la base de datos. El resto muestra lo que cubren
las pruebas existentes.

```typescript
describe('frontera de visibilidad', () => {
  it('no permite abrir visibilidad', async () => {
    const r = await crearRequerimiento({ visible_cliente: false });
    await expect(
      db.update('requerimientos', r.id, { visible_cliente: true })
    ).rejects.toThrow('No se puede abrir visibilidad');
  });

  it('sanitize nunca expone titulo_interno', () => {
    const out = sanitizeForClient(proyecto, [
      { titulo_interno: 'Ruta creativa v3 - la mala', visible_cliente: false, peso: 10 },
      { titulo_interno: 'Entrega', etiqueta_cliente: 'Entrega', visible_cliente: true, peso: 10 }
    ]);
    expect(JSON.stringify(out)).not.toContain('la mala');
    expect(out.hitos).toHaveLength(1);
  });

  it('renormaliza el avance sobre visibles', () => {
    const out = sanitizeForClient(proyecto, [
      { visible_cliente: true,  peso: 50, estado_operativo: 'completado', etiqueta_cliente: 'A' },
      { visible_cliente: true,  peso: 50, estado_operativo: 'backlog',    etiqueta_cliente: 'B' },
      { visible_cliente: false, peso: 100, estado_operativo: 'completado' }
    ]);
    expect(out.avance).toBe(50);   // no 66
  });

  it('colapsa estados internos', () => {
    const out = sanitizeForClient(proyecto, [
      { visible_cliente: true, peso: 1, estado_operativo: 'bloqueado', etiqueta_cliente: 'X' }
    ]);
    expect(out.hitos[0].estado).toBe('en_proceso');
  });
});
```
