-- KPIs por persona y por equipo (25/09/2026) + datos nuevos para calcularlos solos.
-- ZONA DE REVISIÓN HUMANA (CLAUDE.md): crea políticas RLS y modifica los triggers de columnas protegidas.
-- Plan: docs/19-kpis.md. Todos los bloques son idempotentes.

-- ============================================================================
-- 1. Área funcional de cada persona (define qué KPIs le aplican)
-- ============================================================================
alter table usuarios add column if not exists area text
  check (area in ('cuentas','produccion','diseno','creatividad','content'));

-- Solo admin cambia el área (misma protección que rol, activo, capacidad…).
create or replace function usuarios_proteger_columnas() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or auth_es_admin() then return new; end if;
  if new.rol is distinct from old.rol
     or new.activo is distinct from old.activo
     or new.tenant_id is distinct from old.tenant_id
     or new.email is distinct from old.email
     or new.basecamp_user_id is distinct from old.basecamp_user_id
     or new.capacidad_semanal is distinct from old.capacidad_semanal
     or new.area is distinct from old.area then
    raise exception 'Solo un administrador puede cambiar rol, estado, correo, capacidad, área o vínculo con Basecamp'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

-- ============================================================================
-- 2. Datos nuevos en la tarea: clase, proactividad y primera respuesta (SLA)
-- ============================================================================
alter table requerimientos add column if not exists clase text not null default 'tarea'
  check (clase in ('tarea','propuesta','incidencia'));
alter table requerimientos add column if not exists proactiva boolean not null default false;
alter table requerimientos add column if not exists primera_respuesta_at timestamptz;

-- La vista expande r.* al crearse: se recrea (misma definición que la migración 19) para incluir las columnas nuevas.
drop view if exists v_requerimientos_metricas;
create view v_requerimientos_metricas
with (security_invoker = true) as
select
  r.*,
  case
    when r.estado_operativo in ('completado','cancelado') then 0
    when r.fecha_entrega is null then 0
    else greatest(0, ((now() at time zone 'America/Guayaquil')::date - r.fecha_entrega))
  end as dias_atraso,
  greatest(0, extract(epoch from (now() - r.ultima_actualizacion)) / 86400)::int as dias_sin_movimiento,
  case when r.estado_operativo = 'completado' then r.peso else 0 end as peso_completado
from requerimientos r
where r.deleted_at is null;

-- Un colaborador tampoco puede cambiar clase, proactividad ni primera respuesta.
create or replace function requerimientos_limitar_colaborador() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or auth_es_gestion() then return new; end if;
  if not (auth.uid() = any(old.owner_agencia)) then
    raise exception 'Solo puedes actualizar las tareas asignadas a ti' using errcode = 'insufficient_privilege';
  end if;
  if new.titulo_interno        is distinct from old.titulo_interno
     or new.etiqueta_cliente   is distinct from old.etiqueta_cliente
     or new.visible_cliente    is distinct from old.visible_cliente
     or new.owner_agencia      is distinct from old.owner_agencia
     or new.owner_cliente      is distinct from old.owner_cliente
     or new.prioridad          is distinct from old.prioridad
     or new.peso               is distinct from old.peso
     or new.tipo_trabajo       is distinct from old.tipo_trabajo
     or new.estado_aprobacion  is distinct from old.estado_aprobacion
     or new.planificacion      is distinct from old.planificacion
     or new.proyecto_id        is distinct from old.proyecto_id
     or new.cliente_id         is distinct from old.cliente_id
     or new.tenant_id          is distinct from old.tenant_id
     or new.bloque_nombre      is distinct from old.bloque_nombre
     or new.fecha_pedido       is distinct from old.fecha_pedido
     or new.fecha_entrega_original is distinct from old.fecha_entrega_original
     or new.deleted_at         is distinct from old.deleted_at
     or new.basecamp_todo_id   is distinct from old.basecamp_todo_id
     or new.basecamp_todolist_id is distinct from old.basecamp_todolist_id
     or new.basecamp_url       is distinct from old.basecamp_url
     or new.clase              is distinct from old.clase
     or new.proactiva          is distinct from old.proactiva
     or new.primera_respuesta_at is distinct from old.primera_respuesta_at then
    raise exception 'Como colaborador solo puedes cambiar estado, fecha de entrega, entregables, piezas y la selección del daily'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

-- ============================================================================
-- 3. Atribución explícita del reproceso (a qué área y si es del equipo, del cliente o externo)
-- ============================================================================
alter table reprocesos add column if not exists area_responsable text
  check (area_responsable in ('cuentas','produccion','diseno','creatividad','content'));
