import { supabase } from '@/lib/supabase'
import type { SellerRow } from '@/lib/seller'

/** Lo que devuelve /api/selling — Work Order 02, Stage 2. */
export type SellingState = {
  seller: SellerRow
  countries: { country: string; covered: boolean }[]
  covered: boolean | null
  suggestedCountry: string | null
  providerReady: boolean
  sellingPaused: boolean
  restored?: number
}

async function call(method: 'GET' | 'POST', body?: unknown): Promise<{ state?: SellingState; error?: string; country?: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return { error: 'needSignIn' }
  const res = await fetch('/api/selling', {
    method,
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return { error: json.error ?? 'failed', country: json.country }
  return { state: json as SellingState }
}

export const fetchSelling = () => call('GET')
export const applyToSell = (country: string, entityType: string, agree: boolean) =>
  call('POST', { action: 'apply', country, entityType, agree })
export const pauseSelling = () => call('POST', { action: 'pause' })
export const resumeSelling = (restore: string[]) => call('POST', { action: 'resume', restore })

/** Los titulos de las obras recordadas, para la hoja de restaurar. */
export async function titlesOf(ids: string[]): Promise<{ id: string; title: string }[]> {
  if (!ids.length) return []
  const { data } = await supabase.from('works').select('id, title').in('id', ids)
  return (data ?? []) as { id: string; title: string }[]
}
