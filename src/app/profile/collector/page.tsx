'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Field, TextArea, CategoryPicker, SaveBar, type Category } from '@/components/FormBits'

/**
 * Perfil de Coleccionista — Master Handoff §11.2.
 * La categoría SIEMPRE es visible. El toggle "display as anonymous":
 * cuando está ON, la página del TBT muestra "Private collector" y los campos
 * de identidad (alias, ubicación, about, links) se ATENÚAN — pero la categoría
 * se mantiene visible.
 */
export default function CollectorProfilePage() {
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
      if (!user) throw new Error('Sesión expirada')

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
      setError(e instanceof Error ? e.message : 'No pudimos guardar el perfil')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="flex-1 px-5 py-8 text-[13px] text-ink-soft">Cargando…</div>
  if (!signedIn) {
    return (
      <div className="flex-1 px-5 py-8">
        <a href="/profile" className="label-caps hover:text-ink">← Profile</a>
        <p className="text-[14px] mt-6">Inicia sesión para editar tu perfil.</p>
      </div>
    )
  }

  // Los campos de identidad se atenúan (no se deshabilitan) cuando es anónimo
  const identityDim = anonymous ? 'opacity-40' : ''

  return (
    <div className="flex-1 flex flex-col">
      <div className="h-header flex items-center px-5 border-b border-hairline">
        <a href="/profile" className="label-caps hover:text-ink">← Collector profile</a>
      </div>

      <div className="px-5 py-6 flex flex-col gap-6">
        {/* Categoría — SIEMPRE visible, incluso en modo anónimo */}
        <CategoryPicker value={category} onChange={setCategory} />

        {/* Toggle de anonimato */}
        <div className="flex items-start justify-between gap-4 py-1">
          <div>
            <div className="text-[15px]">Display as anonymous</div>
            <div className="text-[12px] text-ink-soft mt-1">
              La página del TBT mostrará &quot;Private collector&quot;.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={anonymous}
            aria-label="Display as anonymous"
            onClick={() => setAnonymous((v) => !v)}
            className={`relative w-[42px] h-[24px] rounded-full flex-shrink-0 mt-1 transition-colors ${
              anonymous ? 'bg-ink' : 'bg-hairline'
            }`}
          >
            <span
              className={`absolute top-[3px] w-[18px] h-[18px] rounded-full bg-paper shadow-sm transition-[left] ${
                anonymous ? 'left-[21px]' : 'left-[3px]'
              }`}
            />
          </button>
        </div>

        {/* Campos de identidad — se atenúan cuando es anónimo */}
        <div className={`flex flex-col gap-6 transition-opacity ${identityDim}`}>
          {anonymous && (
            <p className="text-[11px] text-placeholder -mb-2">
              En modo anónimo estos campos no se muestran públicamente.
            </p>
          )}
          <Field label="Alias" value={alias} onChange={setAlias} placeholder="Nombre visible como coleccionista" />
          <Field label="Location" value={location} onChange={setLocation} placeholder="Ciudad, país" />
          <TextArea label="About" value={about} onChange={setAbout} placeholder="Sobre tu colección…" />
          <Field label="Website" value={website} onChange={setWebsite} placeholder="https://tusitio.com" />
        </div>

        <SaveBar onSave={save} busy={busy} saved={saved} error={error} />
      </div>
    </div>
  )
}
