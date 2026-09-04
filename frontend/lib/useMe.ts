'use client';
import { useEffect, useState } from 'react';
import type { Rol } from '@backio/shared';
import { api } from './api';

export interface MeCliente { rol: Rol | null; usuario_id: string | null; nombre: string }

export function useMe(): MeCliente | null {
  const [me, setMe] = useState<MeCliente | null>(null);
  useEffect(() => { api<MeCliente>('/usuarios/me').then(setMe).catch(() => setMe({ rol: null, usuario_id: null, nombre: '' })); }, []);
  return me;
}
