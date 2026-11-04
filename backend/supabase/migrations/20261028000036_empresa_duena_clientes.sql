-- Migración 36 · versión reducida del 4/11/2026 (decisión de Luis). Empresa dueña de los fees de AB-Inbev.
--
-- En PrometIO, Cervecería Nacional C.N. es una sola empresa (ahí llegan sus cotizaciones), pero en BackIO y Basecamp su
-- trabajo se lleva en 7 clientes, uno por fee («AB-Inbev ||…»). Con esto, una cotización ganada de C.N. se convierte en
-- proyecto de uno de sus fees, y el aviso le llega a su ejecutiva y a operaciones en lugar de a todas las ejecutivas.
--
-- La versión del 28/10 también trataba «Notion» y los duplicados de PrometIO; ya se resolvieron por otro lado.
-- No cambia políticas RLS.

alter table clientes add column if not exists empresa_id uuid references clientes(id);
create index if not exists idx_clientes_empresa on clientes(tenant_id, empresa_id);

-- Los 7 fees de AB-Inbev → Cervecería Nacional C.N.
update clientes c set empresa_id = cn.id
from clientes cn
where cn.id = '80b2713c-29f1-44ba-938a-01cb6c6d8854'
  and c.tenant_id = cn.tenant_id
  and c.deleted_at is null
  and c.nombre like 'AB-Inbev ||%';

-- C.N. en la mesa Orión, con Grace Franco como ejecutiva, igual que sus fees.
update clientes
set mesa_id = '40000000-0000-4000-8000-000000000001',
    ejecutiva_id = '2c48d188-cd78-4ddc-b1b3-30066a8ca40d'
where id = '80b2713c-29f1-44ba-938a-01cb6c6d8854';

-- Verificación (esperado: 7, Mesa Orión, Grace Franco).
select
  (select count(*) from clientes where empresa_id = '80b2713c-29f1-44ba-938a-01cb6c6d8854' and deleted_at is null) as fees_con_empresa,
  (select m.nombre from clientes c join mesas m on m.id = c.mesa_id where c.id = '80b2713c-29f1-44ba-938a-01cb6c6d8854') as mesa_cn,
  (select u.nombre from clientes c join usuarios u on u.id = c.ejecutiva_id where c.id = '80b2713c-29f1-44ba-938a-01cb6c6d8854') as ejecutiva_cn;
