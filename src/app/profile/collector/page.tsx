'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { Field, TextArea, CategoryPicker, SaveBar, type Category } from '@/components/FormBits'

/**
 * Perfil de Coleccionista — Master Handoff §11.2.
 * La categoría SIEMPRE es visible. El toggle "display as anonymous":
 * cuando está ON, la página del TBT muestra "Private collector" y los campos
 * de identidad (alias, ubicación, about, links) se ATENÚAN — pero la categoría
 * se mantiene visible.
 */
export default function CollectorProfilePage() {
  const { t } = useLocale()
  const [loading, setLoading] = useState(true)
  const [signedIn, setSignedIn] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const [category, setCategory] = useState<Category>('individual')
  const [anonymous, setAnonymous] = useState(false)
  const [alias, setAlias] = useState('')
  const [location, setLocation] = useState('')
  const [about, setAbout] = useState('')
  const [website, setWebsite] = useState('')

  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setSignedIn(false)
        setLoading(false)
        return
      }
      const { data } = await supabase
        .from('profiles')
        .select('collector_category, collector_anonymous, collector_alias, collector_location, collector_about, collector_website')
        .eq('id', user.id)
        .single()

      if (data) {
        setCategory((data.collector_category as Category) ?? 'individual')
        setAnonymous(!!data.collector_anonymous)
        setAlias(data.collector_alias ?? '')
        setLocation(data.collector_location ?? '')
        setAbout(data.collector_about ?? '')
        setWebsite(data.collector_website ?? '')
      }
      setLoading(false)
    })()
  }, [])

  async function save() {
    setError('')
    setBusy(true)
    setSaved(false)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Session expired')

      const { error: err } = await supabase
        .from('profiles')
        .update({
          collector_category: category,
          collector_anonymous: anonymous,
          collector_alias: alias || null,
          collector_location: location || null,
          collector_about: about || null,
          collector_website: website || null,
        })
        .eq('id', user.id)
      if (err) throw err
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.profileCollector.errors.saveFailed)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="px-4 pt-6 text-[13px] text-ink-soft">{t.authHub.loading}</div>
  if (!signedIn) {
    return (
      <div className="px-4 pt-6">
        <a href="/profile" className="back-link">← {t.profile.title}</a>
        <p className="text-[14px] mt-6">{t.profileCollector.needSignIn}</p>
      </div>
    )
  }

  // Los campos de identidad se atenúan (no se deshabilitan) cuando es anónimo
  const identityDim = anonymous ? 'opacity-40 pointer-events-none' : ''

  return (
    <div className="px-4 pt-6">
      <a href="/profile" className="back-link">← {t.profile.backProfile}</a>
      <h1 className="page-title">{t.profile.collectorTitle}</h1>
      <div className="page-sub">{t.profile.collectorFormSub}</div>

      <div className="mt-6 flex flex-col gap-[22px]">
        {/* Categoría — SIEMPRE visible, incluso en modo anónimo */}
        <CategoryPicker value={category} onChange={setCategory} />

        {/* Toggle de anonimato — caja pf-toggle-row */}
        <div className="flex items-start justify-between gap-3.5 rounded-xl border border-hairline bg-paper-warm p-4">
          <div>
            <div className="text-[13px] font-semibold tracking-[0.01em] text-ink">
              {t.profileCollector.anonymous}
            </div>
            <div className="text-[11.5px] leading-[1.5] text-ink-soft mt-[5px]">
              {t.profileCollector.anonymousHint}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={anonymous}
            aria-label={t.profileCollector.anonymous}
            onClick={() => setAnonymous((v) => !v)}
            className={`relative w-[46px] h-[26px] rounded-full flex-shrink-0 mt-0.5 transition-colors ${
              anonymous ? 'bg-ink' : 'bg-hairline'
            }`}
          >
            <span
              className={`absolute top-[3px] w-5 h-5 rounded-full bg-paper shadow-sm transition-[left] ${
                anonymous ? 'left-5' : 'left-[3px]'
              }`}
            />
          </button>
        </div>

        {/* Campos de identidad — se atenúan cuando es anónimo */}
        <div className={`flex flex-col gap-[22px] transition-opacity ${identityDim}`}>
          {anonymous && (
            <p className="text-[11px] text-placeholder -mb-3">
              {t.profileCollector.anonymousFieldsHint}
            </p>
          )}
          <Field label={t.profileCollector.alias} value={alias} onChange={setAlias} placeholder={t.profileCollector.aliasPlaceholder} />
          <Field label={t.profileCollector.location} value={location} onChange={setLocation} placeholder={t.profileCollector.locationPlaceholder} />
          <TextArea label={t.profileCollector.about} value={about} onChange={setAbout} placeholder={t.profileCollector.aboutPlaceholder} />
          <Field label={t.profileCollector.website} value={website} onChange={setWebsite} placeholder={t.profileCollector.websitePlaceholder} />
        </div>

        <SaveBar onSave={save} busy={busy} saved={saved} error={error} />
      </div>
    </div>
  )
}
