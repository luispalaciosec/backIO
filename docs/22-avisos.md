# Mi día y avisos

## «¿Ya se entregó?» (30/10/2026)

Una tarea que pasó su fecha y no se movió suele estar entregada y sin cerrar en Basecamp. Antes BackIO la contaba como
atrasada hasta que alguien la cerraba, y en ese momento quedaba como entregada tarde. «Cronograma octubre», por
ejemplo, figuraba con 35 días de atraso. Ahora se le pregunta a su responsable.

**A quién se le pregunta:** al responsable de una tarea abierta que cumple las cuatro condiciones de `debePreguntarse`
(`backend/src/lib/entregas.ts`):
- pasó su fecha de entrega;
- lleva 2 o más días sin movimiento;
- no espera al cliente;
- su responsable todavía no declaró la entrega.

Las preguntas están en **Mi día** (`/mi-dia`, primera opción del menú). Cada tarea se responde en un clic, con
`POST /requerimientos/:id/entrega`:

| Respuesta | Qué hace |
|---|---|
| **Sí, ya se entregó** | Pide el día de la entrega y lo guarda en `entregado_el` (migración 38). Ese día no puede ser futuro ni anterior al pedido. Además **cierra el to-do en Basecamp con la cuenta de quien responde**; la tarea pasa a completada cuando Basecamp lo confirma (regla 3). Sin Basecamp conectado no se guarda nada y se pide conectarlo. Si la tarea no tiene to-do, se completa en BackIO |
| **Todavía no** | Pide la nueva fecha y el motivo, como cualquier reprogramación |
| **Espera al cliente** | Pasa la aprobación a «pendiente del cliente», así deja de contar como atraso del equipo, y avisa a la ejecutiva de la cuenta |

- Responde quien tiene la tarea o alguien de gestión. Cada respuesta queda en la auditoría.
- **Para medir «a tiempo» manda la fecha declarada** (`entregaReal` en `shared/src/metricas.ts`). La usan
  cumplimiento, KPIs, marcador, evolutivo, dashboard y ficha. Una tarea entregada a tiempo y cerrada días después ya
  no cuenta como tarde.
- Si la tarea se reabre (reproceso o desmarcada en Basecamp), la entrega declarada se borra (migración 39).

## Cuánto tarda el cliente en responder (30/10/2026)

La espera del cliente se mide desde que una tarea pasa a «pendiente del cliente» hasta que sale de ese estado. El dato
sale de `aprobacion_eventos` (migración 22) con `tramosEsperaCliente`. Antes se contaba desde el último movimiento de
la tarea, y cualquier cambio reiniciaba la cuenta.

Se usa en tres lugares:
- **Ficha del cliente:**
  - días reales que lleva esperando cada tarea;
  - el botón ✨ para redactar el recordatorio;
  - la mediana de días de respuesta del cliente en 90 días.
- **Señal «bloqueo cliente» del weekly:** sale después de 5 días de espera real.
- **Informe mensual:** columna «Respuesta cliente (días)», con la mediana de las respuestas del mes.

El portal del cliente no cambia (ver [Portal](./06-portal-cliente.md)): la ejecutiva pide el feedback por su canal.

## «Mi día» por correo (desde el 2/11/2026)

De lunes a viernes a las 07:45 cada persona con tareas recibe un correo con lo suyo:
- lo que trabaja hoy (lo elegido en el daily);
- lo que vence hoy o mañana;
- lo atrasado;
- cuántas tareas tiene por confirmar en «¿ya se entregó?»;
- lo bloqueado y lo que espera al cliente;
- **si es ejecutiva de alguna cuenta**, «Tus cuentas»: lo atrasado de sus clientes y lo que espera respuesta del
  cliente, sea de quien sea la tarea, con los días que lleva esperando (desde el 31/10/2026; antes una ejecutiva solo
  veía las tareas donde era responsable).

Después de responder «¿ya se entregó?», la página se vuelve a cargar entera. Si al elegir «Todavía no» el motivo es
«Insumos o aprobación del cliente», Mi día sugiere marcar «Espera al cliente», que saca la tarea del atraso del equipo y
mide la espera del cliente.

El correo trae solo un resumen. Los botones que cambian algo están en la página **Mi día** (`/mi-dia`), que muestra lo
mismo en vivo. Quien no tiene nada pendiente no recibe correo.

Desde el 4/11/2026 el correo va por bloques, con hasta 5 tareas cada uno, el cliente y los días de atraso, y dice qué
hacer primero. Cada tarea sale una sola vez: una atrasada que hay que confirmar va en «¿Ya se entregaron?» y no se repite
en «Atrasadas». La agenda del weekly, el riesgo de la semana, la cotización ganada, el cambio de color de un cliente y la tarea que espera al cliente usan el mismo formato. Los demás
avisos usan la misma plantilla con su texto, y cada correo trae un botón que dice qué se va a hacer. Los asuntos ya no
llevan «[BackIO]», porque el remitente ya lo dice.

Cada persona puede desactivar el correo desde Mi día (`usuarios.avisos_mi_dia`, migración 38). Aun así el resumen le
llega a la campana. La tarea programada es `mi_dia` (`backend/src/lib/jobs.ts`); el resumen lo arma
`backend/src/lib/mi_dia.ts`.

## Campana de avisos (30/10/2026)

Arriba a la derecha de cada pantalla está la campana. Muestra los avisos de los últimos 30 días: lo mismo que llega por
correo, más lo que se recibe solo en la campana. Un número marca los no leídos.

- Al abrir un aviso se marca como leído; también se pueden marcar todos.
- Lo creado antes de que existiera la campana (30/10/2026, 06:45 UTC) ya llegó por correo y se muestra como leído.
- **Cotización ganada (PrometIO):** el aviso va a la ejecutiva de la cuenta y a operaciones; solo si la cuenta no tiene
  ejecutiva va a todas. El monto sale redondeado («USD 3.500,00»).
- **Rutas:** `GET /notificaciones`, `POST /notificaciones/:id/leida` y `POST /notificaciones/leidas`. Cada persona ve
  solo los suyos (RLS de `notificaciones`).

## Aviso cuando cambia la salud de un cliente (30/10/2026)

De lunes a viernes a las 07:30, la tarea `salud_clientes` guarda el color de cada cliente en `cliente_salud`
(migración 38). Es el mismo color de la ficha y del dashboard.

- **Aviso:** si el color cambió respecto del último registrado, avisa a la ejecutiva de la cuenta y al líder de su mesa.
  - Si empeora, el aviso dice por qué. Ejemplo: «Foligain pasó de verde a amarillo · Por qué: 2 tareas atrasadas».
  - Si mejora, también avisa.
- **Primer día:** la primera foto solo sirve de base y no avisa.
- **En la ficha:** el cliente muestra la tira de colores de sus últimos 30 días.
