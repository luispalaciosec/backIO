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

### Respuesta del cliente

El aviso «espera feedback del cliente» muestra los días reales que cada tarea lleva esperando, contados desde que pasó
a «pendiente del cliente», y un botón para redactar el recordatorio. El indicador de atrasadas muestra cuánto tarda
el cliente en responder: la mediana de 90 días. Ver [Mi día y avisos](./22-avisos.md#cuanto-tarda-el-cliente-en-responder-30-10-2026).

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

### Informe para el cliente

Desde el 30/10/2026, la ejecutiva genera en la ficha un borrador de correo con el informe semanal (últimos 7 días) o
mensual (el mes que elija), lo edita y **lo envía desde su correo**. BackIO no le escribe al cliente y el informe no se
publica en el portal, que sigue igual ([Portal del cliente](./06-portal-cliente.md)).

**Qué recibe la IA.** Por cada proyecto con algo que contar:
- el nombre del proyecto, que es el de la lista de Basecamp y el cliente ya ve en el portal;
- cuántas tareas se entregaron en el periodo (con la fecha real de entrega, ver [Mi día](./22-avisos.md)), cuántas
  vencen en las dos semanas siguientes y cuántas esperan al cliente, con los días de la más antigua;
- el nombre y la fecha **solo de lo visible para el cliente**, tal como sale de `sanitizeForClient`.

El payload pasa por `assertClientSafe` antes de salir, igual que el resumen del portal. La IA nunca recibe títulos
internos, responsables, horas ni comentarios.

**Por qué números.** Casi nada es visible para el cliente: al 30/10/2026 eran 15 de 2.643 tareas, porque lo importado
de Basecamp entra oculto y la [regla 2](./02-visibilidad.md) no deja abrirlo. Un informe solo con lo visible salía vacío.
Los números cuentan todas las tareas del proyecto. Donde no hay detalle visible, la IA deja «[completa: qué se
entregó]» o «[completa: qué viene]», y la pantalla avisa cuántos quedan antes de copiar.

**Historial.** Cada informe queda en `informes_cliente` (migración 40) con el periodo, los datos que recibió la IA,
quién lo generó y quién lo editó. Lo ven y lo editan los roles de gestión; un colaborador no. Rutas:
`GET /clientes/:id/informes`, `POST /clientes/:id/informes` y `PATCH /clientes/:id/informes/:informeId`. El código
está en `backend/src/lib/clientes/informe.ts`.

## Rentabilidad (`/rentabilidad`)

Desde el 30/10/2026, gerencia y admin ven cuánto deja cada cliente al mes. Nadie más: ni otros roles, ni agentes, ni
API keys. Lo exigen la RLS de las tablas (migración 41, función `auth_es_gerencia_o_admin`) y cada ruta
(`esGerenciaOAdmin`). Los montos no se escriben en esta documentación ni en la auditoría.

**Qué se carga** (en `/rentabilidad/costos`):
- el sueldo mensual de cada persona (`costos_personal`);
- el fee mensual de cada cliente (`fees_cliente`).

Cada cambio es una fila nueva con su fecha «desde»: vale el último que no pase del fin del mes, y queda la historia.

**Cómo se calcula el margen de un cliente en un mes:**
- **Costo:** el sueldo de cada persona se reparte entre sus clientes según las horas que registró en cada uno ese mes
  (timesheet de Basecamp).
- **Margen:** fee del cliente menos su costo.

No se usa horas × costo por hora: el timesheet recoge unas 13 de las 40 horas semanales, y así quedaban fuera dos
tercios de los sueldos.

**Lo que el cálculo muestra aparte:**
- sueldos de personas sin horas en el mes, que no se pueden repartir;
- personas con horas pero sin sueldo cargado;
- horas sin persona o sin cliente;
- clientes con costo pero sin fee.

Quien salió antes del mes ya no cuesta. Los clientes de prueba no cuentan.

**Dónde se ve:** `/rentabilidad` (mes por cliente) y la sección «Rentabilidad» de la ficha (últimos 6 meses), solo
para esos roles. Rutas: `GET /rentabilidad`, `GET /rentabilidad/clientes/:id`, `GET /costos`,
`PUT /costos/sueldos` y `PUT /costos/fees`. El cálculo está en `backend/src/lib/rentabilidad.ts`.
