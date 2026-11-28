-- Migración 54 · 27/11/2026 · equipo dentro de la mesa (weekly acumulado, plan aprobado por Luis).
-- Una mesa puede tener equipos (p. ej. KKAA y Mini-Markets / OFF, ON, High End y Eventos): cada cliente dice a cuál
-- pertenece. Sin equipo, el cliente sale como «Sin equipo». No cambia políticas RLS: es una columna más de `clientes`.
-- Correr completo, una vez.

alter table public.clientes add column if not exists equipo text;

-- Control: debe dar 1 fila en true.
select exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'clientes' and column_name = 'equipo'
) as columna_equipo;
