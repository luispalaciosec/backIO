# 20 · Cuando alguien se va

> Escrito el 11/10/2026, con la migración 30.

Quien se va de la agencia **se desactiva, nunca se borra**. Lo que hizo sigue siendo suyo: su nombre se sigue viendo
en la historia con «(ex)», y lo que cerró cuenta para él en KPIs, cumplimiento e informes. Lo que tenía abierto pasa a
otras personas, y queda registrado de quién a quién.

## Paso a paso (admin)

1. **Admin → Usuarios → «Registrar salida»** en la fila de la persona.
2. La pantalla muestra todo lo que tiene abierto:
   - sus **tareas**, agrupadas por cliente;
   - los **proyectos** donde es la ejecutiva;
   - las **mesas** que lidera;
   - sus **acuerdos pendientes** del weekly;
   - las **recurrencias** donde es la ejecutiva o la responsable de un bloque.
3. Cada grupo de tareas viene con una propuesta: el líder de la mesa del cliente (o del proyecto, si el proyecto tiene
   su propia mesa). Se cambia para todo el cliente o tarea por tarea.
4. «Nadie» deja la tarea sin responsable. No se permite para tareas que están en el daily, porque ninguna tarea entra
   al daily sin responsable. Los acuerdos del weekly también necesitan a alguien.
5. Se elige la fecha de salida y, si se quiere, el motivo (queda en la auditoría).
6. «Confirmar salida».

## Qué pasa al confirmar

En **una sola transacción** (`salida_colaborador`, migración 30):

- Cada tarea abierta pasa a la persona elegida. Los demás responsables de la tarea se mantienen.
- Proyectos, mesas, acuerdos y recurrencias cambian de responsable. En las recurrencias cambian la ejecutiva y el
  responsable de cada bloque: el fee del mes siguiente ya nace con la persona nueva.
- Se revocan sus API keys y sus accesos de agentes (OAuth), y la persona queda inactiva.
- Si mientras se revisaba apareció algo nuevo a su nombre, no se aplica nada y la pantalla pide volver a revisar.

Después, fuera de la transacción:

- **Supabase Auth:** se bloquea su ingreso y se cierran todas sus sesiones. Si esto falla, la persona igual queda sin
  acceso (BackIO rechaza a los inactivos) y la pantalla lo avisa.
- **Basecamp:** en cada to-do abierto se saca a quien se va y se pone a quien lo recibe, sin tocar a los demás
  asignados, de a 50 to-dos por vez (`reemplazarResponsableEnTodos` en `lib/basecamp/write.ts`). Si un to-do falla,
  BackIO ya quedó bien. Para terminar lo que faltó: Admin → Mantenimiento → «Responsables perdidos en Basecamp», que
  también detecta to-dos asignados a alguien que ya no tiene acceso.
- **Auditoría:** un registro por tarea (`salida_reasignacion`, de quién a quién) y uno de la salida
  (`salida_colaborador`).

La reasignación no reinicia «días sin movimiento»: la tarea no se movió, solo cambió de manos.

## Tareas heredadas

Decisión de Luis (11/10/2026): una tarea **cuenta para quien la cierra**. Excepción: si la recibió con menos de **3
días hábiles** para la entrega, o ya vencida, queda marcada como **heredada**, y si se cierra tarde ese atraso no
cuenta para nadie. La marca la calcula el backend al confirmar (`esHeredada` en `shared/src/metricas.ts`). La pantalla
la muestra antes de confirmar.

## Cómo se mide después

- **KPIs:** quien se fue aparece en los meses en que trabajó, con «(ex)», y no en los siguientes. Lo que cerró sigue
  contando para él. Ver [KPIs](./19-kpis.md).
- **Personas y dashboard:** igual, en los periodos que lo incluyen. Las reprogramaciones y reprocesos cuentan para
  quien tenía la tarea en ese momento, no para quien la recibió después. Ver [Cumplimiento](./16-cumplimiento.md).
- **Weekly:** la señal `tareas_sin_responsable` avisa por cliente cuando quedan tareas sin responsable con entrega en
  la semana o vencidas.

## Lo que no se toca

- **Lo cerrado.** Las tareas completadas y canceladas conservan sus responsables. Desde la migración 30, al completarse
  una tarea quedan guardados en `responsables_cierre`, y la sincronización con Basecamp ya no cambia los responsables
  de una tarea cerrada.
- **El historial.** `requerimiento_responsables` guarda quién fue responsable de cada tarea, desde y hasta cuándo, en
  toda reasignación (no solo en salidas).
- **Sus horas.** Las horas del timesheet de Basecamp siguen a su nombre.
- **Sus registros:** bitácora, reprogramaciones, reprocesos, aprobaciones, actas publicadas y auditoría.

## Si vuelve

Admin → Usuarios muestra a quienes no tienen acceso. «Restaurar» reactiva la cuenta, quita el bloqueo y le manda un
correo para definir contraseña. Las tareas que se reasignaron **no vuelven solas**.

## Dónde está

| Pieza | Archivo |
|---|---|
| Pantalla | `frontend/app/(app)/admin/usuarios/[id]/salida/page.tsx` |
| Inventario y aplicación | `backend/src/lib/salida.ts`, `backend/src/lib/db/salida.ts` |
| Rutas | `GET` y `POST /api/v1/admin/usuarios/:id/salida` (solo admin) |
| Transacción | RPC `salida_colaborador`, migración `20261011000030_salida_colaborador.sql` |
| Cambio en Basecamp | `reemplazarResponsableEnTodos` en `backend/src/lib/basecamp/write.ts` |
| Tests | `salida.test.ts`, `basecamp_responsable_salida.test.ts`, `shared/src/__tests__/heredada.test.ts` |
