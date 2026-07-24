'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Notificaciones — Master Handoff §15.
 * Tres categorías; cada ítem es un toggle on/off. Los ítems basados en vistas
 * añaden un selector de umbral que solo aparece cuando el ítem está ON.
 * Las de seguridad van ON por defecto (deliberado): alimentan la alarma de
 * clonación del biométrico y la detección de actividad sospechosa.
 *
 * Estado por ítem: { on: boolean, threshold?: number }
 * Se persiste como jsonb en notification_prefs.prefs.
 */

type Item = { id: string; label: string; threshold?: boolean; defaultOn: boolean }
type Category = { key: string; title: string; note?: string; items: Item[] }

const CATEGORIES: Category[] = [
  {
    key: 'tbt',
    title: 'TBT activity',
    items: [
      { id: 'views_created', label: 'Views on created works', threshold: true, defaultOn: true },
      { id: 'views_collection', label: 'Views on collection', threshold: true, defaultOn: true },
      { id: 'favorites', label: 'Favorites activity', defaultOn: true },
      { id: 'surge', label: 'Surge alerts', defaultOn: true },
    ],
  },
  {
    key: 'security',
    title: 'Security',
    note: 'Activadas por defecto, deliberadamente.',
    items: [
      { id: 'new_location', label: 'New location (IP)', defaultOn: true },
      { id: 'new_device', label: 'New device', defaultOn: true },
      { id: 'suspicious', label: 'Suspicious activity', defaultOn: true },
    ],
  },
  {
    key: 'transactional',
    title: 'Transactional',
    items: [
      { id: 'purchases', label: 'Purchases', defaultOn: true },
      { id: 'transfers', label: 'Transfers', defaultOn: true },
      { id: 'new_from_followed', label: 'New from followed', defaultOn: false },
      { id: 'registrations', label: 'Registration confirmations', defaultOn: true },
    ],
  },
]

const THRESHOLDS = [10, 50, 100, 500]

type Pref = { on: boolean; threshold?: number }
type Prefs = Record<string, Pref>

function withDefaults(stored: Prefs): Prefs {
  const out: Prefs = {}
  for (const cat of CATEGORIES) {
    for (const item of cat.items) {
      const s = stored[item.id]
      out[item.id] = {
        on: s?.on ?? item.defaultOn,
        threshold: item.threshold ? s?.threshold ?? THRESHOLDS[0] : undefined,
      }
    }
  }
  return out
}

export default function NotificationsPage() {
  const [loading, setLoading] = useState(true)
  const [signedIn, setSignedIn] = useState(true)
  const [prefs, setPrefs] = useState<Prefs>({})
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setSignedIn(false)
        setLoading(false)
        return
      }
      const { data } = await supabase
        .from('notification_prefs')
        .select('prefs')
        .eq('user_id', user.id)
        .maybeSingle()
      setPrefs(withDefaults((data?.prefs as Prefs) ?? {}))
      setLoading(false)
    })()
  }, [])

  function toggle(id: string) {
    setSaved(false)
    setPrefs((p) => ({ ...p, [id]: { ...p[id], on: !p[id].on } }))
  }
  function setThreshold(id: string, threshold: number) {
    setSaved(false)
    setPrefs((p) => ({ ...p, [id]: { ...p[id], threshold } }))
  }

  async function save() {
    setBusy(true)
    setSaved(false)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setBusy(false)
      return
    }
    await supabase
      .from('notification_prefs')
      .upsert({ user_id: user.id, prefs, updated_at: new Date().toISOString() })
    setBusy(false)
    setSaved(true)
  }

  if (loading) return <div className="flex-1 px-5 py-8 text-[13px] text-ink-soft">Cargando…</div>
  if (!signedIn) {
    return (
      <div className="flex-1 px-5 py-8">
        <a href="/" className="label-caps hover:text-ink">← Home</a>
        <p className="text-[14px] mt-6">Inicia sesión para gestionar tus notificaciones.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="h-header flex items-center px-5 border-b border-hairline">
        <a href="/" className="label-caps hover:text-ink">← Notifications</a>
      </div>

      {CATEGORIES.map((cat) => (
        <section key={cat.key}>
          <div className="px-5 pt-6 pb-2">
            <div className="label-caps">{cat.title}</div>
            {cat.note && <div className="text-[11px] text-placeholder mt-1">{cat.note}</div>}
          </div>
          {cat.items.map((item) => {
            const pref = prefs[item.id]
            return (
              <div key={item.id} className="px-5 py-3 border-b border-hairline">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[14px]">{item.label}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={pref.on}
                    aria-label={item.label}
                    onClick={() => toggle(item.id)}
                    className={`relative w-[42px] h-[24px] rounded-full flex-shrink-0 transition-colors ${
                      pref.on ? 'bg-ink' : 'bg-hairline'
                    }`}
                  >
                    <span
                      className={`absolute top-[3px] w-[18px] h-[18px] rounded-full bg-paper shadow-sm transition-[left] ${
                        pref.on ? 'left-[21px]' : 'left-[3px]'
                      }`}
                    />
                  </button>
                </div>

                {/* Umbral: solo visible cuando el ítem está ON */}
                {item.threshold && pref.on && (
                  <div className="flex items-center gap-2 mt-3">
                    <span className="text-[11px] text-ink-soft">Notify past</span>
                    {THRESHOLDS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setThreshold(item.id, n)}
                        aria-pressed={pref.threshold === n}
                        className={`px-2 py-1 text-[11px] border transition-colors ${
                          pref.threshold === n ? 'border-ink text-ink' : 'border-hairline text-ink-soft'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                    <span className="text-[11px] text-ink-soft">views</span>
                  </div>
                )}
              </div>
            )
          })}
        </section>
      ))}

      <div className="px-5 py-6">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="w-full py-3 text-[13px] tracking-[0.1em] uppercase border border-ink transition-colors disabled:border-hairline disabled:text-placeholder enabled:hover:bg-ink enabled:hover:text-paper"
        >
          {busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save preferences'}
        </button>
      </div>
    </div>
  )
}
