# Operar BackIO: cuando algo falla

Esta página es para mantener BackIO andando: dónde mirar, qué corre solo y qué hacer ante cada síntoma conocido.

## Dónde mirar primero

| Lugar | Qué muestra | Cuándo |
|---|---|---|
| **Monitor externo** sobre `GET /health/profundo` | Si la base responde y la reconciliación con Basecamp corre. Avisa por su cuenta, sin depender de Supabase ni de Railway | Llega solo cuando algo se cae |
| **Admin → Servicios** | Si responden Railway, Vercel, Supabase, Basecamp, Resend, la IA y PrometIO, con latencia. Debajo, **Tareas programadas**: la última corrida de cada una y si está al día | Siempre, como primer vistazo |
| **Sentry** (org `geeksec`, proyectos `backio-backend` y `backio-frontend`) | Los errores del servidor y del navegador, sin datos de personas ni de clientes | Cuando algo «falla» y no sabes dónde |
| **Logs de Railway** (servicio `@backio/backend`) | Una línea por petición y por evento, con su nivel (`INFO`, `WARN`, `ERROR`) | Para seguir lo que pasó minuto a minuto |
| **Admin → Auditoría** | Quién hizo qué y cuándo (`audit_log`), con filtros y los eventos con error marcados | Para saber quién cambió algo o qué hizo un job |
| **Tabla `cron_runs`** (SQL editor de Supabase) | Cada corrida de cada tarea programada: ventana, inicio, fin, si salió bien y un resumen | Para el detalle de una tarea programada |

```sql
-- Últimas corridas de las tareas programadas
select job, ventana, inicio_at, fin_at, ok, left(detalle, 200) as detalle
from cron_runs order by inicio_at desc limit 30;
```

## Lo que corre solo

Todas las tareas programadas están en una tabla (`JOBS`, en `backend/src/lib/jobs.ts`) que recorre el servidor cada
minuto. Cada corrida queda en `cron_runs`. Las de hora fija se recuperan si un despliegue cae justo a su hora (tienen
2 h de margen), y ninguna corre dos veces en la misma ventana.

| Cuándo (hora de Guayaquil) | Qué hace |
|---|---|
| Cada minuto | Reintenta los correos pendientes |
| Cada 15 min | Trae la estructura de Basecamp: listas, grupos, to-dos nuevos, renombres, movimientos, responsables y eliminados |
| Cada 30 min | Reconcilia con Basecamp: aplica lo completado allá y reenvía las fechas de BackIO que quedaron desfasadas (máximo 25 por corrida) |
| Cada hora | **Vigía:** revisa que las demás hayan corrido (ver abajo) |
| Cada 6 h | Trae las horas del timesheet de Basecamp |
| Diario 03:30 | Limpia contadores viejos de límites y registros de más de 60 días |
| Diario 08:05 | Genera los fees recurrentes cuyo día llegó |
| Lunes a viernes 19:30 | Foto del día de cada mesa (evolutivo) |
| Domingo 17:55 | Foto de la semana de cada mesa (evolutivo) |
| Domingo 18:00 | Calcula las señales del weekly **de la semana que empieza el lunes** y manda por correo las que faltan atender |
| Día 1, 08:00 | Redacta el informe mensual por mesa, si la IA está configurada; operaciones lo revisa y publica |
| Día 1, 08:10 | Congela los KPIs del mes anterior (y del trimestre, si cerró) |

### El vigía

Si una tarea de hora fija no corrió en su ventana, o una periódica lleva tres intervalos sin correr, el vigía registra
un error en Sentry y manda un correo a las personas admin, con enlace a Admin → Servicios. Avisa **una sola vez por
problema**. No vuelve a avisar una corrida que terminó con errores: ese error ya quedó registrado cuando ocurrió.

### Lo que el vigía no ve

El vigía guarda su registro y encola sus correos **en la misma base de Supabase**. Si la base o su API se caen, no puede
avisar. Por eso existe además un **monitor externo** (ver abajo) que no depende de nada de BackIO.

## Monitor externo y chequeo profundo

`GET https://backiobackend-production.up.railway.app/health/profundo` responde:

| Respuesta | Significa |
|---|---|
| `200` con `"ok": true` | La base responde y la reconciliación con Basecamp corrió hace menos de 75 min |
| `503` con `"base": "caida"` | La base (o su API) no respondió en 5 s |
| `503` con `"tareas": "atrasadas"` | La base responde, pero las tareas programadas dejaron de correr (servidor trabado o caído) |
| `"base": "lenta"` | Respondió, pero tardó más de 2 s (sigue en `200`) |

