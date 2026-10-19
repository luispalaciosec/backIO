-- ============================================================================
-- Migración 34 · Clientes de prueba (19/10/2026)
--
-- Acme EC S.A.S es el cliente del proyecto sandbox de Basecamp. Sus tareas de prueba se colaban en el weekly, las actas,
-- el dashboard, los KPIs y los informes. Con `es_prueba` quedan fuera de todos los números y señales (siguen en el
-- backlog para poder probar). Decisión de Luis, 19/10/2026.
-- ============================================================================
alter table clientes add column if not exists es_prueba boolean not null default false;

update clientes set es_prueba = true
  where tenant_id = '00000000-0000-4000-8000-000000000001' and nombre = 'Acme EC S.A.S';

-- ============================================================================
-- Verificación después de aplicar (solo lectura):
--   select nombre, es_prueba from clientes where es_prueba;      -- 1 fila: Acme EC S.A.S
-- ============================================================================
