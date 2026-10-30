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
