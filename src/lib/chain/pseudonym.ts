/**
 * Nadie identificable llega a Arweave.
 *
 * Chain Spec 01, Item 10. Su aviso es la razon de este archivo:
 *
 *   Arweave no se puede borrar. Por nadie. Nunca. Si un telefono, un correo,
 *   el nombre legal de un comprador o una coordenada precisa llegan alli, ese
 *   dato es publico de forma permanente y ninguna solicitud de supresion se
 *   puede atender. No hay camino de correccion ni de retirada.
 *
 * La linea que traza el spec: los identificadores SEUDONIMOS y la reclamacion
 * de autoria van en cadena. Lo que identifica a una persona viva se queda en
 * Supabase.
 */
import { createHash } from 'crypto'
import { UUID_RE, EMAIL_RE, PHONE_RE, COORDS_RE } from './identifier-patterns'

export { UUID_RE }

/**
 * El seudonimo de una persona.
 *
 * El spec es explicito: «Pseudonymous only. cr_8812, never the Supabase UUID
 * and never an email». Un UUID no es un nombre, pero es un identificador
 * estable que enlaza el registro publico con la fila privada — y publicado en
 * un almacen permanente ese enlace ya no se deshace.
 *
 * SIN SAL, Y A PROPOSITO
 *
 * La cadena de procedencia enlaza a la misma persona entre eventos, asi que el
 * seudonimo tiene que ser el mismo para siempre. Una sal en variable de entorno
 * lo haria depender de un secreto que, perdido o rotado, partiria cadenas ya
 * publicadas que nadie puede reescribir. El UUID no es adivinable ni
 * enumerable; el hash basta.
 *
 * UN SOLO PREFIJO, SIN PAPEL
 *
 * `cr_` para todos. Codificar el papel —creador, coleccionista— daria dos
 * seudonimos a quien vende su propia obra, y el enlace entre sus registros se
 * perderia justo donde mas importa.
 */
export function pseudonymFor(userId: string): string {
  if (!userId) throw new Error('pseudonym: falta el identificador.')
  return 'cr_' + createHash('sha256').update(userId).digest('hex').slice(0, 12)
}

/**
 * Lanza si el registro contiene algo que no puede publicarse.
 *
 * Se comprueba sobre el VALOR, no sobre el nombre de la clave. Una lista de
 * claves prohibidas —que `records.ts` tambien tiene— no atrapa un correo
 * escrito dentro de un texto libre, ni un UUID que llegue por una clave con
 * otro nombre. Aqui se mira lo que de verdad se va a subir.
 *
 * Lanza en vez de limpiar: quitar el dato en silencio publicaria un registro
 * distinto del que quien llama creia estar publicando, y eso tampoco se puede
 * deshacer.
 */
export function assertNoIdentifiers(record: unknown): void {
  const text = JSON.stringify(record) ?? ''

  if (UUID_RE.test(text)) {
    throw new Error(
      'chain: el registro contiene un UUID. Arweave es permanente — usa pseudonymFor().'
    )
  }
  if (EMAIL_RE.test(text)) {
    throw new Error('chain: el registro contiene un correo. No puede publicarse.')
  }
  if (PHONE_RE.test(text)) {
    throw new Error('chain: el registro contiene un telefono. No puede publicarse.')
  }
  if (COORDS_RE.test(text)) {
    throw new Error(
      'chain: el registro contiene coordenadas. En cadena va la ciudad, nunca el punto.'
    )
  }
}
