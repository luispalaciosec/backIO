-- Migración 50 · 18/11/2026 · aviso «Auth RLS Initialization Plan» del Performance Advisor. ZONA DE REVISIÓN (RLS).
--
-- En 14 políticas, auth.uid() se evaluaba una vez POR FILA. Envuelto en (select auth.uid()), Postgres lo calcula una
-- sola vez por consulta. El resultado es exactamente el mismo: solo cambia cuántas veces se calcula.
-- Se hace con ALTER POLICY (no se borra ni se recrea ninguna política: conserva nombre, roles y comando).
--
-- No incluye el aviso «Multiple Permissive Policies»: separar las políticas *_write en insert/update/delete cambiaría
-- qué filas ve cada rol en un SELECT si alguna *_write deja ver más que su *_select. Con tablas de este tamaño la
-- ganancia es mínima; se revisa aparte, política por política.
--
-- Aplicar DESPUÉS de reiniciar la base y con BackIO respondiendo. Una sola vez, completa.

begin;

do $$
declare
  p record;
  patron constant text := '(?<!SELECT )auth\.(uid|jwt|role)\(\)';
  nueva_using text;
  nueva_check text;
begin
  for p in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') ~ patron or coalesce(with_check, '') ~ patron)
  loop
    nueva_using := regexp_replace(p.qual, patron, '(select auth.\1())', 'g');
    nueva_check := regexp_replace(p.with_check, patron, '(select auth.\1())', 'g');
    if p.qual is not null and nueva_using is distinct from p.qual then
      execute format('alter policy %I on public.%I using (%s)', p.policyname, p.tablename, nueva_using);
    end if;
    if p.with_check is not null and nueva_check is distinct from p.with_check then
      execute format('alter policy %I on public.%I with check (%s)', p.policyname, p.tablename, nueva_check);
    end if;
    raise notice 'ajustada: %.%', p.tablename, p.policyname;
  end loop;
end $$;

commit;

-- Control: debe dar 0 filas (ninguna política con auth.<función>() sin envolver).
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and (coalesce(qual, '') ~ '(?<!SELECT )auth\.(uid|jwt|role)\(\)'
    or coalesce(with_check, '') ~ '(?<!SELECT )auth\.(uid|jwt|role)\(\)');
