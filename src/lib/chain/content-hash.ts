/**
 * Hash del contenido — Chain Implementation Spec 01, Item 2.
 *
 * SHA-256 del archivo TAL COMO SE SUBIO, antes de cualquier proceso. No la
 * imagen normalizada, no la miniatura, y no el hash perceptual de la ruta de
 * registro de imagenes: aquel mide parecido y sirve para otra cosa
 * completamente.
 *
 * Es lo que hace el certificado autoverificable. Cualquiera que conserve el
 * original puede probar que coincide con el registro, con o sin tbt.cafe. Sin
 * esto, el certificado depende para siempre de que la plataforma responda por
 * el.
 *
 * POR QUE EN EL NAVEGADOR Y NO EN EL SERVIDOR
 *
 * El spec propone `createHash` de Node sobre un Buffer. Aqui no se puede: la
 * subida ocurre en el cliente y `normalizeImage` reescribe la imagen ANTES de
 * que ningun byte salga del navegador. Los bytes de origen solo existen ahi.
 * Hashearlos en el servidor obligaria a subir tambien el original, que es justo
 * lo que el spec quiere evitar — hashear algo que ya paso por un proceso.
 *
 * `crypto.subtle` esta en todo navegador con contexto seguro y en Node 18+, asi
 * que la misma funcion vale a los dos lados.
 *
 * NO SE PUEDE ANADIR RETROACTIVAMENTE. Cada TBT registrado antes de este cambio
 * queda permanentemente mas debil que los de despues.
 */

export const CONTENT_HASH_PREFIX = 'sha256:'

export async function contentHash(file: Blob): Promise<string> {
  const bytes = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return CONTENT_HASH_PREFIX + hex
}
