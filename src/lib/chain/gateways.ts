/**
 * Donde se leen las cadenas — Chains 01, Stage 5.5.
 *
 * La pagina de la obra enlaza por la primera pasarela de Arweave; el titulo
 * atado (Stage 9) las lleva todas, porque un archivo descargado no se puede
 * actualizar y una pasarela puede cerrar. Una lista, en un solo sitio.
 *
 * ar-io.net, que nombra el spec, no resolvia en DNS al escribir esto
 * (29 sep 2026); se anade cuando responda. Las otras respondieron /info.
 */
export const ARWEAVE_GATEWAYS = [
  'https://arweave.net',
  'https://ardrive.net',
  'https://permagate.io',
  'https://ar-io.dev',
] as const

/** Endpoints publicos de Solana para quien verifica desde fuera. */
export const SOLANA_PUBLIC_ENDPOINTS = ['https://api.mainnet-beta.solana.com'] as const

/** Fuentes de cabeceras de bloque de Bitcoin para comprobar un ancla OTS. */
export const BITCOIN_HEADER_SOURCES = ['https://mempool.space/api', 'https://blockstream.info/api'] as const

/** La URL de un ID de Arweave por la primera pasarela. */
export function arweaveUrl(id: string): string {
  return `${ARWEAVE_GATEWAYS[0]}/${id}`
}
