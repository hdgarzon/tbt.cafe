/**
 * Anclar un hash a Bitcoin — Chain Spec 01, Item 8.
 *
 * QUE PRUEBA Y QUE NO
 *
 * Los servidores de calendario de OpenTimestamps agregan hashes de muchos
 * remitentes en un arbol de Merkle y solo comprometen la raiz en una
 * transaccion de Bitcoin. Por eso el servicio es gratis y por eso la
 * confirmacion tarda horas y no segundos.
 *
 * Prueba que un registro existia en un momento y que no se ha alterado desde
 * entonces. NO pone el registro en Bitcoin y no se puede navegar: la
 * afirmacion queda anclada a Bitcoin, nunca es un NFT de Bitcoin.
 *
 * LA ESPERA NO ES UN ERROR
 *
 * Un ancla pendiente es un estado de producto normal. La entrega del
 * certificado no espera jamas a la confirmacion, y la pagina de la obra la
 * muestra en voz baja porque se resuelve sola.
 */
/*
 * El objeto entero, no sus funciones sueltas: `stamp` y compañía son metodos
 * que usan `this` por dentro. Desestructurarlos da
 * "Cannot read properties of undefined (reading 'makeMerkleTree')", que solo
 * aparece al ejecutarlo — compila igual de bien.
 */
import OpenTimestamps, { DetachedTimestampFile, Ops } from 'javascript-opentimestamps'

export type UpgradeResult = { upgraded: boolean; proof: Buffer; blockHeight?: number }
export type VerifyResult = { blockHeight: number; timestamp: string }

/**
 * `recordHash` devuelve hex pelado, pero el resto del sistema escribe los
 * hashes con prefijo (`sha256:…` en `content_hash`). Se aceptan los dos para
 * que quien llame no tenga que acordarse de cual le toca.
 */
function hashBytes(hashHex: string): number[] {
  const hex = hashHex.replace(/^sha256:/i, '').trim()
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(`ots: se esperaba un sha256 en hex, no '${hashHex.slice(0, 24)}…'`)
  }
  return Array.from(Buffer.from(hex, 'hex'))
}

function detachedFor(hashHex: string): DetachedTimestampFile {
  return DetachedTimestampFile.fromHash(new Ops.OpSHA256(), hashBytes(hashHex))
}

/**
 * Envia el hash a los calendarios y devuelve la prueba INCOMPLETA.
 *
 * Se guarda inmediatamente con estado pendiente. La prueba incompleta ya vale:
 * sin ella no hay nada que actualizar despues, y el ancla sin su prueba no
 * sirve para nada.
 */
export async function stamp(hashHex: string): Promise<Buffer> {
  const detached = detachedFor(hashHex)
  await OpenTimestamps.stamp([detached])
  return Buffer.from(detached.serializeToBytes())
}

/**
 * Pregunta a los calendarios si el ancla ya entro en un bloque.
 *
 * Devuelve `upgraded: false` cuando aun no — que es lo normal durante horas, y
 * no un fallo. La prueba vuelve siempre, cambiada o no, para que quien llame
 * la guarde sin ramificar.
 */
export async function upgrade(proof: Buffer): Promise<UpgradeResult> {
  const detached = DetachedTimestampFile.deserialize(new Uint8Array(proof))
  const changed = await OpenTimestamps.upgrade(detached)
  const upgradedProof = Buffer.from(detached.serializeToBytes())

  if (!changed) return { upgraded: false, proof: upgradedProof }

  // Cambio, pero eso no garantiza que ya este en un bloque: puede haber
  // avanzado en el calendario sin llegar a Bitcoin. La altura la da verify.
  try {
    const attestations = await OpenTimestamps.verify(detached, detachedForProof(detached))
    const bitcoin = attestations.bitcoin
    return { upgraded: true, proof: upgradedProof, blockHeight: bitcoin?.height }
  } catch {
    return { upgraded: true, proof: upgradedProof }
  }
}

