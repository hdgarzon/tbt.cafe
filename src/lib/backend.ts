/**
 * URL base del backend TBT existente (repo hdgarzon/tbt, Vercel "brocha").
 * tbt.cafe llama sus rutas de Stripe cross-origin — CORS habilitado ahí
 * mismo para el origen de este front (ver cross-origin-auth.ts en ese repo).
 */
export const TBT_BACKEND_URL =
  process.env.NEXT_PUBLIC_TBT_BACKEND_URL ?? 'https://brocha.vercel.app'
