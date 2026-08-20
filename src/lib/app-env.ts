/**
 * Ambiente y comprobacion de variables de servidor.
 *
 * Cruzo desde el backend con dos cambios, y los dos son de seguridad.
 *
 * 1. LA INFERENCIA FALLA HACIA PRODUCCION
 *
 * Alla `rawUrl` caia a `http://localhost:3000` cuando NEXT_PUBLIC_APP_URL no
 * estaba, y de ahi `isProduction` salia false. Eso importa porque `isProduction`
 * no decora nada: es lo unico que separa el cupon `TBT` —que salta el pago
 * entero— de estar vivo. En este proyecto esa variable NO esta definida, asi
 * que copiar el archivo tal cual habria puesto un bypass de pago en produccion.
 *
 * Ahora no se asume nada: sin evidencia positiva de local, es produccion. El
 * error caro es regalar registraciones, no exigir una de mas.
 *
 * Las URLs de preview tampoco cuentan como no-produccion, aunque alla si. Una
 * preview de este repo apunta a la MISMA base que produccion, y su URL es
 * compartible: un bypass de pago ahi es un bypass de pago. Quien quiera el
 * cupon en un preview declara NEXT_PUBLIC_APP_ENV, que es una decision, no un
 * descuido.
 *
 * 2. LA COMPROBACION DE VARIABLES YA NO CORRE AL IMPORTAR
 *
 * Era un `throw` en el cuerpo del modulo. Eso no rompe la ruta que necesita las
 * claves, rompe el grafo entero y con el el build — el mismo patron que
 * `stripe.ts`. Ahora es `assertServerEnv()`, que llaman las rutas de dinero al
 * empezar: la garantia se conserva donde importa y con el listado exacto de lo
 * que falta.
 */

export type AppEnv = 'local' | 'staging' | 'test' | 'production'

const rawUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
export const APP_URL = (rawUrl || 'https://tbt.cafe').replace(/\/$/, '')

function inferEnv(): AppEnv {
  const forced = process.env.NEXT_PUBLIC_APP_ENV as AppEnv | undefined
  if (forced === 'local' || forced === 'staging' || forced === 'test' || forced === 'production') {
    return forced
  }
  if (rawUrl.includes('localhost') || rawUrl.includes('127.0.0.1')) return 'local'
  return 'production'
}

export const APP_ENV: AppEnv = inferEnv()

export const isLocal = APP_ENV === 'local'
/** staging o test (alias legacy) */
export const isStaging = APP_ENV === 'staging' || APP_ENV === 'test'
export const isProduction = APP_ENV === 'production'
/** true en cualquier ambiente que no sea produccion */
export const isDev = !isProduction

/**
 * Las variables sin las que una ruta de dinero no puede operar honestamente.
 *
 * Se llama al principio del handler, no al importar. Devuelve la lista de lo
 * que falta en vez de lanzar, para que quien llama decida el codigo y el
 * mensaje —y para que un despliegue incompleto falle en la ruta afectada y no
 * en el build.
 */
const REQUIRED_SERVER_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'SOLANA_PAYER_PRIVATE_KEY',
  'WALLET_ENCRYPTION_KEY',
] as const

export function missingServerEnv(): string[] {
  if (typeof window !== 'undefined') return []
  return REQUIRED_SERVER_VARS.filter((v) => !process.env[v])
}

export function assertServerEnv(): void {
  const missing = missingServerEnv()
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
  }
}
