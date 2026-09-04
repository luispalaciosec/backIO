# 02 · Frontera de visibilidad cliente/interno

> **Este es el documento más importante del repositorio.**
> Un error aquí no genera un bug: genera la pérdida de una cuenta.
> Zona de revisión humana obligatoria. Sin commit automático.

---

## El riesgo concreto

Un director de arte escribe en una revisión: *"esto está horrible, hay que rehacerlo"*.
Si ese texto llega al portal del cliente, el daño es inmediato e irreversible.

En Geeks, dos clientes representan ~67% de la facturación. El costo de un solo incidente
excede varios años del ahorro que justifica todo este proyecto.

---

## Las tres defensas

La protección es en capas. Cada una sola es insuficiente; las tres juntas hacen el fallo
prácticamente imposible.

### Defensa 1 — Separación física (estructural)

El texto de producción **nunca entra a la base de datos de BackIO**.

Del webhook de Basecamp se extraen únicamente estos campos:

```typescript
// lib/basecamp/sync.ts
interface BasecampSyncPayload {
  todo_id: number;
  completed: boolean;
  completed_at: string | null;
  due_on: string | null;
  assignee_ids: number[];
  updated_at: string;
}
// NADA MÁS. Ni content, ni description, ni comments, ni attachments.
```

```typescript
// PROHIBIDO. Si aparece en el código, es un defecto crítico.
const payload = { ...basecampTodo };          // ❌ spread del objeto completo
const desc = basecampTodo.description;         // ❌
const comments = await bc.getComments(todoId); // ❌
```

**Test obligatorio:**
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

**Excepción acotada D1 (aprobada por Luis, 04/09/2026).** Para importar el trabajo que ya vive en
Basecamp y para detectar to-dos creados fuera de BackIO, entra el **título** del to-do como
`titulo_interno`, siempre con `visible_cliente = false` y sin etiqueta. Un título es el nombre de una
tarea, no una conversación. Siguen fuera, sin excepción: descripción, comentarios, adjuntos y la
descripción de las entradas de timesheet. Se implementa en `BasecampClient.listTodosSafe` y
`timesheetSafe`, que construyen el objeto campo a campo.

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

Enforced en base de datos, no en UI. Un bug de frontend, una llamada directa a la API o un
agente LLM mal configurado no pueden saltarse un trigger.

Para hacer visible algo que no lo era: se edita la plantilla y se crea un requerimiento
nuevo. Fricción intencional.

### Defensa 3 — Payload sanitizado (salida)

El portal cliente y las tools MCP **no** consultan `requerimientos` directamente. Consumen
una función única:

```typescript
// lib/visibility/sanitize.ts
// ÚNICO punto de salida hacia el cliente. No existe otro.

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

export function sanitizeForClient(p: Proyecto, reqs: Requerimiento[]): ClientSafeProject {
  const visibles = reqs.filter(r => r.visible_cliente === true);

  const pesoTotal = visibles.reduce((s, r) => s + r.peso, 0);
  const pesoHecho = visibles
    .filter(r => r.estado_operativo === 'completado')
    .reduce((s, r) => s + r.peso, 0);

  return {
    nombre: p.nombre,
    avance: pesoTotal === 0 ? 0 : Math.round((pesoHecho / pesoTotal) * 100),
    fecha_entrega: p.fecha_entrega,
    hitos: visibles.map(r => ({
      id: r.id,
      titulo: r.etiqueta_cliente!,     // nunca titulo_interno
      estado: mapEstado(r.estado_operativo),
      fecha_estimada: r.fecha_entrega,
      esperando_cliente: r.estado_aprobacion === 'pendiente_cliente'
    })),
    bloqueado_por_cliente: visibles
      .filter(r => r.estado_aprobacion === 'pendiente_cliente')
      .map(r => ({ titulo: r.etiqueta_cliente!, dias: diasDesde(r.ultima_actualizacion) }))
  };
}
```

**Regla de estados:** los estados internos (`reprogramado`, `bloqueado`, `en_revision`)
se colapsan a `en_proceso` para el cliente. El cliente no ve la palabra "atrasado" ni
"bloqueado por nosotros".

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

- [ ] Ningún campo de texto de Basecamp existe en el esquema de BackIO
- [ ] Trigger de visibilidad monotónica aplicado y probado
- [ ] `sanitizeForClient` es el único export del módulo de salida cliente
- [ ] No existe endpoint que devuelva `titulo_interno` sin autenticación interna
- [ ] `notas_cuenta.visible_cliente = false` es el default
- [ ] Tools MCP de lectura usan `sanitizeForClient` cuando el scope es cliente
- [ ] Test de fuga de texto pasando
- [ ] Test de intento de apertura de visibilidad falla correctamente
- [ ] Preview del paso 5 del Builder muestra exactamente lo que verá el cliente

---

## Test suite mínima

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
