import { supabase } from '@/lib/supabase'

/**
 * La escalera de autenticación — Backend Spec 01 §5.1.
 *
 *   por debajo de $500   solo scoring de Radar, sin fricción añadida
 *   $500 y más           biométrico
 *   $1.000 y más         biométrico + 3D Secure
 *
 * Aplica a compradores Y a vendedores: aceptar una oferta e iniciar una
 * transferencia entran por el escalón de $500. Cobrar un payout y cambiar el
 * destino exigen biométrico + código privado SIEMPRE, sin umbral.
 *
 * Lo que consigue cada factor es distinto, y el spec insiste porque se
 * confunde (§5.2):
 *
 *   3D Secure    traslada la responsabilidad del fraude al banco EMISOR. Es la
 *                única medida que mueve responsabilidad, y la razón de que
 *                exista el escalón de $1.000.
 *   Biométrico   prueba a tbt.cafe que el dueño del dispositivo aprobó la
 *                acción. El emisor no queda obligado: sirve contra el secuestro
 *                de cuenta y como evidencia en disputas (§5.4).
 *   Código priv. es lo único que un teléfono robado y desbloqueado no puede
 *                aportar, y por eso guarda el destino del dinero.
 *
 * ESTE ARCHIVO NO ES LA AUTORIDAD. Calcula lo mismo que la función SQL
 * `resolve_auth_ladder` para que la UI sepa qué pedir antes de pedirlo, pero
 * quien manda es el servidor. Una comprobación que el cliente puede afirmar
 * por su cuenta no es una comprobación — la 018 de este repo existe porque esa
 * lección ya costó una vez.
 */

export type MoneyAction =
  | 'purchase'
  | 'offer_accept'
  | 'transfer_initiate'
  | 'payout_collect'
  | 'payout_destination'

/** Las dos acciones que no miran el monto: el dinero saliendo de la plataforma. */
const UNCONDITIONAL: MoneyAction[] = ['payout_collect', 'payout_destination']

export type LadderThresholds = {
  biometric: number
  threeDS: number
}

/**
 * Si la configuracion no se puede leer, se pide todo: un fallo de red no debe
 * abrir la puerta, y los valores viven solo en `platform_config` (Work Order
 * 02, 1.2). El servidor decide igual por su cuenta.
 */
const STRICTEST: LadderThresholds = { biometric: 0, threeDS: 0 }

export type LadderRequirement = {
  biometric: boolean
  threeDS: boolean
  privateCode: boolean
  /** Los umbrales con los que se decidió, para poder congelarlos al registrar. */
  thresholds: LadderThresholds
}

/**
 * Qué exige una acción de dinero.
 *
 * `amount` puede ser null en las acciones incondicionales, donde no se mira.
 * Una transferencia de valor cero sigue siendo una transferencia: cae por
 * debajo del umbral y no añade fricción, que es lo correcto — el emisor ya ve
 * el costo completo antes de confirmar (§2.3).
 */
export function resolveLadder(
  action: MoneyAction,
  amount: number | null,
  thresholds: LadderThresholds
): LadderRequirement {
  if (UNCONDITIONAL.includes(action)) {
    return { biometric: true, threeDS: false, privateCode: true, thresholds }
  }

  const value = amount ?? 0
  return {
    biometric: value >= thresholds.biometric,
    threeDS: value >= thresholds.threeDS,
    privateCode: false,
    thresholds,
  }
}

/** Umbrales vigentes. Si la lectura falla, los mas estrictos. */
export async function fetchLadderThresholds(): Promise<LadderThresholds> {
  const { data, error } = await supabase
    .from('platform_config')
    .select('biometric_threshold, three_ds_threshold')
    .maybeSingle()

  if (error || !data) return STRICTEST
  const biometric = Number(data.biometric_threshold)
  const threeDS = Number(data.three_ds_threshold)
  if (!Number.isFinite(biometric) || !Number.isFinite(threeDS)) return STRICTEST
  return { biometric, threeDS }
}

/* ──────────────────────────────────────────────────────────────────────────
   Costuras: reglas del §5.1 cuyos valores el spec deja SIN decidir (§9).

   No se inventan aquí. Cada una endurece la escalera —nunca la relaja—, así
   que mientras no existan, la escalera es la de los dos umbrales y nada más.

     · Comprador nuevo (§9.1)
       Umbral más bajo en las primeras transacciones. Falta decidir el valor y
       qué cuenta como "nuevo": ¿primeras N transacciones? ¿antigüedad de la
       cuenta?

     · Score de Radar elevado (§5.1)
       3DS sea cual sea el monto. Necesita Radar conectado, y su sintaxis de
       reglas está en §8 como pendiente de verificar contra la documentación
       viva de Stripe.

     · Límites de velocidad (§5.5, §9.2)
       Tope de compras, ofertas y cobros por hora y por día. Atrapa lo que los
       umbrales por transacción no ven — diez compras de $400 pasan limpias
       hoy. Los valores están sin decidir.

     · Re-autenticación por inactividad (§5.5, §9.3)
       Biométrico en la siguiente acción de dinero tras una sesión ociosa, sea
       cual sea el monto. Falta decidir el periodo.

   Cuando se decidan, entran por aquí: `resolveLadder` recibiría un contexto
   —antigüedad del comprador, score, conteos recientes— y podría subir lo
   exigido. La firma ya lo admite sin romper a quien la llama.
   ────────────────────────────────────────────────────────────────────────── */
