/**
 * El paquete no trae tipos. Esto declara SOLO lo que usamos, leido de su
 * codigo en node_modules — no de memoria:
 *
 *   src/detached-timestamp-file.js   fromHash, serializeToBytes, deserialize
 *   src/open-timestamps.js           stamp, upgrade, verify
 *
 * `verify` devuelve las atestaciones indexadas por cadena; la de bitcoin trae
 * `height` y `timestamp` (unix), segun el docblock de `verifyTimestamp`.
 */
declare module 'javascript-opentimestamps' {
  export class DetachedTimestampFile {
    static fromHash(fileHashOp: unknown, hash: number[] | Uint8Array): DetachedTimestampFile
    static deserialize(buffer: Uint8Array | number[] | ArrayBuffer): DetachedTimestampFile
    serializeToBytes(): number[]
    fileHashOp: unknown
  }

  export namespace Ops {
    class OpSHA256 {}
  }

  export type Attestation = { height: number; timestamp: number }

  /*
   * `stamp`, `upgrade` y `verify` son METODOS de un objeto y usan `this` por
   * dentro —`this.makeMerkleTree`, `this.upgradeTimestamp`—, asi que
   * desestructurarlos los rompe. Se declaran en un default para que la unica
   * forma de llamarlos sea sobre el objeto.
   */
  interface OpenTimestampsApi {
    stamp(detaches: DetachedTimestampFile[], options?: object): Promise<void>
    upgrade(detached: DetachedTimestampFile, options?: object): Promise<boolean>
    verify(
      detachedStamped: DetachedTimestampFile,
      detachedOriginal: DetachedTimestampFile,
      options?: object
    ): Promise<Record<string, Attestation>>
  }

  const OpenTimestamps: OpenTimestampsApi
  export default OpenTimestamps
}
