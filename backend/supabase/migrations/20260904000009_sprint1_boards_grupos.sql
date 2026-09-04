-- Sprint 1: boards de mesa (Daily / Weekly), grupos de Basecamp por proyecto, plantillas recurrentes.
alter table mesas
  add column if not exists basecamp_board_daily_id bigint,
  add column if not exists basecamp_board_weekly_id bigint;
alter table proyectos
  add column if not exists basecamp_grupos jsonb not null default '{}'::jsonb;  -- { "Producción": 123456 }
alter table plantillas
  add column if not exists recurrente boolean not null default false,
  add column if not exists patron_nombre text;  -- "{nombre} - {mes} {año}"
update plantillas set recurrente = true, patron_nombre = 'Cronograma de contenido - {mes} {año}' where tipo = 'fee_mensual';
update mesas set basecamp_board_daily_id = 8543459895, basecamp_board_weekly_id = 9569194450 where slug = 'orion';
