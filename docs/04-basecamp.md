# 04 · Integración con Basecamp

> Zona de revisión humana obligatoria para escrituras.
> Basecamp es el sistema de producción vivo de Geeks. Un bug aquí ensucia proyectos reales.

---

## Principio: unidireccionalidad de estados

| Dato | Fuente de verdad | Dirección |
|---|---|---|
| `completed` / `completed_at` | **Basecamp** | Basecamp → BackIO |
| Existencia del to-do | BackIO (lo crea) | BackIO → Basecamp |
| `due_on` | BackIO | BackIO → Basecamp (al crear y al reprogramar) |
| Asignaciones | BackIO | BackIO → Basecamp |
| Estado operativo, aprobación, prioridad, peso | **BackIO** | No sale |
| Comentarios, adjuntos, descripciones | **Basecamp** | **No entra jamás** |

Basecamp solo conoce `completed: true/false`. BackIO tiene ocho estados operativos. Intentar
mapearlos en ambos sentidos genera conflictos permanentes. **No se hace.**

---

## Autenticación

OAuth2 de Basecamp 3, a nivel de organización (no por usuario).

```
BASECAMP_CLIENT_ID
BASECAMP_CLIENT_SECRET
BASECAMP_ACCOUNT_ID
BASECAMP_REDIRECT_URI
```

Token de acceso y refresh guardados en `tenants.config` (encriptados). Refresh automático
antes de expirar.

**User-Agent obligatorio** (Basecamp lo exige y bloquea sin él):
```
User-Agent: BackIO Geeks (luis@geeks.ec)
```

Rate limit: 50 req / 10 seg. El cliente HTTP implementa cola con backoff exponencial.

---

## Escritura: crear proyecto

Al confirmar el paso 5 del Builder:

```typescript
// lib/basecamp/write.ts

async function createProjectStructure(proyecto: Proyecto, reqs: Requerimiento[]) {
  // 1. El proyecto de Basecamp YA EXISTE (clientes.basecamp_project_id).
  //    BackIO nunca crea proyectos en Basecamp, solo listas dentro de ellos.
  const bcProjectId = proyecto.cliente.basecamp_project_id;
  if (!bcProjectId) throw new Error('Cliente sin proyecto Basecamp configurado');

  // 2. Crear un todolist por proyecto BackIO
  const todolist = await bc.createTodolist(bcProjectId, {
    name: `${proyecto.nombre} · BackIO`,
    description: `Proyecto gestionado desde BackIO. Entrega: ${proyecto.fecha_entrega}`
  });

  // 3. Crear un to-do por requerimiento, agrupados por bloque
  for (const req of reqs) {
    const todo = await bc.createTodo(bcProjectId, todolist.id, {
      content: `[${req.bloque_nombre}] ${req.titulo_interno}`,
      due_on: req.fecha_entrega,
      assignee_ids: mapUsuariosABasecamp(req.owner_agencia)
    });
    await db.update('requerimientos', req.id, {
      basecamp_todo_id: todo.id,
      basecamp_todolist_id: todolist.id,
      basecamp_url: todo.app_url
    });
  }
}
```

**Salvaguardas obligatorias:**

| Salvaguarda | Regla |
|---|---|
| Límite por operación | Máximo 60 to-dos en una sola creación. Sobre eso, confirmación explícita adicional |
| Idempotencia | Si `basecamp_todo_id` ya existe, no recrear |
| Rollback | Si falla a mitad, marcar el proyecto como `sync_incompleto` y ofrecer reintento — nunca dejar estado ambiguo |
| Sandbox | Toda escritura nueva se prueba primero contra un proyecto Basecamp de pruebas |

---

## Lectura: webhook

Basecamp soporta webhooks por proyecto. Se registra uno por cliente activo.

```
POST /api/webhooks/basecamp
```

```typescript
// app/api/webhooks/basecamp/route.ts

export async function POST(req: Request) {
  const payload = await req.json();

  // Validar origen
  if (!verifyBasecampSignature(req)) return new Response('unauthorized', { status: 401 });

  // SOLO nos interesan eventos de to-do
  if (!['todo_completed','todo_uncompleted','todo_changed'].includes(payload.kind)) {
    return new Response('ok');
  }

  // EXTRACCIÓN ESTRICTA — ver 02-visibilidad.md, Defensa 1
  const safe = {
    todo_id:      payload.recording.id,
    completed:    payload.recording.completed,
    completed_at: payload.recording.completed_at ?? null,
    due_on:       payload.recording.due_on ?? null,
    updated_at:   payload.recording.updated_at
  };
  // NO se lee payload.recording.content ni .description ni .comments

  await applyBasecampUpdate(safe);
  return new Response('ok');
}
```

```typescript
async function applyBasecampUpdate(safe: BasecampSyncPayload) {
  const req = await db.findByBasecampTodo(safe.todo_id);
  if (!req) return;   // to-do creado fuera de BackIO: se ignora

  await db.update('requerimientos', req.id, {
    estado_operativo: safe.completed ? 'completado' : reabrirEstado(req),
    completado_at: safe.completed_at,
    ultima_actualizacion: new Date()
  });

  await recalcularAvanceProyecto(req.proyecto_id);
}
```

**Reapertura:** si un to-do completado se marca como no completado, el requerimiento vuelve
a `en_ejecucion`, no a `backlog`.

---

## Fallback: polling

Los webhooks de Basecamp fallan ocasionalmente. Cron cada 30 minutos que reconcilia:

```typescript
// Compara completed de Basecamp vs BackIO para requerimientos no completados
// de proyectos activos. Aplica diferencias.
```

Sin esto, un webhook perdido deja una tarea marcada como pendiente indefinidamente — y esa
tarea termina apareciendo como falso atraso en el weekly.

---

## Lo que NO se hace en v1

| Descartado | Razón |
|---|---|
| Sincronización de comentarios | Rompe la Defensa 1. Nunca se hará |
| Sincronización de adjuntos | Mismo motivo. Los entregables se suben a BackIO aparte |
| Crear proyectos en Basecamp | El proyecto de cliente ya existe y tiene configuración manual |
| Mapeo de Card Table | El Card Table de Basecamp queda deprecado; BackIO lo reemplaza |
| Sincronización de estados ricos | Ver principio de unidireccionalidad |

---

## Migración del Card Table existente

El WorkOS actual define un Card Table en Basecamp como "Backlog Priorizado". BackIO lo
reemplaza.

**Plan:** durante 4 semanas ambos coexisten (BackIO es la fuente, el Card Table se mantiene
manualmente como respaldo). A la quinta semana, el Card Table se archiva.

No se migra automáticamente: se hace export CSV y se importa con el bulk import del Builder,
asignando bloques y pesos a mano. Es una sola vez y garantiza limpieza.
