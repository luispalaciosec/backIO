# Clientes: ejecutiva de cuenta y ficha

## Mesa y ejecutiva de cuenta son cosas distintas (29/10/2026)

| Concepto | Qué es | Dónde vive |
|---|---|---|
| **Mesa** | El equipo de producción que ejecuta. El daily y el weekly son de la mesa | `clientes.mesa_id` (y el override `proyectos.mesa_id`) |
| **Ejecutiva de cuenta** | La dueña de la relación con el cliente. Puede tener cuentas en varias mesas | `clientes.ejecutiva_id` (migración 37) |

Un cliente se queda en la mesa que lo produce aunque su ejecutiva lidere otra. Grupo Torres & Torres lo produce
Mesa Omega y lo lleva Grace Franco, que lidera Mesa Orión: Torres & Torres sigue en Omega y Grace es su
ejecutiva.

- **Ejecutiva efectiva de un proyecto:**
  - es `proyectos.owner_ejecutiva` si está, y si no, la del cliente;
  - es la que suma en los KPIs del área Cuentas (ver [KPIs](./19-kpis.md)).
- **Asignarla:** Admin → Clientes, columna «Ejecutiva de cuenta» (solo admin, como el resto de la configuración del
  cliente).
- **«Mis cuentas»:** junta los clientes de la ejecutiva, de cualquier mesa, y los proyectos que tiene asignados en
  clientes de otra.
  - En el backlog es el filtro «Ejecutiva de cuenta» (`GET /requerimientos?ejecutiva=`).
  - En el daily es la opción «Mis cuentas» del paso 1 (`GET /semanas/daily?ejecutiva=`). Ahí es solo para leer: la
    apertura y el cierre se publican desde el daily de cada mesa.
  - En la lista de Clientes es el filtro por defecto para quien es ejecutiva de alguna cuenta.

**Rituales:**
- **Daily de la mesa:**
  - la ejecutiva entra solo al bloque de su cuenta, y solo si ese día hay algo que vence o está bloqueado;
  - en el mensaje publicado, esas tareas llevan «Cuenta: @ejecutiva», así le llega el aviso aunque no esté.
- **Weekly de la mesa:**
  - cada grupo de señales de un cliente muestra a su ejecutiva;
  - el filtro «Cuentas de…» recorre la agenda por bloques;
  - los acuerdos de esa cuenta quedan en el weekly de la mesa, con la ejecutiva como responsable.

Para recibir las menciones del daily, la ejecutiva tiene que ser miembro del proyecto de Basecamp de esa mesa.

## Ficha del cliente (`/clientes/:id`)

La lista `/clientes` muestra solo cuentas reales: con mesa, con ejecutiva o con trabajo en BackIO. Las empresas que
PrometIO manda y todavía son contactos del CRM (sin mesa, proyectos ni tareas) no aparecen; entran solas cuando se les
asigna una mesa o reciben su primer proyecto. Para cada cliente muestra su salud, ejecutiva (con foto), mesa, tareas activas y atrasadas, lo
que espera al cliente y el % a tiempo de 30 días. El nombre del cliente lleva a su ficha desde el backlog
(«Ficha»), los proyectos y el dashboard. La ven los roles de gestión; un colaborador no (`GET /clientes/:id/ficha`
responde 403).

La ficha (`backend/src/lib/clientes/ficha.ts`) reutiliza las mismas piezas que el dashboard:
- **Cabecera:**
  - nombre y color del cliente;
  - salud con su porqué;
  - ejecutiva de cuenta y líder de la mesa, con su foto de Basecamp.
- **Indicadores:**
  - % a tiempo según la fecha original y según la vigente, en 90 días, con el desvío mediano;
  - atrasadas, esperando al cliente y bloqueadas;
  - reprocesos en 90 días, cuántos son nuestros y el motivo principal;
  - horas en 30 días;
  - reprogramaciones, y cuántas fueron por el cliente.
- **Entregas por mes:** los últimos 6 meses, con el % a tiempo de cada uno.
- **Proyectos:** avance, tareas activas y atrasadas, horas y entrega.
- **Tareas:**
  - atrasadas;
  - esperando al cliente;
  - bloqueadas;
  - sin movimiento (más de 7 días y sin atraso);
  - las últimas 10 entregas, cada una marcada a tiempo o tarde.
- **Señales de esta semana:** las del cliente y las de sus tareas.

### Salud

Una sola regla, `saludCliente` (`shared/src/salud.ts`), para el dashboard y la ficha. Las entregas y los reprocesos
se miran en los últimos 90 días.

| Color | Cuándo |
|---|---|
| Rojo | más de 2 atrasadas, una con más de 30 días de atraso, más de 14 días sin movimiento, o menos del 60 % a tiempo |
| Amarillo | alguna atrasada, más de 7 días sin movimiento, menos del 80 % a tiempo, o reprocesos nuestros en más del 20 % de las entregas |
| Verde | nada de lo anterior |

- **Lo que espera al cliente no cuenta** (decisión de Luis, 29/10/2026):
  - una tarea con aprobación «pendiente del cliente» no suma atraso ni días sin movimiento a la salud, porque ese
    atraso es del cliente (`operacionParaSalud`);
  - la ficha la muestra en un aviso para que la ejecutiva pida el feedback, con los días que lleva esperando;
  - en el weekly sale como señal «bloqueo cliente» después de 5 días sin movimiento.
- **Qué entregas se miden en el % a tiempo:**
  - solo el trabajo pedido desde el 21/09/2026, cuando empezó la operación en BackIO (`INICIO_MEDICION`, según
    `fecha_pedido`; en lo importado es la fecha de creación del to-do en Basecamp);
  - lo pedido antes es historia importada: en septiembre se cerraron en bloque cientos de to-dos viejos con meses de
    atraso, y el % a tiempo no medía el trabajo actual (decisión de Luis, 29/10/2026);
  - la ficha muestra cuántas entregas se midieron de cuántas hubo.
- Con menos de 5 entregas medidas en 90 días, el % a tiempo y los reprocesos no deciden el color: son muy pocos
  datos.
- **Qué cuenta como reproceso nuestro:**
  - un reproceso marcado como del equipo;
  - o uno sin marca cuyo motivo no es del cliente.
  - Sin motivo no cuenta.
- La ficha y el dashboard muestran el porqué junto al color, por ejemplo «72 % a tiempo · 1 tarea atrasada».
- Los umbrales están en `UMBRALES_SALUD`.

### Sugerencias de la IA

El botón «✨ Sugerir qué hacer» (`POST /clientes/:id/sugerencias`) pide de 3 a 5 acciones, cada una con el dato de
la ficha que la justifica y quién debe hacerla.
- **Qué recibe la IA:** los números de la ficha y los títulos internos de lo atrasado, lo bloqueado y las señales.
  Es una pantalla interna, como el weekly.
- **Qué no hace:**
  - no cambia nada, no escribe en Basecamp ni al cliente;
  - no aparece en el portal (ver [Capa de IA](./15-ia.md)).
- **Caché:** 6 horas mientras la ficha no cambie.
- Sin la API key configurada, el botón no aparece.
