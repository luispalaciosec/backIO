-- Catálogo consolidado de Geeks (Catalogo_Pilares_v3): pilares y familias en plantillas.
alter table plantillas
  add column if not exists pilar text check (pilar in ('Marca','Crecimiento','Transformación','Transversal','Medios')),
  add column if not exists familia text,
  add column if not exists unidad text,               -- proyecto | mes | pieza
  add column if not exists precio_referencia text,
  add column if not exists cliente_id uuid references clientes(id);   -- null = plantilla general; con valor = propia del cliente
create index if not exists idx_plantillas_cliente on plantillas(cliente_id);
-- Las 5 plantillas iniciales se reclasifican
update plantillas set pilar = 'Transversal', familia = 'Creatividad de Campañas', unidad = 'proyecto', precio_referencia = '$850–$3,500' where nombre = 'Campaña 360';
update plantillas set pilar = 'Transversal', familia = 'Creatividad de Campañas', unidad = 'proyecto' where nombre = 'Lanzamiento de producto';
update plantillas set pilar = 'Marca', familia = 'Gestión de Redes Sociales', unidad = 'mes', precio_referencia = '$1,300–$1,800/mes' where nombre = 'Fee mensual';
update plantillas set pilar = 'Transversal', familia = 'Piezas', unidad = 'pieza' where nombre = 'Pieza suelta';
update plantillas set pilar = 'Transversal', familia = 'Kit de Activación POP', unidad = 'pieza', precio_referencia = '$75–$600/pieza' where nombre = 'Trade / Retail';
