-- Migración 35 · 21/10/2026 · decisiones de Luis tras la revisión de los últimos cambios.
--
-- 1. acuerdos.mesa_id: cada acuerdo del weekly pertenece a la mesa en cuyo weekly se creó. Antes BackIO adivinaba la
--    mesa por las tareas del responsable: quien trabaja en dos mesas veía su acuerdo en las dos actas, y el de alguien
--    sin tareas en la mesa no salía en ninguna. Null = acuerdo del weekly de toda la agencia.
-- 2. requerimientos.basecamp_due_on_visto: la última fecha de entrega que BackIO vio (o escribió) en el to-do de
--    Basecamp. Si Basecamp tiene otra, alguien la cambió allá y se acepta; si tiene la misma, manda BackIO. Reemplaza la
--    comparación de horas (un comentario en Basecamp mueve la hora del to-do). No mueve ultima_actualizacion: el trigger
--    de «días sin movimiento» solo mira columnas sustantivas. Lo escribe solo el backend (service role).
-- 3. senales.atendida_por / atendida_at: quién marcó la señal como atendida y cuándo (botón «Atendida» del weekly).

alter table acuerdos add column if not exists mesa_id uuid references mesas(id);
create index if not exists idx_acuerdos_mesa on acuerdos(tenant_id, mesa_id);

alter table requerimientos add column if not exists basecamp_due_on_visto date;

alter table senales add column if not exists atendida_por uuid references usuarios(id);
alter table senales add column if not exists atendida_at timestamptz;

-- Los cinco acuerdos que existen hoy salieron del weekly de Omega (4 pendientes y el de prueba, cancelado).
update acuerdos set mesa_id = '40000000-0000-4000-8000-000000000002'
where mesa_id is null
  and id in (
    '89911ccb-4c06-4a79-bd6f-f34f9eefe29c',
    'cb48af61-705c-4b55-b149-10b54d8c997b',
    'a3965ccb-1dfe-421b-b22f-ede90221878d',
    'f8850f0e-94c9-4abc-903a-3d84e1d0d761',
    'bdd605f3-a521-4638-8da4-d80d45f7effa'
  );

-- Verificación: 5 acuerdos de Omega, 0 sin mesa; columnas nuevas presentes.
select
  (select count(*) from acuerdos where mesa_id = '40000000-0000-4000-8000-000000000002') as acuerdos_omega,
  (select count(*) from acuerdos where mesa_id is null) as acuerdos_sin_mesa,
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'requerimientos' and column_name = 'basecamp_due_on_visto')
        or (table_name = 'senales' and column_name in ('atendida_por', 'atendida_at'))
        or (table_name = 'acuerdos' and column_name = 'mesa_id'))) as columnas_nuevas; -- esperado: 4