/** El original que `verify` compara: el mismo hash, sin sello. */
function detachedForProof(stamped: DetachedTimestampFile): DetachedTimestampFile {
  const hex = Buffer.from(
    (stamped as unknown as { timestamp: { msg: number[] } }).timestamp.msg
  ).toString('hex')
  return detachedFor(hex)
}

/**
 * Comprueba la prueba contra el hash y devuelve donde quedo anclada.
 *
 * Lanza si no hay atestacion de bitcoin: una prueba que aun no llego a un
 * bloque no tiene altura, y devolver cero seria afirmar un ancla que no
 * existe.
 */
export async function verify(proof: Buffer, hashHex: string): Promise<VerifyResult> {
  const stamped = DetachedTimestampFile.deserialize(new Uint8Array(proof))
  const attestations = await OpenTimestamps.verify(stamped, detachedFor(hashHex))
  const bitcoin = attestations.bitcoin

  if (!bitcoin) {
    throw new Error('ots: la prueba todavia no tiene atestacion de bitcoin.')
  }

  return {
    blockHeight: bitcoin.height,
    timestamp: new Date(bitcoin.timestamp * 1000).toISOString(),
  }
}

/**
 * Sella el hash y lo deja anotado. No lanza nunca.
 *
 * Item 8: «Anchor latency is a product state, not an error». Y el Item 6 lo
 * dice para este paso concreto: que falle NO es un error. Un ancla ausente se
 * arregla volviendo a sellar; una certificacion caida por culpa de un
 * calendario lento, no.
 *
 * Idempotente por la clave: el hash es la clave primaria, asi que un segundo
 * intento sobre el mismo registro no duplica ni pisa una prueba ya
 * actualizada.
 */
/**
 * Un Buffer como `bytea`, y de vuelta.
 *
 * EL FALLO QUE ESTO ARREGLA
 *
 * `ots_proof: proof` con un Buffer de Node parece obvio y no lo es: el cliente
 * de Supabase lo pasa por `JSON.stringify`, que a un Buffer lo convierte en
 * `{"type":"Buffer","data":[0,79,112,...]}`. Eso es lo que acababa dentro de la
 * columna — el texto del JSON, no la prueba.
 *
 * Al leerlo de vuelta, `DetachedTimestampFile.deserialize` lanzaba:
 *
 *   Error [BadMagicError]: 0,79,112,101,110,84,105,109,101,115,116,97,109,112,115,...
 *
 * y esos numeros no eran una cabecera rota: eran el principio del array `data`.
 * La prueba estaba entera ahi dentro, envuelta y por eso ilegible.
 *
 * Consecuencia: NINGUN ancla podia confirmarse nunca. La capa de Bitcoin
 * sellaba, guardaba, y no podia volver a abrir lo que habia guardado.
 *
 * `\x<hex>` es el formato de entrada de bytea que Postgres entiende, y es lo
 * que PostgREST le pasa tal cual.
 */
export const toBytea = (buf: Buffer): string => '\\x' + buf.toString('hex')

/** Lo que PostgREST devuelve de una columna bytea: `\x` y hex. */
export const fromBytea = (raw: string): Buffer =>
  Buffer.from(raw.startsWith('\\x') ? raw.slice(2) : raw, 'hex')

export async function anchorRecord(
  recordHash: string,
  kind: 'registration' | 'provenance' | 'amendment',
  recordUri?: string
): Promise<void> {
  try {
    const { createAdminClient } = await import('@/lib/supabase-admin')
    const proof = await stamp(recordHash)

    const { error } = await createAdminClient()
      .from('chain_anchors')
      .insert({
        record_hash: recordHash.replace(/^sha256:/i, ''),
        record_kind: kind,
        record_uri: recordUri ?? null,
        ots_proof: toBytea(proof),
      })

    // 23505 es la clave duplicada: ya estaba anclado. Es el resultado buscado.
    if (error && error.code !== '23505') {
      console.error('[ots] no se pudo guardar el ancla:', error)
      return
    }
    console.log(`[ots] anclado ${recordHash.slice(0, 16)}… (${proof.length} bytes, pendiente)`)
  } catch (err) {
    console.error('[ots] no se pudo sellar:', err)
  }
}