No devuelve detalle interno y guarda el resultado 30 s, así que un monitor consultando cada minuto no carga la base.
`/health` solo dice que el proceso está prendido: el 27/10/2026 respondió «ok» durante las 14 horas de la caída.

**Configurarlo:** en un servicio de monitoreo externo (Better Stack o UptimeRobot, plan gratuito), crear un monitor
HTTP a esa URL cada 1 a 3 min, que alerte si la respuesta no es `200` dos veces seguidas, con aviso por correo y por SMS
o app a admin.

**Sentry:** además, una regla de alerta en el proyecto `backio-backend` que avise por correo si un mismo error aparece
más de 20 veces en 5 minutos.

## Síntomas y qué hacer

### BackIO no carga nada («Credenciales inválidas», pantallas en «Cargando…»)

Pasó el 27/10/2026, entre las 04:30 y las 18:45 UTC: la API de la base de Supabase dejó de dar conexiones
(`PGRST003 · Timed out acquiring connection from connection pool`, respuestas `504` tras 60 s). La base estaba sana y
sin consultas activas; el backend y Vercel funcionaban. «Credenciales inválidas» aparece porque el backend no puede
leer al usuario.

1. Abre `/health/profundo`. Si dice `"base": "caida"`, el problema es Supabase.
2. En Supabase, el editor de tablas puede seguir funcionando aunque la API no: no prueba que esté bien.
3. **Reinicia el proyecto:** Supabase → Project Settings → General → **Restart project**. Tarda unos minutos y no
   pierde datos. Eso lo resolvió el 27/10.
4. Si sigue igual, abre un ticket en Supabase Support con los logs de la API exportados (Logs → API, filtrando `504`).
5. Después: la reconciliación y la estructura traen solas lo que cambió en Basecamp. Las tareas de hora fija que
   perdieron su ventana corren al día siguiente (los fees recurrentes revisan «día alcanzado y mes no generado»). Lo
   que alguien intentó guardar en BackIO durante la caída no quedó guardado: hay que avisar al equipo.

### Una tarea programada no corrió

1. Mira Admin → Servicios → Tareas programadas y la tabla `cron_runs`.
2. En los logs de Railway, busca `[jobs] <nombre>`. Si el servicio se reinició, el vigía y la ventana de 2 h suelen
   recuperarlo solo.
3. Para correrla a mano se usa `POST /api/cron/<ruta>` con el secreto `CRON_SECRET`. Hoy no está configurado en
   producción: el scheduler interno lo cubre.

### Un cambio hecho en Basecamp no aparece en BackIO

- Los to-dos nuevos entran en menos de un minuto por el webhook, o en 15 min por la corrida periódica.
- Si no entra:
  1. Revisa que el cliente tenga su proyecto de Basecamp y el webhook activo (Admin → Clientes).
  2. Revisa en `audit_log` la acción `basecamp_importar` de ese cliente.
  3. Revisa si el to-do fue ignorado como huérfano: los ignorados no vuelven a importarse.
  4. Si falta una lista entera, revisa que no esté completada en Basecamp (las completadas no se recorren) y que esté
     en el proyecto de Basecamp del cliente, no en otro.

### Una fecha cambiada en BackIO no llegó a Basecamp

- También baja la fecha que se pone en BackIO a una tarea que llegó de Basecamp sin fecha. No cuenta como reprogramación, pero se envía igual, a nombre de quien la puso (desde el 28/10/2026).

- La pantalla avisa si Basecamp rechazó la fecha, y en `audit_log` queda `basecamp_due_on_error`.
- La reconciliación la reintenta cada 30 min con la cuenta de quien la cambió y deja `basecamp_fecha_reenviada`. Si
  esa persona no conectó su Basecamp, no se reenvía: que la conecte en «Mi Basecamp».
- Si alguien cambió la fecha en Basecamp después, gana esa: queda `basecamp_fecha_aceptada` y una reprogramación con
  origen «basecamp». Mientras el envío de BackIO esté fallando, no se acepta nada de Basecamp.
- Si el error es `401` (token rechazado por Basecamp), BackIO intenta renovarlo; si no puede, desconecta a esa persona
  y le pide conectar de nuevo en «Mi Basecamp». Cuando conecta, la reconciliación reenvía sus fechas pendientes.

### En Basecamp desaparecieron los asignados de un to-do

Es el incidente del 22/09 ([Basecamp](./04-basecamp.md)): una actualización parcial de un to-do borra los asignados. El
código actual siempre reenvía responsables y descripción (`BasecampClient.updateTodo`). Si vuelve a pasar, para
reparar está Admin → Mantenimiento → «Responsables perdidos en Basecamp»: «Revisar» lista los to-dos abiertos que
quedaron sin responsables y «Aplicar» les reenvía los de BackIO, hasta 50 por vez.

