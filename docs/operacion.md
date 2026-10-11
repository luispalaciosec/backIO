# Operar BackIO: cuando algo falla

Esta página es para mantener BackIO andando: dónde mirar, qué corre solo y qué hacer ante cada síntoma conocido.

## Dónde mirar primero

| Lugar | Qué muestra | Cuándo |
|---|---|---|
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
| Domingo 18:00 | Calcula las señales del weekly y manda la agenda por correo |
| Día 1, 08:00 | Redacta el informe mensual por mesa, si la IA está configurada; operaciones lo revisa y publica |
| Día 1, 08:10 | Congela los KPIs del mes anterior (y del trimestre, si cerró) |

### El vigía

Si una tarea de hora fija no corrió en su ventana, o una periódica lleva tres intervalos sin correr, el vigía registra
un error en Sentry y manda un correo a las personas admin, con enlace a Admin → Servicios. Avisa **una sola vez por
problema**. No vuelve a avisar una corrida que terminó con errores: ese error ya quedó registrado cuando ocurrió.

## Síntomas y qué hacer

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

### Una fecha cambiada en BackIO no llegó a Basecamp

- La pantalla avisa si Basecamp rechazó la fecha, y en `audit_log` queda `basecamp_due_on_error`.
- La reconciliación la reintenta cada 30 min y deja `basecamp_fecha_reenviada`.

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
  confirma.
- **Baja:** Admin → Usuarios → «Quitar acceso». En una sola operación revoca sus API keys y tokens de agentes, la
  desactiva y reasigna sus tareas abiertas (y sus fees) a quien elijas. Después bloquea su login. Si algo falla, no
  cambia nada y la pantalla muestra el error.

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
