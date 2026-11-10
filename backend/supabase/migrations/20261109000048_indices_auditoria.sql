-- Migración 48 · 9/11/2026 · índices de audit_log para las consultas que usan accion, entidad o entidad_id: eran las más
-- lentas del reporte de Supabase (hasta 2,8 s). Aplicar DESPUÉS de la 47, con la tabla ya limpia. No cambia políticas RLS.

create index if not exists idx_audit_tenant_accion_fecha on audit_log (tenant_id, accion, created_at desc);
create index if not exists idx_audit_tenant_entidad_fecha on audit_log (tenant_id, entidad, created_at);
create index if not exists idx_audit_tenant_entidad_id_fecha on audit_log (tenant_id, entidad_id, created_at);

-- Verificación (esperado: 3).
select count(*) as indices from pg_indexes
where tablename = 'audit_log'
  and indexname in ('idx_audit_tenant_accion_fecha', 'idx_audit_tenant_entidad_fecha', 'idx_audit_tenant_entidad_id_fecha');
