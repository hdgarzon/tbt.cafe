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

/** Un UUID, en cualquier caja. */
export const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i

/** Un telefono en formato internacional: al menos 8 digitos tras el mas. */
const PHONE_RE = /\+\d[\d\s().-]{7,}/

/**
 * Un par de coordenadas en grados decimales.
 *
 * El spec las marca «Never»: `context_snapshots` las guarda y ahi se quedan.
 * En cadena va la ciudad y el pais, que son buena procedencia y no señalan una
 * casa. Esto no busca en una clave llamada `lat` —para eso ya esta la lista de
 * `records.ts`— sino un par suelto dentro de un texto libre, que es por donde
 * se colaria: el resumen del contexto lo escribe un modelo.
 *
 * Exige decimales en ambos numeros para no confundirse con «12, 40» o con un
 * rango de años.
 */
const COORDS_RE = /-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/

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
