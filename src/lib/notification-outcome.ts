/**
 * Simular no es enviar, tampoco un piso más arriba.
 *
 * `send-email` y `send-sms` ya distinguen las dos cosas: sin credenciales
 * responden 200 con `simulated: true` fuera de producción, precisamente para
 * no dar por salido lo que no salió. Pero quien las llamaba miraba solo el
 * `ok` de HTTP, y ahí la distinción se perdía: la certificación informaba el
 * correo como enviado y el registro de proveedores anotaba un envío correcto
 * de un mensaje que nadie recibió.
 *
 * Es el mismo fallo que esas rutas cerraron, un nivel más arriba, y es el que
 * hace que probar sin credenciales parezca funcionar.
 */
export function wasDelivered(
  response: { ok: boolean },
  body: { simulated?: unknown } | null | undefined
): boolean {
  return response.ok && !body?.simulated
}
