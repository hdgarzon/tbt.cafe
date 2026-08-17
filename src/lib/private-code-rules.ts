/**
 * La regla de longitud del código privado, en un solo sitio.
 *
 * Estaba repetida en el sheet que lo fija y en la ruta que lo guarda, y el campo
 * del step-up de administración no la aplicaba en absoluto: aceptaba cualquier
 * longitud. Un código más largo que el máximo no puede coincidir nunca con lo
 * guardado, así que fallaba siempre sin decir por qué — y cada intento gastaba
 * uno de los cinco antes del bloqueo.
 */
export const PRIVATE_CODE_MIN = 3
export const PRIVATE_CODE_MAX = 5