alter table reprocesos add column if not exists atribuible text
  check (atribuible in ('equipo','cliente','externo'));

-- Motivo nuevo para CUE-01: información incompleta o incorrecta en el levantamiento.
alter table reprocesos drop constraint if exists reprocesos_motivo_check;
alter table reprocesos add constraint reprocesos_motivo_check check (motivo in (
  'brief_incompleto','levantamiento_incompleto','error_ejecucion','cambio_opinion_cliente','ajuste_marca_legal','direccion_arte','error_texto'));

-- Backfill: atribuible desde el motivo (mismo mapa que MOTIVOS_REPROCESO.responsable).
update reprocesos set atribuible = case
    when motivo in ('cambio_opinion_cliente','ajuste_marca_legal') then 'cliente'
    when motivo is null then null
    else 'equipo' end
  where atribuible is null;
update reprocesos set area_responsable = 'cuentas' where area_responsable is null and motivo in ('brief_incompleto','levantamiento_incompleto');

-- ============================================================================
-- 4. Rondas de revisión: cada cambio de estado de aprobación queda registrado
-- ============================================================================
create table if not exists aprobacion_eventos (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  requerimiento_id  uuid not null references requerimientos(id) on delete cascade,
  estado_de         text,
  estado_a          text not null,
  ronda             int not null default 1,
  usuario_id        uuid,
  created_at        timestamptz not null default now()
);
create index if not exists aprobacion_eventos_req on aprobacion_eventos (tenant_id, requerimiento_id, created_at);
create index if not exists aprobacion_eventos_fecha on aprobacion_eventos (tenant_id, created_at desc);
alter table aprobacion_eventos enable row level security;
create policy aprobacion_eventos_select on aprobacion_eventos for select to authenticated using (tenant_id = auth_tenant_id());
-- Sin políticas de escritura: solo el trigger (security definer) y el service role insertan.

create or replace function requerimientos_registrar_aprobacion() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_rechazos int;
begin
  if new.estado_aprobacion is not distinct from old.estado_aprobacion then return new; end if;
  select count(*) into v_rechazos from aprobacion_eventos
    where requerimiento_id = new.id and estado_a = 'rechazado';
  insert into aprobacion_eventos (tenant_id, requerimiento_id, estado_de, estado_a, ronda, usuario_id)
  -- Ronda = 1 + rechazos anteriores. «Aprobada en 1ª revisión» = evento a 'aprobado' con ronda 1.
  values (new.tenant_id, new.id, old.estado_aprobacion::text, new.estado_aprobacion::text, v_rechazos + 1, auth.uid());
  return new;
end $$;
drop trigger if exists trg_requerimientos_registrar_aprobacion on requerimientos;
create trigger trg_requerimientos_registrar_aprobacion
  after update of estado_aprobacion on requerimientos for each row execute function requerimientos_registrar_aprobacion();

-- ============================================================================
-- 5. Catálogo de KPIs y mediciones (persona y equipo)
-- ============================================================================
create table if not exists kpi_definiciones (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  codigo             text not null,
  area               text not null check (area in ('cuentas','produccion','diseno','creatividad','content')),
  indicador          text not null,
  periodicidad       text not null default 'mensual' check (periodicidad in ('mensual','trimestral')),
  operador           text not null default '>=' check (operador in ('>=','<=')),
  meta               numeric not null,
  tipo               text not null default 'porcentaje' check (tipo in ('porcentaje','margen')),
  numerador_label    text not null,
  denominador_label  text not null,
  denominador_fijo   numeric,
  calculo            text not null default 'manual' check (calculo in (
                       'a_tiempo','retrabajo','levantamiento','aprobacion_primera','propuestas_aprobadas',
                       'sla_respuesta','sla_incidencia','proactividad','manual')),
  fuente             text,
  regla              text,
  formula            text,
  activo             boolean not null default true,
  orden              int not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, codigo)
);
create trigger trg_kpi_definiciones_updated_at before update on kpi_definiciones for each row execute function set_updated_at();

