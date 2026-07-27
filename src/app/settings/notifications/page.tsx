'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale, type Dictionary } from '@/i18n/LocaleProvider'

/**
 * Notificaciones — Master Handoff §15.
 * Tres categorías; cada ítem es un toggle on/off. Los ítems basados en vistas
 * añaden un selector de umbral (nativo, como el prototipo) que solo aparece
 * cuando el ítem está ON. Las de seguridad van ON por defecto (deliberado) y
 * se distinguen con el acento navy, igual que el prototipo.
 *
 * Estado por ítem: { on: boolean, threshold?: number }
 * Se persiste como jsonb en notification_prefs.prefs, con los IDs de abajo
 * como llaves — esos IDs son estructura de datos, no texto, así que se
 * quedan en inglés estable y NO se traducen. Solo las etiquetas visibles
 * (build(t) más abajo) vienen del diccionario activo.
 */

type ItemDef = { id: string; threshold?: boolean; defaultOn: boolean }
type CategoryDef = { key: string; security?: boolean; items: ItemDef[] }

const STRUCTURE: CategoryDef[] = [
  {
    key: 'tbt',
    items: [
      { id: 'views_created', threshold: true, defaultOn: true },
      { id: 'views_collection', threshold: true, defaultOn: true },
      { id: 'favorites', defaultOn: true },
      { id: 'surge', defaultOn: true },
    ],
  },
  {
    key: 'security',
    security: true,
    items: [
      { id: 'new_location', defaultOn: true },
      { id: 'new_device', defaultOn: true },
      { id: 'suspicious', defaultOn: true },
    ],
  },
  {
    key: 'transactional',
    items: [
      { id: 'purchases', defaultOn: true },
      { id: 'transfers', defaultOn: true },
      { id: 'new_from_followed', defaultOn: false },
      { id: 'registrations', defaultOn: true },
    ],
  },
]

const ITEM_LABEL_KEY: Record<string, keyof Dictionary['notifications']['items']> = {
  views_created: 'viewsCreated',
  views_collection: 'viewsCollection',
  favorites: 'favorites',
  surge: 'surge',
  new_location: 'newLocation',
  new_device: 'newDevice',
  suspicious: 'suspicious',
  purchases: 'purchases',
  transfers: 'transfers',
  new_from_followed: 'newFromFollowed',
  registrations: 'registrations',
}

/** Construye las categorías con las etiquetas traducidas del diccionario activo. */
function buildCategories(t: Dictionary) {
  const titles: Record<string, string> = {
    tbt: t.notifications.categories.tbtActivity,
    security: t.notifications.categories.security,
    transactional: t.notifications.categories.transactional,
  }
  const notes: Record<string, string | undefined> = {
    security: t.notifications.categories.securityNote,
  }
  return STRUCTURE.map((cat) => ({
    key: cat.key,
    security: cat.security,
    title: titles[cat.key],
    note: notes[cat.key],
    items: cat.items.map((item) => ({
      ...item,
      label: t.notifications.items[ITEM_LABEL_KEY[item.id]],
      desc: t.notifications.itemDesc[ITEM_LABEL_KEY[item.id]],
    })),
  }))
}

const THRESHOLDS = [100, 500, 1000]

type Pref = { on: boolean; threshold?: number }
type Prefs = Record<string, Pref>

function withDefaults(stored: Prefs): Prefs {
  const out: Prefs = {}
  for (const cat of STRUCTURE) {
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
  const { t } = useLocale()
  const [loading, setLoading] = useState(true)
  const [signedIn, setSignedIn] = useState(true)
  const [prefs, setPrefs] = useState<Prefs>({})
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
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
    const {
      data: { user },
    } = await supabase.auth.getUser()
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

  if (loading) return <div className="px-4 pt-6 text-[13px] text-ink-soft">{t.authHub.loading}</div>
  if (!signedIn) {
    return (
      <div className="px-4 pt-6">
        <a href="/" className="back-link">← {t.purchase.home}</a>
        <p className="text-[14px] mt-6">{t.notifications.needSignIn}</p>
      </div>
    )
  }

  const categories = buildCategories(t)

  return (
    <div className="px-4 pt-6">
      <a href="/" className="back-link">← {t.notifications.backLabel}</a>
      <h1 className="page-title">{t.notifications.backLabel}</h1>
      <div className="page-sub">{t.notifications.pageSub}</div>

      {categories.map((cat) => (
        <section key={cat.key} className="mb-2">
          <div
            className={`text-[10px] font-semibold tracking-[0.2em] uppercase mt-6 mb-1 pb-[10px] border-b border-hairline ${
              cat.security ? 'text-t-navy' : 'text-ink'
            }`}
          >
            {cat.title}
          </div>
          {cat.note && <div className="text-[11px] text-placeholder -mt-0.5 mb-2">{cat.note}</div>}

          {cat.items.map((item) => {
            const pref = prefs[item.id]
            return (
              <div key={item.id} className="flex items-start justify-between gap-3.5 py-4 border-b border-hairline">
                <div className="flex-1">
                  <div className="text-[13.5px] font-medium tracking-[0.01em] text-ink">{item.label}</div>
                  <div className="text-[11.5px] leading-[1.5] text-ink-soft mt-1">{item.desc}</div>

                  {/* Umbral: select nativo, solo visible cuando el ítem está ON */}
                  {item.threshold && pref.on && (
                    <div className="mt-2.5 flex items-center gap-2">
                      <span className="text-[10px] font-medium tracking-[0.12em] uppercase text-ink-soft">
                        {t.notifications.every}
                      </span>
                      <select
                        value={pref.threshold}
                        onChange={(e) => setThreshold(item.id, Number(e.target.value))}
                        className="rounded-lg border border-hairline bg-paper px-2.5 py-[7px] text-[12px] text-ink outline-none cursor-pointer focus:border-ink"
                      >
                        {THRESHOLDS.map((n) => (
                          <option key={n} value={n}>
                            {n.toLocaleString()} {t.notifications.views}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={pref.on}
                  aria-label={item.label}
                  onClick={() => toggle(item.id)}
                  className={`relative w-[46px] h-[26px] rounded-full flex-shrink-0 mt-0.5 transition-colors ${
                    pref.on ? (cat.security ? 'bg-t-navy' : 'bg-ink') : 'bg-hairline'
                  }`}
                >
                  <span
                    className={`absolute top-[3px] w-5 h-5 rounded-full bg-paper shadow-sm transition-[left] ${
                      pref.on ? 'left-5' : 'left-[3px]'
                    }`}
                  />
                </button>
              </div>
            )
          })}
        </section>
      ))}

      <div className="py-6">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="w-full py-4 text-[12px] font-semibold tracking-[0.16em] uppercase bg-ink text-paper rounded-xl transition-[opacity,background] disabled:opacity-60 disabled:cursor-not-allowed enabled:hover:bg-black"
        >
          {busy ? t.notifications.saving : t.notifications.save}
        </button>
        {saved && (
          <p className="text-[12px] text-t-green text-center mt-3.5 tracking-[0.02em]">
            {t.notifications.saved}
          </p>
        )}
      </div>
    </div>
  )
}
