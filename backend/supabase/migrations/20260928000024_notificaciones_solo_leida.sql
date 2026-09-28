-- Auditoría de seguridad run-1 (28/09/2026), hallazgo rls:notificaciones_update_propias:delivery-columns-writable.
--
-- La política notificaciones_update_propias deja al dueño de una notificación actualizar TODAS sus columnas por
-- PostgREST: email_destino, titulo, cuerpo, canal, enviada_at, intentos. Con eso podía re-encolar su fila hacia
-- cualquier correo y BackIO la enviaba desde el dominio de Geeks (relay de phishing).
--
-- El backend ya envía siempre al correo actual del usuario (lib/notificaciones, commit de esta auditoría), así que
-- esto es la segunda capa: desde una sesión de usuario solo se puede cambiar leida_at. El backend escribe con
-- service role (auth.uid() es null) y no se ve afectado. Hoy ninguna pantalla actualiza notificaciones.

create or replace function notificaciones_solo_leida() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;  -- service role (backend, cron)
  if (to_jsonb(new) - 'leida_at') is distinct from (to_jsonb(old) - 'leida_at') then
    raise exception 'Solo puedes marcar tus notificaciones como leídas' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_notificaciones_solo_leida on notificaciones;
create trigger trg_notificaciones_solo_leida
  before update on notificaciones
  for each row execute function notificaciones_solo_leida();

-- La política original no tenía WITH CHECK: se recrea para que la fila siga siendo del mismo usuario y tenant.
drop policy if exists notificaciones_update_propias on notificaciones;
create policy notificaciones_update_propias on notificaciones
  for update to authenticated
  using (tenant_id = auth_tenant_id() and usuario_id = auth.uid())
  with check (tenant_id = auth_tenant_id() and usuario_id = auth.uid());
