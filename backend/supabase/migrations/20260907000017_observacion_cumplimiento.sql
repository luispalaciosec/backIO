-- Observación libre en reprocesos y reprogramaciones (pedido de Luis 07/09/2026).
-- Es texto escrito en BackIO por el equipo (no viene de Basecamp). Nunca llega al portal del cliente.
alter table reprocesos add column if not exists observacion text;
alter table reprogramaciones add column if not exists observacion text;
