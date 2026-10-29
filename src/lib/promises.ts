/**
 * Las promesas — Work Order 02 §3 ("never in configuration") y Amendment
 * Delivery 01, Stage 1.
 *
 * Lo que tbt.cafe promete y no cambia ningun operador. Viven aqui y NO en
 * platform_config: una promesa que se puede apagar desde un panel, aunque
 * nadie la apague, ya no es una promesa. No aparecen en la herramienta de
 * administracion ni desactivadas (`RULE_AUTHORITY` no las nombra, y
 * `check:delivery` falla si alguna llega alli).
 *
 * Este objeto no decide nada por si solo: cada promesa se cumple en el codigo
 * o en la base que se indica. Esta lista existe para que se puedan leer juntas
 * y para que quitar una sea un cambio de codigo revisado, no un clic.
 */
export const PROMISES = Object.freeze({
  /** El royalty se fija en cualquier cambio de dueno y no se edita (060, lock_royalty). */
  royaltyLock: 'The royalty locks at any change of ownership, including a gift at zero value, and is never edited.',
  /** Se descuenta de lo que recibe quien vende; nunca se suma al precio (fees.ts, saleQuote). */
  royaltyFromProceeds: 'The royalty is deducted from the seller’s proceeds, never added to the buyer’s price.',
  /** La propiedad no se revierte: una devolucion es un movimiento nuevo (8.4, restoring). */
  ownershipNeverReversed: 'Ownership is never reversed; a restoring title is its own change of ownership.',
  /** Ningun reembolso es automatico (8.2, dos aprobaciones). */
  refundsNeverAutomatic: 'Refunds are never automatic; an operator acts on a ticket.',
  /** Cobrar o cambiar el destino pide codigo privado y biometria (Payout Methods). */
  factorsAtCollection: 'The private code and biometric are required at collection and at a destination change.',
  /** Los avisos protectores no se apagan (notify.ts, ALWAYS_ON). */
  unsilenceableNotices: 'Protective notifications cannot be turned off.',

  // ── Decision 94, Amendment Delivery 01 ──────────────────────────────────────
  /** tbt.cafe responde por la venta y el TBT; la obra fisica, su entrega y su estado son de comprador y vendedor. */
  physicalWorkIsTheSellers: 'tbt.cafe is responsible for the sale and the TBT, never the physical work: its delivery, its condition and any complaint about it are between buyer and seller.',
  /** Solo en la via de plataforma, y solo con "entregamelo", se retiene la ganancia de la venta (079). */
  deliveryHoldPlatformPathOnly: 'Payment is held for delivery details on the platform path only, and only when the buyer asked for delivery. On the direct path nothing is held.',
  /** Comprador y vendedor aceptan estos terminos una vez, no en cada venta (terms_acceptances.kind). */
  termsAcceptedOnce: 'Buyers accept these terms once, at their first purchase, and sellers once, at their first listing.',
})

export type PromiseKey = keyof typeof PROMISES
