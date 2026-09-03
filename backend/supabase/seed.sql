-- ============================================================================
-- Seed · Tenant Geeks + 5 plantillas (docs/03-builder.md)
-- Idempotente: usa ids fijos. Ejecutar después de las migraciones.
-- ============================================================================

insert into tenants (id, nombre, slug, config) values (
  '00000000-0000-4000-8000-000000000001',
  'Geeks Ecuador',
  'geeks',
  jsonb_build_object(
    'timezone', 'America/Guayaquil',
    'color_primario', '#0073EA',
    'signal_thresholds', jsonb_build_object(
      'arrastre_reincidente_min', 2,
      'concentracion_carga_pct', 30,
      'bloqueo_cliente_dias', 5,
      'cuenta_silenciosa_dias', 14,
      'sin_movimiento_dias', 14,
      'atraso_critico_dias', 30
    )
  )
) on conflict (id) do update set config = excluded.config;

-- Helper local para insertar plantilla completa desde JSON
create or replace function seed_plantilla(p_tenant uuid, p_id uuid, p_nombre text, p_desc text, p_tipo tipo_plantilla_t, p_bloques jsonb)
returns void language plpgsql as $$
declare
  b jsonb; t jsonb; v_bloque uuid; i int := 0; j int;
begin
  insert into plantillas (id, tenant_id, nombre, descripcion, tipo)
  values (p_id, p_tenant, p_nombre, p_desc, p_tipo)
  on conflict (id) do update set nombre = excluded.nombre, descripcion = excluded.descripcion, tipo = excluded.tipo;

  delete from plantilla_bloques where plantilla_id = p_id;

  for b in select * from jsonb_array_elements(p_bloques) loop
    i := i + 1;
    insert into plantilla_bloques (tenant_id, plantilla_id, nombre, peso, orden, opcional)
    values (p_tenant, p_id, b->>'nombre', (b->>'peso')::numeric, i, coalesce((b->>'opcional')::boolean, false))
    returning id into v_bloque;
    j := 0;
    for t in select * from jsonb_array_elements(b->'tareas') loop
      j := j + 1;
      insert into plantilla_tareas (tenant_id, bloque_id, titulo_interno, etiqueta_cliente, visible_cliente_default, peso_relativo, dias_offset, rol_sugerido, orden)
      values (
        p_tenant, v_bloque,
        t->>'titulo', t->>'etiqueta',
        (t->>'etiqueta') is not null,
        coalesce((t->>'peso')::numeric, 1),
        coalesce((t->>'offset')::int, 0),
        t->>'rol', j
      );
    end loop;
  end loop;
end $$;

-- dias_offset = días ANTES de la fecha de entrega del proyecto.
select seed_plantilla(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Campaña 360',
  'Campaña con múltiples canales. Investigación, creativo, aprobación, producción y entrega.',
  'campana',
  '[
    {"nombre":"Investigación","peso":15,"tareas":[
      {"titulo":"Kickoff interno","offset":45,"rol":"Ejecutiva de cuenta","peso":0.5},
      {"titulo":"Research y benchmark","etiqueta":"Investigación de mercado","offset":40,"rol":"Planner","peso":1}
    ]},
    {"nombre":"Creativo","peso":30,"tareas":[
      {"titulo":"Ruta creativa v1","offset":33,"rol":"Director Creativo","peso":1},
      {"titulo":"Revisión de DA","offset":31,"rol":"Director de Arte","peso":0.5},
      {"titulo":"Ruta creativa v2","offset":28,"rol":"Director Creativo","peso":1},
      {"titulo":"Presentación de concepto","etiqueta":"Propuesta creativa","offset":25,"rol":"Ejecutiva de cuenta","peso":1.5}
    ]},
    {"nombre":"Aprobación","peso":10,"tareas":[
      {"titulo":"Ajustes post-feedback","etiqueta":"Ajustes solicitados","offset":20,"rol":"Director de Arte","peso":1}
    ]},
    {"nombre":"Producción","peso":40,"tareas":[
      {"titulo":"Producción de piezas","etiqueta":"Producción","offset":7,"rol":"Diseñador","peso":2.5},
      {"titulo":"Control de calidad","offset":3,"rol":"Director de Arte","peso":0.5}
    ]},
    {"nombre":"Entrega","peso":5,"tareas":[
      {"titulo":"Entrega final","etiqueta":"Entrega","offset":0,"rol":"Ejecutiva de cuenta","peso":1}
    ]}
  ]'::jsonb
);

