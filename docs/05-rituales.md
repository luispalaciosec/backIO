# 05 · Rituales: Weekly, Daily y motor de señales

> Revisado contra el código el 11/10/2026.

## Diagnóstico del proceso actual

Hoy en Geeks:

1. **Lunes** — alguien escribe a mano el Plan Operativo Semanal (21 tareas con responsable,
   prioridad y fecha) en un Doc de Basecamp.
2. **Durante la semana** — alguien mantiene a mano el Card Table "Backlog Priorizado".
3. **Viernes** — alguien escribe a mano el Acta de Cierre con **las mismas 21 tareas** más
   su estado final.

Los tres artefactos son **la misma data en tres formatos**, digitada tres veces.

Si BackIO tiene los requerimientos con fecha, owner, estado y peso, los tres se generan.

| Artefacto | Hoy | Con BackIO |
|---|---|---|
| Plan Operativo | Manual, lunes | `select * where fecha_entrega ∈ semana` |
| Acta de Cierre | Manual, viernes | Mismo filtro + estado al viernes |
| Backlog Priorizado | Card Table manual | Es la tabla `requerimientos` |

Ahorro estimado: 2-3 horas semanales de Operaciones.

---

## Motor de señales

**Principio: las reglas deciden, la IA solo redacta.** No se le pide a un modelo que
"sugiera temas". Se disparan condiciones deterministas y la IA las ordena y narra.

### Señales del Weekly

Se calculan el domingo a las 18:00 y se persisten en `senales`. Hay 11 reglas, todas en
`backend/src/lib/rituals/signals.ts`.

