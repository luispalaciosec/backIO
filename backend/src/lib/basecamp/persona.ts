/**
 * Cuenta de Basecamp de cada persona (migración 33). Lo que alguien hace desde BackIO sale a su nombre en Basecamp
 * solo si conecta SU cuenta: la identidad de Basecamp tiene que ser la persona enlazada en BackIO
 * (usuarios.basecamp_user_id) o, si todavía no estaba enlazada, la del mismo correo.
 */
import type { BasecampAuthInfo } from './oauth';

export type ResultadoIdentidad = { ok: true; enlazar: boolean } | { ok: false; motivo: string };

/** ¿La cuenta de Basecamp que se autorizó es de esta persona? `enlazar`: hay que guardar su basecamp_user_id. */
export function validarIdentidadPersona(
  usuario: { email: string; activo: boolean; basecamp_user_id: number | null },
  identidad: BasecampAuthInfo['identity'],
): ResultadoIdentidad {
  if (!usuario.activo) return { ok: false, motivo: 'Tu usuario de BackIO no está activo' };
  if (usuario.basecamp_user_id !== null) {
    return usuario.basecamp_user_id === identidad.id
      ? { ok: true, enlazar: false }
      : {
          ok: false,
          motivo: `Autorizaste la cuenta de Basecamp de ${identidad.email_address}, que no es la tuya. Cierra esa sesión en Basecamp y vuelve a intentar con tu cuenta.`,
        };
  }
  return usuario.email.toLowerCase() === identidad.email_address.toLowerCase()
    ? { ok: true, enlazar: true }
    : {
        ok: false,
        motivo: `Tu correo en BackIO (${usuario.email}) no coincide con el de la cuenta de Basecamp (${identidad.email_address}). Pide a un admin que te enlace en Admin → Usuarios.`,
      };
}