select seed_plantilla(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  'Lanzamiento de producto',
  'Producto o servicio nuevo. Research, estrategia, creativo, producción y medición.',
  'lanzamiento',
  '[
    {"nombre":"Research","peso":15,"tareas":[
      {"titulo":"Kickoff interno","offset":60,"rol":"Ejecutiva de cuenta","peso":0.5},
      {"titulo":"Research de categoría y competencia","etiqueta":"Investigación","offset":52,"rol":"Planner","peso":1}
    ]},
    {"nombre":"Estrategia","peso":20,"tareas":[
      {"titulo":"Plataforma estratégica","etiqueta":"Estrategia de lanzamiento","offset":45,"rol":"Planner","peso":1},
      {"titulo":"Revisión interna de estrategia","offset":43,"rol":"Director Creativo","peso":0.3}
    ]},
    {"nombre":"Creativo","peso":25,"tareas":[
      {"titulo":"Concepto creativo v1","offset":35,"rol":"Director Creativo","peso":1},
      {"titulo":"Concepto creativo v2","offset":30,"rol":"Director Creativo","peso":1},
      {"titulo":"Presentación de concepto","etiqueta":"Propuesta creativa","offset":28,"rol":"Ejecutiva de cuenta","peso":1}
    ]},
    {"nombre":"Producción","peso":30,"tareas":[
      {"titulo":"Producción de piezas de lanzamiento","etiqueta":"Producción","offset":10,"rol":"Diseñador","peso":2},
      {"titulo":"Control de calidad","offset":5,"rol":"Director de Arte","peso":0.5},
      {"titulo":"Entrega de piezas","etiqueta":"Entrega","offset":3,"rol":"Ejecutiva de cuenta","peso":0.5}
    ]},
    {"nombre":"Medición","peso":10,"opcional":true,"tareas":[
      {"titulo":"Reporte de lanzamiento","etiqueta":"Reporte de resultados","offset":-14,"rol":"Content","peso":1}
    ]}
  ]'::jsonb
);

select seed_plantilla(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003',
  'Fee mensual',
  'Contenido recurrente. Planificación, producción, publicación y reporte.',
  'fee_mensual',
  '[
    {"nombre":"Planificación","peso":20,"tareas":[
      {"titulo":"Calendario de contenidos","etiqueta":"Calendario de contenidos","offset":28,"rol":"Content","peso":1},
      {"titulo":"Aprobación interna de calendario","offset":26,"rol":"Ejecutiva de cuenta","peso":0.3}
    ]},
    {"nombre":"Producción","peso":50,"tareas":[
      {"titulo":"Copies del mes","offset":20,"rol":"Content","peso":1},
      {"titulo":"Diseño de piezas","etiqueta":"Piezas del mes","offset":14,"rol":"Diseñador","peso":2},
      {"titulo":"Revisión de DA","offset":12,"rol":"Director de Arte","peso":0.5}
    ]},
    {"nombre":"Publicación","peso":20,"tareas":[
      {"titulo":"Programación en plataformas","etiqueta":"Publicación","offset":7,"rol":"Community Manager","peso":1}
    ]},
    {"nombre":"Reporte","peso":10,"opcional":true,"tareas":[
      {"titulo":"Reporte mensual","etiqueta":"Reporte mensual","offset":0,"rol":"Content","peso":1}
    ]}
  ]'::jsonb
);

select seed_plantilla(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000004',
  'Pieza suelta',
  'Requerimiento aislado. Brief, producción y entrega.',
  'pieza_suelta',
  '[
    {"nombre":"Brief","peso":15,"tareas":[
      {"titulo":"Brief interno","offset":7,"rol":"Ejecutiva de cuenta","peso":1}
    ]},
    {"nombre":"Producción","peso":70,"tareas":[
      {"titulo":"Diseño","etiqueta":"Producción","offset":2,"rol":"Diseñador","peso":2},
      {"titulo":"Revisión de DA","offset":1,"rol":"Director de Arte","peso":0.5}
    ]},
    {"nombre":"Entrega","peso":15,"tareas":[
      {"titulo":"Entrega","etiqueta":"Entrega","offset":0,"rol":"Ejecutiva de cuenta","peso":1}
    ]}
  ]'::jsonb
);

select seed_plantilla(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000005',
  'Trade / Retail',
  'Material POP y cadenas. Brief, diseño, artes finales y entrega.',
  'trade',
  '[
    {"nombre":"Brief","peso":10,"tareas":[
      {"titulo":"Brief y especificaciones de cadena","offset":14,"rol":"Ejecutiva de cuenta","peso":1}
    ]},
    {"nombre":"Diseño","peso":40,"tareas":[
      {"titulo":"Propuesta de diseño POP","etiqueta":"Propuesta de diseño","offset":9,"rol":"Diseñador","peso":1.5},
      {"titulo":"Revisión de DA","offset":8,"rol":"Director de Arte","peso":0.5}
    ]},
    {"nombre":"Artes finales","peso":40,"tareas":[
      {"titulo":"Artes finales por formato","etiqueta":"Artes finales","offset":3,"rol":"Diseñador","peso":2},
      {"titulo":"Control de calidad de impresión","offset":2,"rol":"Director de Arte","peso":0.5}
    ]},
    {"nombre":"Entrega","peso":10,"tareas":[
      {"titulo":"Entrega a imprenta / cadena","etiqueta":"Entrega","offset":0,"rol":"Ejecutiva de cuenta","peso":1}
    ]}
  ]'::jsonb
);

drop function seed_plantilla(uuid, uuid, text, text, tipo_plantilla_t, jsonb);

-- Mapeo servicios PrometIO → plantillas (docs/08)
insert into mapeo_servicios (tenant_id, servicio_prometio, plantilla_id) values
  ('00000000-0000-4000-8000-000000000001', 'Campaña 360',             '10000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000001', 'Lanzamiento de producto', '10000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000001', 'Fee mensual',             '10000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000000001', 'Pieza suelta',            '10000000-0000-4000-8000-000000000004'),
  ('00000000-0000-4000-8000-000000000001', 'Trade',                   '10000000-0000-4000-8000-000000000005')
on conflict (tenant_id, servicio_prometio) do update set plantilla_id = excluded.plantilla_id;
