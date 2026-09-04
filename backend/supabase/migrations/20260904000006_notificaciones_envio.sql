-- Reintentos y trazabilidad de envío de notificaciones.
alter table notificaciones
  add column if not exists email_destino text,
  add column if not exists intentos int not null default 0,
  add column if not exists ultimo_error text;
create index if not exists idx_notif_pendientes on notificaciones(created_at) where enviada_at is null and canal = 'email';
