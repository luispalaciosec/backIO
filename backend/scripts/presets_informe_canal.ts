import 'dotenv/config';
import { serviceClient } from '../src/lib/db/client';
const T = '00000000-0000-4000-8000-000000000001';
async function main() {
  const db = serviceClient();
  const { data: cls } = await db.from('clientes').select('id, nombre').eq('tenant_id', T).eq('activo', true).ilike('nombre', 'AB-Inbev%');
  const c = (cls ?? []) as { id: string; nombre: string }[];
  const id = (re: RegExp) => c.find((x) => re.test(x.nombre))?.id;
  const presets = [
    { id: 'abinbev-off-on-he-eventos', nombre: 'Gráfico TRADE: OFF / ON-HE & Eventos', cliente_ids: [id(/TRADE: OFF/), id(/TRADE: ON/), id(/HIGH END/), id(/EVENTOS/)].filter(Boolean) },
    { id: 'abinbev-kkaa', nombre: 'Gráfico TRADE KKAA: Cadenas & Retail', cliente_ids: [id(/CADENAS/), id(/ECOMM/), id(/MINIMARKETS/)].filter(Boolean) },
  ];
  const { data: t } = await db.from('tenants').select('config').eq('id', T).single();
  const config = { ...((t as { config: Record<string, unknown> }).config ?? {}), informes_canal: presets };
  const { error } = await db.from('tenants').update({ config }).eq('id', T);
  console.log(error ? error.message : JSON.stringify(presets, null, 1));
}
main();
