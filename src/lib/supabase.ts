import { createClient } from '@supabase/supabase-js'

/**
 * Cliente Supabase del navegador para tbt.cafe.
 *
 * Apunta al MISMO proyecto Supabase que la app actual: tbt.cafe es un
 * front-end nuevo sobre el backend existente, no un backend nuevo
 * (Build Spec 01, sección SCOPE).
 *
 * La autenticación por OTP telefónico ya está viva en ese backend, así que
 * aquí no hace falta ningún endpoint nuevo: se llaman directamente
 * signInWithOtp / verifyOtp.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Faltan NEXT_PUBLIC_SUPABASE_URL y/o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local'
  )
}

export const supabase = createClient(url, anonKey)
