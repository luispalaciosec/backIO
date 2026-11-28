# Reuniones y visitas

Las ejecutivas y parte del equipo operativo pasan horas en reuniones y visitas al cliente. Ese tiempo es trabajo: BackIO lo
toma de los calendarios para que cuente en la capacidad, en las horas de cada persona y en la rentabilidad de cada cliente.
Plan aprobado por gerencia el 27/11/2026.

## De dónde salen

| Fuente | Estado | Cómo se asigna el cliente |
|---|---|---|
| Eventos del **schedule de Basecamp** de cada proyecto | Desde el 27/11/2026 | El del proyecto donde está el evento |
| **Google Calendar** de cada persona, que cada quien conecta en «Mi Google Calendar» | Desde el 28/11/2026 | El cliente cuyo dominio de correo coincide con el de algún invitado; si ninguno, la reunión es interna |

La tarea programada `reuniones` corre cada 2 horas. Trae desde 45 días atrás hasta 14 días adelante, porque las reuniones
que vienen también quitan capacidad. Un evento que se repite da una reunión por cada día que le toca. Lo que desaparece de la
fuente se marca cancelado; no se borra.

## Google Calendar

Cada persona lo conecta una vez desde **Mi Calendar** (abajo en el menú). BackIO solo acepta la cuenta de Google con el mismo
correo de la persona en BackIO, y pide solo lectura de eventos. Si el permiso deja de servir (se revocó o cambió la
contraseña), la conexión se borra y la persona ve «Volver a conectar».

**Cliente de cada reunión:** en Admin → Clientes, cada cliente tiene sus **dominios de correo** (por ejemplo, `empresa.com`).
Una reunión con alguien de ese dominio cuenta para ese cliente; sin coincidencia, es interna. Las reuniones que la persona
rechazó no cuentan.

**Configuración (una vez, administración técnica):** proyecto en Google Cloud con la API de Calendar, pantalla de
consentimiento **Interna**, permisos `openid`, `email` y `calendar.events.readonly`, y un cliente OAuth web con la URI de
redirección `https://<backend>/api/google/oauth/callback`. En el servidor: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y
`GOOGLE_REDIRECT_URI`. Los tokens de cada persona quedan en `google_credenciales_usuario` (migración 55), sin acceso desde
la sesión de nadie.

## Qué cuenta

- Todo evento con hora de inicio y fin. Los de todo el día no tienen duración y no cuentan.
- Por persona y día se suma la **unión** de los horarios: si dos reuniones se pisan, o la misma está en Basecamp y en Google,
  cuenta una vez.
- En Basecamp, cuenta para cada participante que tiene usuario en BackIO.

## Dónde se usan (fase 3, desde el 28/11/2026)

**Capacidad.** Las horas para tareas de un día son el ritmo diario de la persona (la quinta parte de su semana fuerte en el
timesheet), salvo que sus reuniones de ese día no le dejen tanto de su jornada declarada:

> disponible del día = mín(ritmo semanal ÷ 5, jornada semanal declarada ÷ 5 − reuniones del día)

Con el ritmo de unas 13 h semanales y una jornada de 40 h, las reuniones solo restan cuando pasan de unas 5,4 h en el día:
el timesheet ya no recoge el tiempo de reuniones, así que el ritmo ya lo descuenta en una semana normal. Se aplica en
**Armar el día** (la carga de cada persona dice cuántas horas de reunión tiene hoy) y en el **riesgo de la semana** (suma
cada día hábil que queda con sus reuniones, también las agendadas).

**Rentabilidad** (docs/21). Las reuniones con un cliente son trabajo para ese cliente:
- A quien registra horas, se le suman a las del timesheet y su sueldo se reparte con ambas.
- A la ejecutiva, la parte de su jornada del mes (jornada semanal × 52 ÷ 12) que pasó en reuniones con clientes va a esos
  clientes por horas; el resto sigue repartido entre sus cuentas por el fee.
- Las internas no van a ningún cliente. Las de quien no registra horas ni lleva cuentas tampoco: su sueldo sigue sin
  repartir.

**Personas y dashboard.** Muestran aparte las horas en tareas (timesheet) y las horas en reuniones, por persona, por día y
por cliente. Las de clientes de prueba no cuentan.

**Weekly.** En la vista «Reunión», debajo de la capacidad, las reuniones y visitas de la semana por cliente y con quién
(`GET /semanas/:id/reuniones?mesa=`). En «Mis cuentas», solo las de sus clientes.

## Qué no entra (regla 1)

De un evento solo entran el horario, los participantes, la repetición y, de Google, los **dominios** de los invitados
externos. Nunca el título, la descripción, las notas ni los correos: se descartan en el mismo cliente que lee la fuente
(`scheduleEntriesSafe` en `lib/basecamp/client.ts`).

## Límites conocidos

- Un bloque de trabajo en el calendario cuenta como reunión. Si además se registran horas de esa tarea en el timesheet, ese
  tiempo cuenta dos veces: el timesheet no tiene hora del día y no se puede cruzar.
- Los eventos de Basecamp son del proyecto (el cliente), no de una lista: en el weekly las horas de reunión se ven por
  cliente.
- La misma reunión en Basecamp y en Google con clientes distintos (o una con cliente y la otra interna) cuenta una vez para
  la persona, pero en la rentabilidad puede aparecer en los dos clientes.

Código: `backend/src/lib/reuniones.ts`, `backend/src/lib/db/reuniones.ts`, `backend/src/lib/google/` (`eventosGoogleSafe` descarta todo texto); tabla `reuniones` y `clientes.dominios_correo`
(migración 53).
