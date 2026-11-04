-- Migración 44 · 4/11/2026 · tipos de pieza con los nombres del equipo (pedido de Carolina, propuesta aprobada por Luis).
--
-- «Post estático» pasa a llamarse «Gráfica» y «Reel», «Video para reels»; siguen siendo los mismos tipos y sus plantillas
-- no cambian. Se mantiene «Carrusel». Se agregan los que faltaban.
-- Esfuerzo (Gráfica = 1): sale de la mediana de horas del timesheet por to-do al 4/11/2026: gráfica 1,7 h; adaptación 0,5 h
-- (8 tareas); guión 3,5 h (10); animación 3,3 h (22). Spot de campaña es un estimado: solo hay 2 tareas con horas.
-- BackIO reemplaza este esfuerzo por lo que tarda cada persona cuando ya hay tareas registradas con ese tipo.
-- No cambia políticas RLS.

update tipos_pieza set nombre = 'Gráfica' where tenant_id = '00000000-0000-4000-8000-000000000001' and slug = 'post';
update tipos_pieza set nombre = 'Video para reels' where tenant_id = '00000000-0000-4000-8000-000000000001' and slug = 'reel';

insert into tipos_pieza (tenant_id, nombre, slug, esfuerzo, pasos) values
('00000000-0000-4000-8000-000000000001', 'Adaptación gráfica', 'adaptacion', 0.3, '[
  {"titulo":"Adaptación","rol":"Diseñador","dias_offset":2,"peso":1,"visible":false},
  {"titulo":"Revisión de DA","rol":"Director de Arte","dias_offset":1,"peso":0.5,"visible":false},
  {"titulo":"Entrega","rol":"Ejecutiva de cuenta","dias_offset":0,"peso":0.5,"visible":true,"etiqueta":"Entrega"}
]'::jsonb),
('00000000-0000-4000-8000-000000000001', 'Animación', 'animacion', 2, '[
  {"titulo":"Guion de animación","rol":"Content","dias_offset":8,"peso":1,"visible":false},
  {"titulo":"Animación","rol":"Editor","dias_offset":5,"peso":3,"visible":false},
  {"titulo":"Revisión de DA","rol":"Director de Arte","dias_offset":3,"peso":0.5,"visible":false},
  {"titulo":"Aprobación cliente","rol":"Ejecutiva de cuenta","dias_offset":1,"peso":0.5,"visible":true,"etiqueta":"Aprobación","aprobacion_cliente":true}
]'::jsonb),
('00000000-0000-4000-8000-000000000001', 'Guión', 'guion', 2, '[
  {"titulo":"Redacción del guión","rol":"Content","dias_offset":4,"peso":2,"visible":false},
  {"titulo":"Revisión interna","rol":"Director de Arte","dias_offset":3,"peso":0.5,"visible":false},
  {"titulo":"Aprobación cliente","rol":"Ejecutiva de cuenta","dias_offset":1,"peso":0.5,"visible":true,"etiqueta":"Aprobación","aprobacion_cliente":true}
]'::jsonb),
('00000000-0000-4000-8000-000000000001', 'Spot de campaña', 'spot', 10, '[
  {"titulo":"Guion y storyboard","rol":"Content","dias_offset":20,"peso":2,"visible":false},
  {"titulo":"Aprobación de guion","rol":"Ejecutiva de cuenta","dias_offset":17,"peso":0.5,"visible":true,"etiqueta":"Aprobación de guion","aprobacion_cliente":true},
  {"titulo":"Preproducción","rol":"Audiovisual","dias_offset":14,"peso":2,"visible":false},
  {"titulo":"Grabación","rol":"Audiovisual","dias_offset":10,"peso":4,"visible":false},
  {"titulo":"Edición","rol":"Editor","dias_offset":5,"peso":4,"visible":false},
  {"titulo":"Aprobación cliente","rol":"Ejecutiva de cuenta","dias_offset":2,"peso":0.5,"visible":true,"etiqueta":"Aprobación","aprobacion_cliente":true}
]'::jsonb)
on conflict (tenant_id, slug) do update set nombre = excluded.nombre, esfuerzo = excluded.esfuerzo, pasos = excluded.pasos;

-- Verificación (esperado: 7 tipos: Adaptación gráfica, Animación, Carrusel, Gráfica, Guión, Spot de campaña, Video para reels).
select count(*) as tipos, string_agg(nombre, ', ' order by nombre) as nombres
from tipos_pieza where tenant_id = '00000000-0000-4000-8000-000000000001' and activo;
