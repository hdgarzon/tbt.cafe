import { PublicKey } from '@solana/web3.js'

/**
 * Direcciones de tenencia — Chains 01, Stage 4.3.
 *
 * Cada titulo tiene su propia direccion en Solana: la del numero de titulo
 * (TBT ID + indice de dueno, `RRO5501-3`). El token vive ahi mientras ese
 * titulo es el vigente y se mueve a la del siguiente en cada cambio de dueno.
 *
 * El espacio de nombres es el SHA-256 de una etiqueta publica, elegido porque
 * cae FUERA de la curva: un punto fuera de la curva no tiene clave privada, asi
 * que nadie puede firmar por el ni desplegar un programa en el. El spec pedia
 * una clave generada con el secreto destruido; esto cumple lo mismo y ademas
 * cualquiera lo puede comprobar desde la etiqueta, en vez de creer que el
 * secreto se borro. Las etiquetas /0 y /1 caen en la curva y se saltan.
 *
 * Valor fijo en codigo. Se publica en el articulo del Roast para que cualquiera
 * derive la direccion de un titulo desde su numero.
 */
export const HOLDING_NAMESPACE_TAG = 'tbt.cafe/holding-namespace/v1/2'

export const HOLDING_NAMESPACE = new PublicKey('F9ieqDeu9tk2eBeMLXdRdtyagHVhdR9uNbqqJBjPgg3q')

const TITLE_NUMBER = /^[A-Z0-9]+-[1-9][0-9]*$/

/** La direccion de tenencia del titulo `titleNumber`. Sin clave: nadie la firma. */
export function holdingAddress(titleNumber: string): PublicKey {
  if (!TITLE_NUMBER.test(titleNumber)) {
    throw new Error(`holdingAddress: "${titleNumber}" is not a title number (TBT ID and owner index, e.g. RRO5501-1).`)
  }
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from('tbt-holding'), Buffer.from(titleNumber)],
    HOLDING_NAMESPACE
  )
  return address
}

