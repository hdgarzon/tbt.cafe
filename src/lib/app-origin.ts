/**
 * El origen de la propia app — Work Order 02, 0.5a.
 *
 * El retorno de un checkout se arma desde aqui y nunca desde la cabecera
 * `Origin` de la peticion: esa la elige quien llama, y aceptarla dejaria
 * redirigir Stripe a donde quisiera. Misma resolucion que create-checkout.
 */
export function appOrigin(): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  try {
    return new URL(base).origin
  } catch {
    return null
  }
}
