'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Field, TextArea, CategoryPicker, SaveBar, type Category } from '@/components/FormBits'

/**
 * Perfil de Creador — Master Handoff §11.1.
 * Escribe en las columnas CANÓNICAS de profiles (creator_type, legal_name…),
 * las mismas que usa el complete-tbt de la app, para no fragmentar los datos.
 */
export default function CreatorProfilePage() {
  const [loading, setLoading] = useState(true)
  const [signedIn, setSignedIn] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const [category, setCategory] = useState<Category>('individual')
  const [legalName, setLegalName] = useState('')
  const [collectiveName, setCollectiveName] = useState('')
  const [leadRep, setLeadRep] = useState('')
  const [entityName, setEntityName] = useState('')
  const [taxId, setTaxId] = useState('')
  const [publicAlias, setPublicAlias] = useState('')
  const [about, setAbout] = useState('')
  const [credentials, setCredentials] = useState('')
  const [address, setAddress] = useState('')
  const [linkedin, setLinkedin] = useState('')
  const [website, setWebsite] = useState('')
  const [instagram, setInstagram] = useState('')

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
        .select(
          'creator_type, legal_name, collective_name, lead_representative, entity_name, tax_id, public_alias, bio, credentials, physical_address, social_linkedin, social_website, social_instagram'
        )
        .eq('id', user.id)
        .single()

      if (data) {
        setCategory((data.creator_type as Category) ?? 'individual')
        setLegalName(data.legal_name ?? '')
        setCollectiveName(data.collective_name ?? '')
        setLeadRep(data.lead_representative ?? '')
        setEntityName(data.entity_name ?? '')
        setTaxId(data.tax_id ?? '')
        setPublicAlias(data.public_alias ?? '')
        setAbout(data.bio ?? '')
        setCredentials(data.credentials ?? '')
        setAddress(
          typeof data.physical_address === 'string'
            ? data.physical_address
            : (data.physical_address as { formatted?: string } | null)?.formatted ?? ''
        )
        setLinkedin(data.social_linkedin ?? '')
        setWebsite(data.social_website ?? '')
        setInstagram(data.social_instagram ?? '')
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
          creator_type: category,
          legal_name: category === 'individual' ? legalName || null : null,
          collective_name: category === 'group' ? collectiveName || null : null,
          lead_representative: category === 'group' ? leadRep || null : null,
          entity_name: category === 'corporation' ? entityName || null : null,
          tax_id: category === 'corporation' ? taxId || null : null,
          public_alias: publicAlias || null,
          bio: about || null,
          credentials: credentials || null,
          physical_address: address ? { formatted: address } : null,
          social_linkedin: linkedin || null,
          social_website: website || null,
          social_instagram: instagram || null,
          is_creator: true,
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

  return (
    <div className="flex-1 flex flex-col">
      <div className="h-header flex items-center px-5 border-b border-hairline">
        <a href="/profile" className="label-caps hover:text-ink">← Creator profile</a>
      </div>

      <div className="px-5 py-6 flex flex-col gap-6">
        <CategoryPicker value={category} onChange={setCategory} />

        {/* Campos condicionales por categoría (§11.1) */}
        {category === 'individual' && (
          <Field label="Legal name" value={legalName} onChange={setLegalName} placeholder="Nombre legal completo" />
        )}
        {category === 'group' && (
          <>
            <Field label="Lead representative" value={leadRep} onChange={setLeadRep} placeholder="Representante principal" />
            <Field label="Collective name" value={collectiveName} onChange={setCollectiveName} placeholder="Nombre del colectivo" />
          </>
        )}
        {category === 'corporation' && (
          <>
            <Field label="Registered entity name" value={entityName} onChange={setEntityName} placeholder="Razón social" />
            <Field label="Tax ID / Registration #" value={taxId} onChange={setTaxId} placeholder="NIT / Tax ID" />
          </>
        )}

        <Field
          label="Public alias"
          value={publicAlias}
          onChange={setPublicAlias}
          placeholder="El nombre que aparece en el certificado"
          hint="Es el nombre que verá cualquiera en el TBT."
        />
        <TextArea label="About" value={about} onChange={setAbout} placeholder="Sobre ti, tu trayectoria…" />
        <Field label="Credentials" value={credentials} onChange={setCredentials} placeholder="Formación, premios…" />
        <Field
          label="Physical address"
          value={address}
          onChange={setAddress}
          placeholder="Ciudad, país"
          hint="Autocompletado con Maps: pendiente de integración (seam)."
        />

        <div className="label-caps pt-2">Social proof</div>
        <Field label="LinkedIn" value={linkedin} onChange={setLinkedin} placeholder="https://linkedin.com/in/…" urlDomain="linkedin.com" />
        <Field label="Website" value={website} onChange={setWebsite} placeholder="https://tusitio.com" />
        <Field label="Instagram" value={instagram} onChange={setInstagram} placeholder="https://instagram.com/…" urlDomain="instagram.com" />

        <SaveBar onSave={save} busy={busy} saved={saved} error={error} />
      </div>
    </div>
  )
}
