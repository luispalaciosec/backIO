-- ============================================================================
--  ZONA DE REVISIÓN HUMANA OBLIGATORIA  (CLAUDE.md · Políticas RLS)
--  Un error aquí expone datos entre tenants. Revisar antes de aplicar.
-- ============================================================================
--
-- Modelo:
--   · auth_tenant_id()  → tenant del usuario autenticado (Supabase Auth).
--   · auth_rol()        → rol del usuario autenticado.
--   · service_role (backend con API key) bypass RLS; el backend filtra por
--     tenant explícitamente en lib/db (nunca hace queries sin tenant_id).
--   · Colaboradores: solo leen requerimientos asignados a ellos.
--   · Escrituras: solo roles de gestión (admin, gerencia, operaciones, ejecutiva, lider).
--   · tenants: cada usuario ve solo su tenant. Nadie escribe tenants desde cliente.
--
-- Verificación obligatoria (docs/09 · Fase 0): crear tenant B con un usuario e
-- intentar leer datos del tenant Geeks. Debe devolver 0 filas.
-- ============================================================================

-- Funciones helper auth_*() definidas en 20260903000001_fase0_schema.sql

-- ---------------------------------------------------------------- tenants
create policy tenants_select on tenants
  for select to authenticated using (id = auth_tenant_id());
create policy tenants_update_admin on tenants
  for update to authenticated using (id = auth_tenant_id() and auth_es_admin());

-- ---------------------------------------------------------------- usuarios
create policy usuarios_select on usuarios
  for select to authenticated using (tenant_id = auth_tenant_id());
create policy usuarios_update_self on usuarios
  for update to authenticated
  using (tenant_id = auth_tenant_id() and (id = auth.uid() or auth_es_admin()))
  with check (tenant_id = auth_tenant_id());
create policy usuarios_insert_admin on usuarios
  for insert to authenticated with check (tenant_id = auth_tenant_id() and auth_es_admin());

-- ---------------------------------------------------------------- clientes
create policy clientes_select on clientes
  for select to authenticated using (tenant_id = auth_tenant_id());
create policy clientes_write on clientes
  for all to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_gestion())
  with check (tenant_id = auth_tenant_id() and auth_es_gestion());

-- ---------------------------------------------------------------- plantillas
create policy plantillas_select on plantillas
  for select to authenticated using (tenant_id = auth_tenant_id());
create policy plantillas_write on plantillas
  for all to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_gestion())
  with check (tenant_id = auth_tenant_id() and auth_es_gestion());

create policy plantilla_bloques_select on plantilla_bloques
  for select to authenticated using (tenant_id = auth_tenant_id());
create policy plantilla_bloques_write on plantilla_bloques
  for all to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_gestion())
  with check (tenant_id = auth_tenant_id() and auth_es_gestion());

create policy plantilla_tareas_select on plantilla_tareas
  for select to authenticated using (tenant_id = auth_tenant_id());
create policy plantilla_tareas_write on plantilla_tareas
  for all to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_gestion())
  with check (tenant_id = auth_tenant_id() and auth_es_gestion());

-- ---------------------------------------------------------------- proyectos
create policy proyectos_select on proyectos
  for select to authenticated using (tenant_id = auth_tenant_id());
create policy proyectos_write on proyectos
  for all to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_gestion())
  with check (tenant_id = auth_tenant_id() and auth_es_gestion());

create policy proyecto_borradores_select on proyecto_borradores
  for select to authenticated using (tenant_id = auth_tenant_id() and auth_es_gestion());
create policy proyecto_borradores_write on proyecto_borradores
  for all to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_gestion())
  with check (tenant_id = auth_tenant_id() and auth_es_gestion());

-- ---------------------------------------------------------------- requerimientos
-- Gestión ve todo el tenant; colaborador solo lo asignado a él.
create policy requerimientos_select on requerimientos
  for select to authenticated using (
    tenant_id = auth_tenant_id()
    and (auth_es_gestion() or auth.uid() = any(owner_agencia))
  );
create policy requerimientos_insert on requerimientos
  for insert to authenticated with check (tenant_id = auth_tenant_id() and auth_es_gestion());
-- Colaborador puede actualizar SOLO estado operativo de lo suyo (la UI restringe columnas;
-- el trigger de visibilidad monotónica impide abrir visible_cliente en cualquier caso).
create policy requerimientos_update on requerimientos
  for update to authenticated
  using (tenant_id = auth_tenant_id() and (auth_es_gestion() or auth.uid() = any(owner_agencia)))
  with check (tenant_id = auth_tenant_id());
-- Sin DELETE físico: soft delete vía update de deleted_at.

-- ---------------------------------------------------------------- notas_cuenta
create policy notas_cuenta_select on notas_cuenta
  for select to authenticated using (tenant_id = auth_tenant_id() and auth_es_gestion());
create policy notas_cuenta_insert on notas_cuenta
  for insert to authenticated
  with check (tenant_id = auth_tenant_id() and auth_es_gestion() and autor_id = auth.uid());

-- ---------------------------------------------------------------- rituales
create policy semanas_select on semanas
  for select to authenticated using (tenant_id = auth_tenant_id());
create policy semanas_write on semanas
  for all to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_gestion())
  with check (tenant_id = auth_tenant_id() and auth_es_gestion());

create policy senales_select on senales
  for select to authenticated using (tenant_id = auth_tenant_id());
create policy senales_write on senales
  for all to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_gestion())
  with check (tenant_id = auth_tenant_id() and auth_es_gestion());

create policy acuerdos_select on acuerdos
  for select to authenticated using (tenant_id = auth_tenant_id());
create policy acuerdos_write on acuerdos
  for all to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_gestion())
  with check (tenant_id = auth_tenant_id() and auth_es_gestion());

create policy actas_select on actas
  for select to authenticated using (tenant_id = auth_tenant_id());
create policy actas_write on actas
  for all to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_gestion())
  with check (tenant_id = auth_tenant_id() and auth_es_gestion());

create policy mapeo_servicios_select on mapeo_servicios
  for select to authenticated using (tenant_id = auth_tenant_id());
create policy mapeo_servicios_write on mapeo_servicios
  for all to authenticated
  using (tenant_id = auth_tenant_id() and auth_es_admin())
  with check (tenant_id = auth_tenant_id() and auth_es_admin());

-- El rol anon NO tiene ninguna política: el portal público pasa por el backend
-- (service role + sanitizeForClient), nunca por PostgREST directo.