### Basecamp aparece desconectado

En Admin → Integraciones, pulsa «Conectar Basecamp» con una cuenta que tenga acceso a todos los proyectos. Las
credenciales se guardan en una tabla que solo lee el servidor.

### Rotar el secreto del webhook de Basecamp

1. Cambia `BASECAMP_WEBHOOK_SECRET` en Railway y espera el redespliegue.
2. En Admin → Clientes, pulsa «Actualizar webhooks (rotar secreto)». Esto reescribe la URL en Basecamp para todos los
   clientes activos.

### No llegan los correos

1. Admin → Servicios: Resend debe estar operativo y con remitente.
2. Los correos que fallan quedan pendientes y se reintentan cada minuto.
3. Si una persona dice que no le llegó, revisa que su correo en Admin → Usuarios sea el actual: los correos se mandan
   siempre al correo vigente de la persona.

### La IA da error

El mensaje llega tal cual a la pantalla. Si dice que la clave no es válida o el modelo no está disponible, revisa
`ANTHROPIC_API_KEY` en Railway. Sin clave, las funciones de IA se ocultan y el resto de BackIO funciona igual.

### Una persona no ve algo que debería ver

1. Su **rol** (Admin → Usuarios): el colaborador solo ve y edita lo suyo.
2. Si entra por un agente (token OAuth), los **scopes** que concedió.
3. La política RLS de la tabla, en el [modelo de datos](./01-modelo-datos.md).

### Un cliente no puede entrar a su portal

- Si escribió mal el PIN varias veces, queda bloqueado 15 minutos (8 intentos por enlace y red, o 30 por enlace) y la
  pantalla se lo dice.
- Si el enlace dice «no disponible»: el portal del proyecto puede estar desactivado o el enlace pudo regenerarse
  (Proyecto → controles del portal).

### El frontend no se actualizó después de un cambio

- Se despliega solo cuando el CI de `main` termina en verde (`.github/workflows/deploy-frontend.yml`).
- Mira la pestaña Actions del repositorio. Si el CI falló, no hay despliegue.
- Si falta el secreto `VERCEL_TOKEN`, el job lo avisa.

## Tareas de rutina

### Aplicar una migración

Las migraciones son archivos SQL numerados en `backend/supabase/migrations/`. Las que tocan seguridad (RLS) las revisa
Luis antes de aplicarlas.

1. Se aplica en el **SQL editor de Supabase**, copiando el archivo completo.
2. Se corre la consulta de verificación que trae el propio archivo al final.
3. Se refresca la API: `notify pgrst, 'reload schema';`
4. Se regeneran los tipos del backend y se suben:

```bash
pnpm --filter @backio/backend db:types
```

### Dar de alta o quitar a una persona

- **Alta:** Admin → Usuarios → invitar. Le llega un correo para definir su contraseña. La cuenta se crea recién cuando
  confirma. Después, la persona conecta su Basecamp una vez («Conectar mi Basecamp», arriba en la pantalla o en Mi
  Basecamp): sin eso, BackIO no escribe en Basecamp por ella. Ver [Basecamp](./04-basecamp.md#autenticacion).
- **Baja:** Admin → Usuarios → «Registrar salida». La pantalla muestra todo lo que la persona tiene abierto (tareas
  por cliente, proyectos, mesas, acuerdos y recurrencias) con un destino propuesto. Al confirmar, en una sola
  operación reparte todo eso, revoca sus API keys y tokens de agentes y la desactiva; después bloquea su login y
  cambia al responsable en Basecamp. Si la transacción falla, no cambia nada. Detalle en
  [Cuando alguien se va](./20-salida.md).

### Crear una API key para una integración

Admin → API keys. La clave completa se muestra **una sola vez**. Elige el perfil con lo mínimo necesario; el perfil
«cliente» queda atado a un solo cliente. Ver [API y agentes](./07-api-mcp.md).

### Actualizar la referencia de la API

La [referencia de la API](./referencia-api.md) se genera desde el código. Si cambias una ruta pública:

```bash
pnpm --filter @backio/backend docs:api
```

## Variables de entorno

Todas están en `backend/.env.example` (Railway) y `frontend/.env.example` (Vercel), con un comentario sobre qué hace
cada una y cuáles son opcionales. Las variables del frontend que empiezan con `NEXT_PUBLIC_` se fijan al compilar: después
de cambiarlas hay que volver a desplegar el frontend.