| Tipo | Condición | Severidad | Tema que entra a agenda |
|---|---|---|---|
| `arrastre_reincidente` | `veces_reprogramado >= 2` | Crítica | "Decidir: se hace, se reasigna o se mata" |
| `reproceso_reincidente` | `veces_reproceso >= 2` | Crítica | "Revisar brief y control de calidad antes de enviar" (ver `16-cumplimiento.md`) |
| `reprogramacion_sin_motivo` | reprogramación sin causa en 45 días | Media | "Completar la causa de la reprogramación" |
| `reproceso_sin_motivo` | reproceso sin causa en 45 días | Media | "Completar la causa del reproceso" |
| `tareas_sin_responsable` | tareas activas sin responsable con entrega esta semana o vencida, agrupadas por cliente (pasa sobre todo cuando alguien se va; ver [Cuando alguien se va](./20-salida.md)) | Alta | "Asignar responsable" |
| `concentracion_carga` | Un owner con >30% de las tareas de la semana (solo si la semana tiene al menos 3 tareas) | Crítica | "Redistribución de carga — riesgo de punto único" |
| `bloqueo_cliente` | `estado_aprobacion = 'pendiente_cliente'` y `dias_sin_movimiento > 5` | Alta | "Escalamiento a ejecutiva de cuenta" |
| `cuenta_silenciosa` | Cliente sin requerimientos completados en 14 días | Alta | "Revisión de estado de cuenta" |
| `compromiso_vencido` | `acuerdos.fecha_compromiso < hoy` y estado pendiente | Crítica | "Rendición de cuentas" |
| `sobrecarga_proyectada` | Las horas estimadas de lo que le queda a una persona esta semana superan las que tiene disponibles (ver [Riesgo de la semana](#riesgo-de-la-semana)) | Alta | "Recortar alcance de la semana" |
| `sin_movimiento` | `dias_sin_movimiento > 14` en requerimiento activo que no está en `pendiente_cliente` | Media | "Requerimiento huérfano" |
| `atraso_critico` | `dias_atraso > 30` | Crítica | "Atraso material — decisión de cuenta" |

### Implementación

Cada regla de `signals.ts` declara su `tipo`, su `severidad`, el `tema_agenda` que la acompaña y una
función `detectar(ctx, umbrales)`. Esa función es síncrona: recibe un contexto ya cargado (tareas activas,
completadas recientes, personas, clientes, acuerdos abiertos y reprogramaciones o reprocesos sin causa) y
devuelve las señales con su título ya armado. `calcularSenales` corre todas las reglas y las ordena por
severidad. La carga de datos y el guardado en `senales` están en `backend/src/lib/rituals/service.ts`
(`recalcularSenales`).

Los umbrales viven en `tenants.config.signal_thresholds` y se pueden cambiar sin deploy. Los valores por
defecto están en `UMBRALES_DEFAULT`. Las horas de `sobrecarga_proyectada` salen del timesheet (`lib/carga.ts`); sin
timesheet, la regla vuelve a asumir 4 h por tarea contra la capacidad declarada.

### Ejemplo real: semana del 03/08/2026

Aplicando el motor a los datos históricos de Geeks, la agenda del weekly del 10/08 habría
sido:

| Señal | Detalle |
|---|---|
| `concentracion_carga` | **Elías en 9 de 21 tareas (43%)** — señal más fuerte de la semana |
| `arrastre_reincidente` | 7 pendientes trasladados con fecha "Próxima Weekly" |
| `bloqueo_cliente` | 5 dependencias "Alto" sin responsable ni acción definida |
| `compromiso_vencido` | Foligain: investigación comercial no entregada |
| `cuenta_silenciosa` | Torres & Torres retrasado sin fecha definitiva |

Ninguna de estas fue tema explícito de agenda en el acta real. Todas estaban en la data.

---

## Weekly Operativo (lunes)

**Agenda generada automáticamente** el domingo a las 18:00. La tarea programada `senales`
(`backend/src/lib/jobs.ts`) recalcula las señales y avisa a las personas con rol `operaciones` y `admin`
con las 15 primeras señales y su tema de agenda.

Estructura:
1. Compromisos vencidos de la semana anterior (señales `compromiso_vencido`)
2. Señales críticas ordenadas por severidad
3. Capacidad y riesgo de la semana (calculada, no declarada)
4. Backlog candidato a priorizar
5. Riesgos y dependencias

**Captura durante la sesión: tres campos.** Acuerdo, responsable, fecha. Nada más — todo lo
demás lo tiene el sistema.

### La validación de fecha

En las actas actuales, 7 pendientes tienen fecha "Próxima Weekly". Eso no es una fecha; es
un aplazamiento con nombre de compromiso.

**BackIO no ofrece esa opción.** Date picker obligatorio. Si el responsable no sabe la
fecha, el acuerdo no se guarda. La fricción es intencional: obliga a la conversación que
hoy se evita.

---

## Daily (15 min)

Propósito distinto: **el daily no prioriza, desbloquea.**

Solo tres señales:

| Señal | Condición |
|---|---|
| Vence hoy o mañana sin iniciar | `fecha_entrega <= mañana` y `estado = 'priorizado'` |
| Bloqueo nuevo | está `bloqueado` y pasó a ese estado en las últimas 24 h (según la auditoría; si no hay registro del paso, cuenta su último movimiento) |
| Fecha cambiada | su `fecha_entrega` cambió en las últimas 24 h (tabla `reprogramaciones`, que incluye los cambios hechos en Basecamp) |

**Ejecutiva de otra mesa (29/10/2026).** El daily es de la mesa que produce. Si la ejecutiva de una cuenta lidera otra
mesa (Grace con Torres & Torres, que produce Omega), entra solo al bloque de su cuenta cuando algo vence o está
bloqueado, y el mensaje publicado la menciona en esas tareas («Cuenta: @Grace»). Para seguir sus cuentas de todas las
mesas usa «Mis cuentas» en el paso 1, que es solo de lectura. En el weekly, cada grupo de señales de un cliente
muestra a su ejecutiva y se puede filtrar por «Cuentas de…». Ver [Clientes](./21-clientes.md).

**Una sola regla (29/10/2026).** El tablero, el mensaje publicado y el borrador de la IA salen de la misma función,
`seccionesDaily` (`backend/src/lib/rituals/daily.ts`). Antes cada uno tenía la suya: el tablero no veía las fechas
cambiadas en Basecamp, el mensaje mostraba como «fecha cambiada» cualquier movimiento de una tarea reprogramada
alguna vez, y un bloqueo viejo salía como nuevo cuando alguien tocaba la tarea.

Si el daily muestra más que eso, se convierte en un weekly y muere en tres semanas. Los
rituales no fallan por falta de contenido, fallan por exceso.

Vista dedicada: `/daily`, armada como un flujo de cuatro pasos por mesa.

**Construcción secuencial por mesa (22/09/2026).** El daily es de una mesa, no de la agencia:

1. **Mesa.** Se elige primero (queda en la URL `?mesa=` y el navegador recuerda la última). Nada
   se muestra hasta elegirla; existe la opción «toda la agencia» solo para gerencia.
2. **Hoy.** «Elegir tareas de hoy» lista únicamente las tareas activas de la mesa
   (`GET /requerimientos?mesa=`), y marca `daily_fecha`. Se puede filtrar por cliente y por proyecto, el buscador
   encuentra por título, cliente, proyecto o responsable, y cada tarea muestra a sus responsables (28/10/2026).
3. **Tablero.** Las cuatro columnas salen de `GET /semanas/daily?mesa=`, acotadas a los clientes
   y proyectos de la mesa (`alcanceMesa`).
4. **Publicar.** Notas, borrador con IA y apertura/cierre van al board Daily de esa misma mesa.
   Cambiar la mesa rearma los cuatro pasos.

**Regla: ninguna tarea entra al daily sin responsable (22/09/2026).** Marcar `daily_fecha` en una
tarea sin `owner_agencia` devuelve 422 (backlog ☀ y modal «Elegir tareas de hoy»); el tablero muestra
una alerta con las tareas sin responsable de las cuatro columnas y la publicación (y el borrador con IA)
se bloquea con `DailySinResponsable` hasta que se asigne a alguien.

**Mensaje publicado (22/09/2026).** Dentro de «🎯 Hoy se trabaja» va primero el bloque *Por persona*
(persona → board → tareas, una tarea con varios responsables aparece bajo cada uno; lista anidada porque
Basecamp no admite tablas) y después la lista *Por tarea* de siempre. El resto del mensaje no cambia.

**Títulos fijos de las secciones (11/10/2026).** Cuando se usa el borrador con IA, los títulos de cada sección
los pone el código, no la IA. Están en `SECCIONES_DAILY` (`backend/src/lib/ia/daily.ts`): la apertura lleva
«🎯 Foco del día», «📋 En la mesa hoy», «⏰ Vence hoy o mañana», «⛔ Bloqueos» y «📅 Cambios de fecha»; el
cierre lleva «🎯 Balance del día», «✅ Completado hoy», «➕ Completadas fuera del daily», «⏳ Quedó abierto»,
«⛔ Bloqueos» y «➡️ Para mañana». La IA solo escribe el contenido y marca dónde empieza cada sección con
`[[clave]]`; `armarDaily` pone los títulos en el orden de siempre y omite las secciones vacías. Si la IA no usa
ninguna marca, se publica su texto tal cual. Luis decidió el 11/10/2026 mantener los emojis en los títulos,
porque son el formato que el equipo ya usa en Basecamp.

**Cierre (22/09/2026).** Antes de lo que quedó abierto, el cierre lleva «✅ Completado hoy» (completadas con
`completado_at` desde las 00:00 de Guayaquil que estaban en el daily, por persona → board → tarea) y
«➕ Completadas fuera del daily» (completadas hoy sin `daily_fecha`). «Hoy se trabaja» pasa a llamarse
«Quedó abierto de lo de hoy». El borrador de IA sigue esa misma estructura.

**Métricas del cierre (22/09/2026).** Bloque «📊 Métricas del día» antes de lo completado: cumplimiento del plan
(cerradas / planificadas con `daily_fecha = hoy`, % en color), cerradas fuera del daily y total, nuevas de hoy
fuera de planificación (no planificadas + urgentes), reprocesos abiertos hoy, reprogramaciones 24 h, bloqueos
nuevos, vencidas que siguen abiertas, y detalle por persona (cerradas / planificadas · % · fuera del daily).
La IA recibe `kpis` para el balance del día. Desde el 29/10/2026 estos indicadores son los mismos que guarda la foto
del evolutivo (`fotoDeDia`): antes se calculaban aparte y el cierre publicado no coincidía con el evolutivo.

**Una publicación por mesa, día y tipo (29/10/2026).** Si la apertura (o el cierre) de la mesa ya salió hoy,
`POST /semanas/daily/publicar` responde 409 con la hora de la anterior, y la pantalla pregunta antes de publicarla
otra vez (`repetir: true`). Dos clics simultáneos, dos pestañas o un reintento ya no la duplican: las llamadas de la
misma mesa y tipo se atienden de una en una. El encabezado del mensaje lleva la hora real de la publicación (antes decía siempre
«9H00 AM» o «6H00 PM») y las @menciones marcan solo el nombre completo («Ana» ya no se marca dentro de «Mariana»).

---

## Generación de documentos

El Plan Operativo y el Acta de Cierre se generan a pedido, no por calendario. Alguien los dispara desde la
pantalla del weekly, que llama a `POST /semanas/:id/plan` y `POST /semanas/:id/acta`. Ambas rutas aceptan
`?mesa=` para acotar el documento a una mesa, y `?ia=1` para anteponer el resumen redactado por la IA.
La mesa es la elegida en las pestañas de la pantalla. Generar otra vez reemplaza el documento de la semana, tipo y
mesa que aún no se publicó; uno ya publicado no se toca y se crea otro (29/10/2026). Los títulos de tareas, acuerdos y
señales se escapan en el markdown, así que un `|` o un `_` en un título ya no rompe la tabla ni pone cursiva.

- `backend/src/lib/rituals/service.ts` reúne los datos (`generarPlanOperativo`, `generarActaCierre`): tareas
  de la semana, capacidad, señales de riesgo, acuerdos abiertos y, en el acta, las señales y acuerdos de la
  semana. Guarda el resultado en `actas`.
- `backend/src/lib/rituals/documents.ts` solo arma el texto (`renderPlanOperativo`, `renderActaCierre`) y
  calcula la capacidad por persona.
- **Con `?mesa=`, todo es de esa mesa** (19/10/2026): tareas, números, **señales** y **acuerdos**. Las señales se
  calculan con los clientes y proyectos de la mesa (`senalesDeMesa`), respetando las que ya se marcaron como atendidas;
  los acuerdos son los acordados en el weekly de esa mesa (`acuerdos.mesa_id`, migración 35; antes se adivinaba por las tareas del responsable y quien trabajaba en dos mesas veía su acuerdo en las dos actas). Antes las señales y los acuerdos eran los
  de toda la agencia: en el cierre de Omega de la semana 42 aparecieron AB-Inbev (Orión) y Acme (prueba).
- En el acta, el **resultado** y el **arrastre** no cuentan las tareas canceladas (no pasan a la semana siguiente).
- Los **clientes de prueba** (`clientes.es_prueba`, migración 34; hoy Acme EC S.A.S, el del sandbox de Basecamp) no
  generan señales ni cuentan en actas, dashboard, personas ni KPIs. Siguen en el backlog para poder probar.

### Pantalla del weekly por mesa (21/10/2026)

- **Mesa arriba.** La pantalla del weekly se abre en una mesa (o «Toda la agencia»): señales, acuerdos y compromisos
  vencidos son los de esa mesa, y un acuerdo nuevo queda en ella.
- **Señales agrupadas por cliente** (lo que no es de un cliente va en «Equipo»), ordenadas por críticas pendientes. Los
  grupos con críticas se abren solos.
- **Botón «Atendida»** en cada señal: guarda quién y cuándo (`senales.atendida_por`, `atendida_at`, migración 35). Una
  señal atendida esta semana o la anterior sigue atendida mientras no empeore su severidad; si empeora, vuelve. Las
  atendidas se pueden ocultar y reabrir. Antes no había botón y las 457 señales generadas hasta el 20/10 seguían todas
  pendientes.
- La atención vale **14 días desde que se marcó** (`atendida_at`) y se mantiene mientras la señal no empeore; reabrirla
  la reabre en todas las semanas (revisión del 28/10/2026: antes no vencía nunca y «Reabrir» no se mantenía).
- **Arrastre y capacidad son de la mesa elegida** (antes salían de toda la agencia). El arrastre dice el total real y
  muestra los 15 más reprogramados.
- Las señales del domingo se guardan en la semana que empieza el lunes, y el correo trae solo las que faltan atender.

### Marcador (20/10/2026)

Arriba de los documentos de una mesa va un **marcador**, para que el weekly se sienta como avance de equipo sin perder
seriedad (decisión de Luis). Todo sale de los datos: nada se escribe a mano, no lleva emojis ni frases de juego, y
nunca se nombra a quien no cumplió. Código: `backend/src/lib/rituals/marcador.ts`.

| Pieza | Cómo se calcula |
|---|---|
| Semana de cada tarea | La de su **fecha comprometida**: la original, salvo que el cliente la haya movido (motivo atribuible al cliente: insumos o aprobación, cambio de alcance); entonces, la última fecha que fijó un cambio del cliente. Reprogramar por causa del equipo, neutra o sin motivo no saca la tarea de su semana: sigue contando ahí como no cumplida (decisión de Luis, 21/10/2026). Completar el motivo de una reprogramación del cliente la pasa a la semana nueva |
| Resultado | Tareas comprometidas para la semana completadas **dentro de la semana** (hasta el domingo) sobre las vigentes; las canceladas no cuentan. Cerrar tarde no la mejora, y lo que se completó después del domingo se dice aparte («1 se completó después del domingo»), para que cuadre con el arrastre. Una completada sin fecha de cierre (históricas) cuenta como completada. Si el acta se genera antes del domingo, lo que se cierre el fin de semana todavía sube el número que muestre el plan siguiente |
| Meta | 80 % para todas las mesas (`META_SEMANAL`) |
| Compromiso (plan) | Tareas con entrega en la semana y cuántas ya están completadas |
| Racha | Semanas seguidas en la meta o por encima, contando hacia atrás (hasta 16 semanas); una semana sin tareas no corta ni suma. La «mejor racha del trimestre» es la mejor que llegó al trimestre, aunque haya empezado antes: nunca es menor que la actual |
| Récord (cierre) | Si la semana iguala o supera la mejor del **trimestre calendario**. Solo aparece con al menos dos semanas previas en el trimestre |
| Reconocimiento (cierre) | Quien entregó a tiempo **todas** sus tareas de la semana, con al menos 4 (`RECONOCIMIENTO_MINIMO`). A tiempo = cerrada hasta la fecha comprometida: reprogramar por el equipo no cuenta como a tiempo. Una heredada cerrada tarde no cuenta para nadie. Si nadie llega, la sección no sale |

Ver la lista de rutas en la [referencia de la API](./referencia-api.md).

El markdown resultante **replica el formato actual de las actas de Geeks**, para que la
transición sea invisible para el equipo. La publicación es otro paso (`POST /semanas/actas/:actaId/publicar`,
lógica en `backend/src/lib/mcp/publish.ts`). Un documento de una mesa se publica como Message en el board
Weekly de esa mesa. Solo un documento sin mesa se publica como Doc en el proyecto de
`tenants.config.basecamp_docs_project_id`.

---

## Decisión pendiente que bloquea esta fase

**¿El Gerente General aparece en el backlog operativo?**

En el Plan Operativo del 03/08, Luis figura como responsable de 4 tareas de prioridad Alta.
Resultado: 2 no entregadas, 2 entregadas con retraso, 0 a tiempo.

Consecuencia técnica: si el GG está en el backlog, **el motor lo va a marcar cada semana**
con señales de `compromiso_vencido`. Eso es correcto y necesario, pero hay que decidirlo
antes de encender el motor:

| Opción | Implicación |
|---|---|
| **A. GG sale del backlog operativo** | Sus compromisos van a un tablero de dirección con ritual propio. Consistente con la estrategia de extracción |
| **B. GG permanece en el backlog** | Marcia lo marca públicamente igual que a cualquiera. Es lo único que hace que WorkOS sobreviva por adopción |

**Lo que no funciona:** estar en el backlog y ser el único exento. Es precisamente lo que
hizo fracasar los intentos anteriores de implementar WorkOS.

**Decisión (03/09/2026): Opción A.** El weekly es de Marcia; Luis no participa ni aparece como responsable en el backlog operativo. No se implementa ninguna exención en el motor: simplemente no se le asignan requerimientos ni acuerdos.


## Cambios del 10/09/2026 (feedback de Marcia)

- **Reprogramar no cambia el estado.** Mover la fecha incrementa `veces_reprogramado` y queda en `reprogramaciones` con motivo, pero la tarea conserva su estado ("En proceso" sigue en proceso). El estado "Reprogramado" queda como estado manual.
- **Planificación.** `requerimientos.planificacion`: `planificado` (entró por el weekly), `no_planificado` (se creó durante la semana, con plan ya generado y fecha dentro de la semana; automático al crear) o `urgente` (manual). Columna en el backlog, filtro "Fuera del weekly", KPI en el dashboard.
- **Selección del daily.** `requerimientos.daily_fecha`: la mesa elige qué se trabaja hoy («Elegir tareas de hoy» en Daily o ☀ en el backlog). Columna «Hoy se trabaja» en el Daily y sección 🎯 en la apertura/cierre publicados.
- **Motivo obligatorio.** Desde la pantalla no se puede cambiar la fecha de entrega sin elegir el motivo de la
  reprogramación: la API responde 422 si falta (`backend/src/lib/requerimientos/actualizar.ts`). Ver
  [16-cumplimiento.md](./16-cumplimiento.md).
- **Fecha a Basecamp.** Al reprogramar, `due_on` se envía de inmediato y la pantalla confirma «Fecha enviada a Basecamp ✓»; si falla, se avisa y la reconciliación (cada 30 min) la reenvía.

## Evolutivo (26/09/2026)

Antes, las métricas del cierre del daily se calculaban, iban a Basecamp y se perdían, y la selección del daily
se sobrescribía cada día. Ahora queda una **foto por mesa y día hábil** y una **por mesa y semana**
(migración 23: `daily_snapshots`, `weekly_snapshots`; lógica en `backend/src/lib/evolutivo.ts`).

- **Cuándo se toma**: al publicar el cierre (`origen = cierre`), L-V 19:30 para las mesas sin cierre
  (`cron`) y el domingo 17:55 la semana que cierra. Una foto en vivo nunca se reemplaza por una reconstruida.
- **Día**: plan del día (elegidas vs cerradas), cerradas fuera del daily, nuevas (por `fecha_pedido`, así una
  importación masiva no cuenta como trabajo nuevo) y cuántas fuera de planificación, reprocesos,
  reprogramaciones, bloqueos, vencidas abiertas (las completadas sin fecha de cierre son histórico y no
  cuentan), y detalle por persona.
- **Semana**: comprometidas, a tiempo original y vigente, % del plan operativo cumplido (si se generó),
  arrastre, cerradas, reprocesos, reprogramaciones por atribución, señales de la mesa, acuerdos (de toda la
  agencia: no tienen mesa) y dailies publicados.
- **Reconstrucción**: `POST /evolutivo/reconstruir` (admin; botón en la pantalla) rehace desde el 21/09 con la
  auditoría. La selección de cada día es el último `daily_fecha` de cada tarea antes del cierre publicado (o del
  fin del día). Verificado contra el cierre publicado del 22/09: coinciden cerradas fuera del daily y vencidas.
- **Semanas cerradas congeladas**: `POST /semanas/:id/senales/recalcular` devuelve 409 si la semana ya cerró.
- **Pantalla**: Rituales → Evolutivo (gestión): resumen del mes con comparación vs mes anterior, gráficas día a
  día, tabla con detalle por persona, tabla semanal y CSV.

## Riesgo de la semana

Desde el 30/10/2026, el weekly muestra cuántas horas le quedan a cada persona y qué tareas no le alcanzan, y el lunes a
las 07:35 la tarea `riesgo_semana` avisa (correo y campana) al líder de la mesa y a la ejecutiva de cada cuenta afectada,
para repartir, recortar o avisar al cliente a tiempo. El cálculo está en `backend/src/lib/carga.ts`.

**Qué entra en la carga.** Las tareas abiertas de la persona que vencen hasta el domingo y no esperan al cliente. Las
atrasadas cuentan solo si se movieron en los últimos 7 días; las quietas seguramente ya se entregaron y se preguntan en
[Mi día](./22-avisos.md). La carga de una persona incluye todas sus mesas.

**Horas por tarea.** Lo que de verdad se tarda, según el timesheet de Basecamp de las últimas 12 semanas (tareas
completadas, mínimo 5 para confiar en la mediana), en este orden:

1. la mediana del tipo de pieza;
2. el esfuerzo del tipo de pieza × la mediana general;
3. la mediana de la persona;
4. la mediana general;
5. sin datos, 4 h.

A cada tarea se le resta lo que la persona ya registró en ella (siempre queda al menos media hora). Hoy ninguna tarea
abierta tiene tipo de pieza, así que se usa la mediana de cada persona.

**Capacidad.** Se mide en la misma unidad: lo que la persona registra en una semana fuerte, el percentil 75 de sus
últimas 12 semanas con horas. Con menos de 6 semanas, la mediana de las del equipo. Sin ningún dato, la capacidad
declarada. Se multiplica por los días hábiles que quedan de la semana.

Contra las 40 h declaradas el riesgo nunca saltaba: el timesheet recoge unas 13 h por persona y semana, porque no
todo el trabajo se registra. Comparar horas de timesheet con horas de timesheet sí detecta a quien tiene más que una
semana fuerte.

**En riesgo.** Las tareas se ordenan por fecha. Las que ya no entran en la capacidad que queda son las que están en
riesgo. Sin días hábiles por delante no se marca riesgo.

## Otras tareas programadas

Además de `senales` (domingo 18:00), `foto_daily` (L-V 19:30) y `foto_semana` (domingo 17:55), el backend corre
otras tareas: `informe_mensual` (día 1, 08:00), `kpis_congelar` (día 1, 08:10), `horas` (cada 6 h),
`limpieza` (diario 03:30) y `vigia` (cada hora), entre otras. Todas están declaradas en
`backend/src/lib/jobs.ts`. La tabla completa, con qué hace cada una, está en
[Operar BackIO](./operacion.md#lo-que-corre-solo).
