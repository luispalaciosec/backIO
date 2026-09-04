-- Aprobada por Luis y aplicada el 04/09/2026 (zona de revisión humana: políticas RLS).
-- Hoy un colaborador solo LEE los requerimientos donde está en owner_agencia. Eso hace que en
-- Proyectos vea "0 tareas" y avance 0 %, y que en el backlog solo vea lo suyo.
-- Cambio: el colaborador lee todo el backlog del tenant (es equipo interno; titulo_interno ya es interno),
-- pero sigue sin poder escribir salvo sus propias tareas (política de update sin cambios;
-- el backend además acota los campos a estado, fecha de entrega y entregables).
drop policy if exists requerimientos_select on requerimientos;
create policy requerimientos_select on requerimientos
  for select to authenticated using (tenant_id = auth_tenant_id());
