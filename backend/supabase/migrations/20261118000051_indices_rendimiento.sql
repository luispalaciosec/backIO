-- Migración 51 · 18/11/2026 · índices para las consultas que más pesan en Query Performance. Solo agrega índices:
-- no cambia datos ni permisos. Aplicar con BackIO respondiendo. Una sola vez, completa.

-- Registro de tareas programadas: el vigía y /health/profundo lo ordenan por fecha (110 ms en promedio, sin índice).
create index if not exists cron_runs_inicio_idx on public.cron_runs (inicio_at desc);
create index if not exists cron_runs_job_inicio_idx on public.cron_runs (job, inicio_at);

-- Horas del timesheet por período (dashboard, KPIs, rentabilidad, riesgo de la semana): 65–100 ms y hasta 1 s.
-- Había índices por cliente y por persona, ninguno por tenant y fecha, que es como se consultan.
create index if not exists horas_tenant_fecha_idx on public.horas (tenant_id, fecha);

-- La campana: avisos de cada persona, los más nuevos primero (la consultan todas las pestañas abiertas).
create index if not exists notificaciones_usuario_idx on public.notificaciones (usuario_id, created_at desc);

-- Estadísticas al día para que el planificador use los índices nuevos.
analyze public.cron_runs;
analyze public.horas;
analyze public.notificaciones;
analyze public.audit_log;

-- Control: debe dar 4.
select count(*) as indices
from pg_indexes
where schemaname = 'public'
  and indexname in ('cron_runs_inicio_idx', 'cron_runs_job_inicio_idx', 'horas_tenant_fecha_idx', 'notificaciones_usuario_idx');
