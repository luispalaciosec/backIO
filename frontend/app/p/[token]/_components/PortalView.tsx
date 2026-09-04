'use client';
import { useCallback, useEffect, useState } from 'react';
import type { ClientSafeProject } from '@backio/shared';
import { apiPortal, ApiError } from '@/lib/api';
import { VistaCliente } from '@/components/VistaCliente';
import { ResumenEjecutivo } from './ResumenEjecutivo';

type Payload = ClientSafeProject & { cliente: { nombre: string; logo_url: string | null; color_primario: string | null } };

export function PortalView({ token }: { token: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'pin' | 'no_disponible'>('cargando');
  const [pin, setPin] = useState('');

  const cargar = useCallback(async (p?: string) => {
    try {
      setData(await apiPortal<Payload>(`/${token}`, {}, p));
      setEstado('ok');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setEstado('pin');
      else setEstado('no_disponible');
    }
  }, [token]);
  useEffect(() => { void cargar(); }, [cargar]);

  if (estado === 'cargando') return <div className="text-center text-gray-500 py-20">Cargando…</div>;
  if (estado === 'no_disponible')
    return <div className="card p-10 text-center text-gray-600">Este enlace no está disponible. Si crees que es un error, escríbenos a tu ejecutiva de cuenta en Geeks.</div>;
  if (estado === 'pin')
    return (
      <form className="card p-8 space-y-3 max-w-xs mx-auto" onSubmit={(e) => { e.preventDefault(); void cargar(pin); }}>
        <div className="font-semibold">Ingresa el PIN del proyecto</div>
        <input className="input text-center tracking-[0.5em]" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} />
        <button className="btn-primary w-full">Entrar</button>
      </form>
    );
  if (!data) return null;
  return (
    <VistaCliente data={data} clienteNombre={data.cliente.nombre} logoUrl={data.cliente.logo_url} color={data.cliente.color_primario ?? '#0073EA'}>
      <div className="px-5 pb-5"><ResumenEjecutivo token={token} pin={pin || undefined} /></div>
      <div className="px-5 pb-4 text-[11px] text-gray-400 text-center">Geeks Ecuador · BackIO</div>
    </VistaCliente>
  );
}
