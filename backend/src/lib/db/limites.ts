/** Contadores persistentes del límite de peticiones (`limites`, migración 28; lib/limite). */
import { serviceClient } from './client';

/** Borra el contador de una clave. Propaga el error de red; el llamador decide si lo ignora. */
export async function borrarContadorLimite(clave: string): Promise<void> {
  await serviceClient().from('limites').delete().eq('clave', clave);
}