create table if not exists kpi_mediciones (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  kpi_id                uuid not null references kpi_definiciones(id) on delete cascade,
  periodo               text not null check (periodo ~ '^\d{4}-(0[1-9]|1[0-2]|T[1-4])$'),
  usuario_id            uuid references usuarios(id),   -- null = medición del equipo
  dato_a                numeric,
  dato_b                numeric,
  meta_individual       numeric,
  origen                text not null default 'manual' check (origen in ('auto','manual','ajustado')),
  justificacion_ajuste  text,
  tasa_respuesta        numeric,
  causa                 text,
  atribuible            text check (atribuible in ('equipo','cliente','externo')),
  evidencia_url         text,
  plan_mejora           text,
  responsable_id        uuid references usuarios(id),
  fecha_seguimiento     date,
  registrado_por        uuid references usuarios(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists kpi_mediciones_unica
  on kpi_mediciones (tenant_id, kpi_id, periodo, coalesce(usuario_id, '00000000-0000-0000-0000-000000000000'::uuid));
create trigger trg_kpi_mediciones_updated_at before update on kpi_mediciones for each row execute function set_updated_at();

-- Lectura para gestión del tenant; escritura solo por el backend (service role), que aplica el permiso
-- fino: catálogo solo admin, mediciones admin/gerencia/operaciones.
alter table kpi_definiciones enable row level security;
alter table kpi_mediciones enable row level security;
create policy kpi_definiciones_select on kpi_definiciones for select to authenticated using (tenant_id = auth_tenant_id() and auth_es_gestion());
create policy kpi_mediciones_select on kpi_mediciones for select to authenticated using (tenant_id = auth_tenant_id() and auth_es_gestion());

-- ============================================================================
-- 6. Semilla: los 17 KPIs de Plantilla_KPIs.xlsx para cada tenant
-- ============================================================================
insert into kpi_definiciones (tenant_id, codigo, area, indicador, periodicidad, operador, meta, tipo, numerador_label, denominador_label, denominador_fijo, calculo, fuente, regla, formula, orden)
select t.id, k.* from tenants t cross join (values
  ('KPI-CUE-01','cuentas','% de requerimientos correctamente levantados','mensual','>=',0.9,'porcentaje','Requerimientos sin aclaración/reproceso por información incompleta o incorrecta','Total levantados',null::numeric,'levantamiento','Basecamp','Solo causas atribuibles al equipo.','(Requerimientos correctamente levantados ÷ Total de requerimientos levantados) × 100',1),
  ('KPI-CUE-02','cuentas','% de satisfacción del cliente','trimestral','>=',0.9,'porcentaje','Puntaje de satisfacción obtenido','Puntaje máximo posible',null,'manual','Encuesta periódica','Resultado siempre se reporta. Tasa de respuesta ≥70%: muestra válida. <70%: muestra insuficiente.','(Puntaje de satisfacción obtenido ÷ Puntaje máximo posible) × 100. Validación: (Encuestas respondidas ÷ Encuestas enviadas) × 100',2),
  ('KPI-CUE-03','cuentas','% de requerimientos atendidos dentro del tiempo de respuesta','mensual','>=',0.9,'porcentaje','Requerimientos con primera respuesta efectiva dentro del SLA','Total requerimientos recibidos',null,'sla_respuesta','BackIO (botón Respondido)','SLA: Alta ≤30 min hábiles; Media ≤1,5 h; Baja ≤8 h. Horario L-V 09:00–18:00.','(Requerimientos con primera respuesta efectiva dentro del SLA ÷ Total de requerimientos recibidos) × 100',3),
  ('KPI-PRO-01','produccion','% de entregas de Producción a tiempo','mensual','>=',0.9,'porcentaje','Entregables dentro de fecha comprometida','Total entregables finalizados',null,'a_tiempo','Basecamp','Excluir dependencias externas alertadas oportunamente.','(Entregables de Producción entregados dentro de la fecha comprometida ÷ Total de entregables finalizados) × 100',1),
  ('KPI-PRO-02','produccion','Índice de retrabajo de Producción','mensual','<=',0.15,'porcentaje','Entregables con reproceso atribuible a Producción','Total entregables realizados',null,'retrabajo','Basecamp','Solo reproceso atribuible a Producción.','(Entregables con reproceso atribuible a Producción ÷ Total de entregables realizados) × 100',2),
  ('KPI-PRO-03','produccion','Eficiencia en la gestión de producción y presupuesto','mensual','>=',0.3,'margen','Valor facturado al cliente − Costo de proveedores','Valor facturado al cliente',null,'manual','Fuente financiera','Margen = (Facturación − costo proveedores) ÷ facturación.','((Valor facturado al cliente − Costo de proveedores) ÷ Valor facturado al cliente) × 100',3),
  ('KPI-DIS-01','diseno','% de entregas de piezas realizadas a tiempo','mensual','>=',0.9,'porcentaje','Entregables dentro de fecha comprometida','Total entregables finalizados',null,'a_tiempo','Basecamp','Excluir dependencias externas alertadas oportunamente.','(Piezas entregadas dentro de la fecha comprometida ÷ Total de piezas finalizadas) × 100',1),
  ('KPI-DIS-02','diseno','% de propuestas aprobadas en primera revisión','mensual','>=',0.85,'porcentaje','Propuestas aprobadas sin ajustes sustanciales en primera revisión','Total propuestas revisadas',null,'aprobacion_primera','BackIO (rondas de revisión)','Líder Diseño = A; Diseñador = R; Director Creativo = C si hay concepto/estrategia.','(Propuestas aprobadas sin ajustes sustanciales en primera revisión ÷ Total de propuestas revisadas) × 100',2),
  ('KPI-DIS-03','diseno','Índice de retrabajo atribuible a Diseño','mensual','<=',0.15,'porcentaje','Piezas con retrabajo por errores atribuibles a Diseño','Total piezas entregadas',null,'retrabajo','Basecamp','Solo errores atribuibles a Diseño.','(Piezas con retrabajo por errores atribuibles a Diseño ÷ Total de piezas entregadas) × 100',3),
  ('KPI-CRE-01','creatividad','% de campañas aprobadas (implementadas)','mensual','>=',0.8,'porcentaje','Campañas/propuestas aprobadas por el cliente','Total campañas/propuestas presentadas',null,'propuestas_aprobadas','BackIO (clase Propuesta)','Aprobación externa del cliente.','(Campañas/propuestas aprobadas por el cliente ÷ Total de campañas/propuestas presentadas) × 100',1),
  ('KPI-CRE-02','creatividad','Índice de retrabajo','mensual','<=',0.15,'porcentaje','Propuestas con reproceso por errores o incumplimiento del brief atribuible','Total propuestas entregadas',null,'retrabajo','Basecamp','Solo causas atribuibles al equipo.','(Propuestas con reproceso por errores o incumplimiento del brief atribuible ÷ Total de propuestas entregadas) × 100',2),
  ('KPI-CRE-03','creatividad','% de entregas creativas dentro del plazo','mensual','>=',0.9,'porcentaje','Entregas dentro de fecha o SLA acordado','Total entregas',null,'a_tiempo','Basecamp','Excluir dependencias externas alertadas oportunamente.','(Entregas creativas dentro de la fecha o SLA acordado ÷ Total de entregas creativas) × 100',3),
  ('KPI-CRE-04','creatividad','Cumplimiento de proactividad','mensual','>=',1,'porcentaje','Propuestas proactivas presentadas','Meta mensual de propuestas (3)',3,'proactividad','BackIO (marca Proactiva)','Meta operativa: 3 propuestas al mes por persona.','(Propuestas proactivas presentadas ÷ Meta mensual de 3 propuestas) × 100',4),
  ('KPI-CON-01','content','% de cumplimiento de entregas de contenido','mensual','>=',0.9,'porcentaje','Contenidos dentro de fecha comprometida','Total contenidos planificados',null,'a_tiempo','Basecamp','Excluir dependencias externas alertadas oportunamente.','(Contenidos entregados dentro de la fecha comprometida ÷ Total de contenidos planificados) × 100',1),
  ('KPI-CON-02','content','% de incidencias resueltas dentro del tiempo acordado','mensual','>=',0.9,'porcentaje','Incidencias resueltas dentro del plazo','Total incidencias gestionadas',null,'sla_incidencia','BackIO (clase Incidencia)','Medir sobre incidencias gestionadas. SLA por prioridad en horas hábiles.','(Incidencias resueltas dentro del tiempo acordado ÷ Total de incidencias gestionadas) × 100',2),
  ('KPI-CON-03','content','Cumplimiento de proactividad en contenidos','mensual','>=',1,'porcentaje','Ideas/propuestas proactivas presentadas','Meta mensual (10)',10,'proactividad','BackIO (marca Proactiva)','Meta operativa: 10 propuestas al mes por persona.','(Ideas/propuestas proactivas presentadas ÷ Meta mensual de 10 propuestas) × 100',3),
  ('KPI-CON-04','content','Tasa de errores de contenido','mensual','<=',0,'porcentaje','Contenidos con errores atribuibles a Content','Total contenidos entregados',null,'retrabajo','Basecamp','Meta cero errores atribuibles.','(Contenidos con errores atribuibles a Content ÷ Total de contenidos entregados) × 100',4)
) as k(codigo, area, indicador, periodicidad, operador, meta, tipo, numerador_label, denominador_label, denominador_fijo, calculo, fuente, regla, formula, orden)
on conflict (tenant_id, codigo) do nothing;
