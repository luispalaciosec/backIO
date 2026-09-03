# 05 · Rituales: Weekly, Daily y motor de señales

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

Se calculan el domingo a las 18:00 y se persisten en `senales`.

| Tipo | Condición | Severidad | Tema que entra a agenda |
|---|---|---|---|
| `arrastre_reincidente` | `veces_reprogramado >= 2` | Crítica | "Decidir: se hace, se reasigna o se mata" |
| `concentracion_carga` | Un owner con >30% de tareas de la semana | Crítica | "Redistribución de carga — riesgo de punto único" |
| `bloqueo_cliente` | `estado_aprobacion = 'pendiente_cliente'` y >5 días | Alta | "Escalamiento a ejecutiva de cuenta" |
| `cuenta_silenciosa` | Cliente sin requerimientos completados en 14 días | Alta | "Revisión de estado de cuenta" |
| `compromiso_vencido` | `acuerdos.fecha_compromiso < hoy` y estado pendiente | Crítica | "Rendición de cuentas" |
| `sobrecarga_proyectada` | Σ tareas asignadas > capacidad declarada del owner | Alta | "Recortar alcance de la semana" |
| `sin_movimiento` | `dias_sin_movimiento > 14` en requerimiento activo | Media | "Requerimiento huérfano" |
| `atraso_critico` | `dias_atraso > 30` | Crítica | "Atraso material — decisión de cuenta" |

### Implementación

```typescript
// lib/rituals/signals.ts

interface SignalRule {
  tipo: string;
  severidad: 'critica' | 'alta' | 'media';
  detectar: (ctx: WeekContext) => Promise<Signal[]>;
  titulo: (s: Signal) => string;
}

export const REGLAS: SignalRule[] = [
  {
    tipo: 'concentracion_carga',
    severidad: 'critica',
    detectar: async (ctx) => {
      const porOwner = groupBy(ctx.requerimientos, r => r.owner_agencia[0]);
      const total = ctx.requerimientos.length;
      return Object.entries(porOwner)
        .filter(([_, tareas]) => tareas.length / total > 0.30)
        .map(([ownerId, tareas]) => ({
          entidad_tipo: 'usuario',
          entidad_id: ownerId,
          detalle: { tareas: tareas.length, total, pct: Math.round(tareas.length/total*100) }
        }));
    },
    titulo: (s) => `${s.detalle.nombre} concentra ${s.detalle.tareas} de ${s.detalle.total} tareas (${s.detalle.pct}%)`
  },
  // ... resto de reglas
];
```

Los umbrales viven en `tenants.config.signal_thresholds` — parametrizables sin deploy.

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

**Agenda generada automáticamente**, enviada domingo 18:00 al facilitador.

Estructura:
1. Compromisos vencidos de la semana anterior (señales `compromiso_vencido`)
2. Señales críticas ordenadas por severidad
3. Capacidad por equipo (calculada, no declarada)
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
| Bloqueo nuevo | `estado_operativo = 'bloqueado'` en últimas 24h |
| Fecha cambiada | `fecha_entrega` modificada desde ayer |

Si el daily muestra más que eso, se convierte en un weekly y muere en tres semanas. Los
rituales no fallan por falta de contenido, fallan por exceso.

Vista dedicada: `/daily` — una sola pantalla, sin scroll, proyectable.

---

## Generación de documentos

```typescript
// lib/rituals/documents.ts

async function generarPlanOperativo(semanaId: string): Promise<Acta> {
  const data = {
    semana: await getSemana(semanaId),
    capacidad: await calcularCapacidadPorEquipo(semanaId),
    prioridades: await getRequerimientosDeSemana(semanaId),
    riesgos: await getSenales(semanaId, ['bloqueo_cliente','sobrecarga_proyectada']),
    pendientes_anteriores: await getAcuerdosAbiertos(semanaId)
  };
  return {
    contenido: data,
    markdown: renderPlanOperativo(data)   // formato actual de Geeks, respetado
  };
}
```

El markdown resultante **replica el formato actual de las actas de Geeks**, para que la
transición sea invisible para el equipo. Se publica en Basecamp como Doc vía API.

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
