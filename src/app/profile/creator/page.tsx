'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { Field, TextArea, CategoryPicker, SaveBar, type Category } from '@/components/FormBits'

/**
 * Perfil de Creador — Master Handoff §11.1.
 * Escribe en las columnas CANÓNICAS de profiles (creator_type, legal_name…),
 * las mismas que usa el complete-tbt de la app, para no fragmentar los datos.
 */
export default function CreatorProfilePage() {
  const { t } = useLocale()
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
      if (!user) throw new Error('Session expired')

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
      setError(e instanceof Error ? e.message : t.profileCreator.errors.saveFailed)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="px-4 pt-6 text-[13px] text-ink-soft">{t.authHub.loading}</div>
  if (!signedIn) {
    return (
      <div className="px-4 pt-6">
        <a href="/profile" className="back-link">← {t.profile.title}</a>
        <p className="text-[14px] mt-6">{t.profileCreator.needSignIn}</p>
      </div>
    )
  }

  return (
    <div className="px-4 pt-6">
      <a href="/profile" className="back-link">← {t.profileCreator.backLabel}</a>
      <h1 className="page-title">{t.profile.creatorTitle}</h1>
      <div className="page-sub">{t.profile.creatorSub}</div>

      <div className="mt-6 flex flex-col gap-[22px]">
        <CategoryPicker value={category} onChange={setCategory} />

        {/* Campos condicionales por categoría (§11.1) */}
        {category === 'individual' && (
          <Field label={t.profileCreator.legalName} value={legalName} onChange={setLegalName} placeholder={t.profileCreator.legalNamePlaceholder} />
        )}
        {category === 'group' && (
          <>
            <Field label={t.profileCreator.leadRep} value={leadRep} onChange={setLeadRep} placeholder={t.profileCreator.leadRepPlaceholder} />
            <Field label={t.profileCreator.collectiveName} value={collectiveName} onChange={setCollectiveName} placeholder={t.profileCreator.collectiveNamePlaceholder} />
          </>
        )}
        {category === 'corporation' && (
          <>
            <Field label={t.profileCreator.entityName} value={entityName} onChange={setEntityName} placeholder={t.profileCreator.entityNamePlaceholder} />
            <Field label={t.profileCreator.taxId} value={taxId} onChange={setTaxId} placeholder={t.profileCreator.taxIdPlaceholder} />
          </>
        )}

        <Field
          label={t.profileCreator.publicAlias}
          value={publicAlias}
          onChange={setPublicAlias}
          placeholder={t.profileCreator.publicAliasPlaceholder}
          hint={t.profileCreator.publicAliasHint}
        />
        <Field
          label={t.profileCreator.address}
          value={address}
          onChange={setAddress}
          placeholder={t.profileCreator.addressPlaceholder}
          hint={t.profileCreator.addressHint}
        />
        <TextArea label={t.profileCreator.credentials} value={credentials} onChange={setCredentials} placeholder={t.profileCreator.credentialsPlaceholder} />

        <div className="label-caps">{t.profileCreator.socialProof}</div>
        <Field label={t.profileCreator.linkedin} value={linkedin} onChange={setLinkedin} placeholder="https://linkedin.com/in/…" urlDomain="linkedin.com" />
        <Field label={t.profileCreator.website} value={website} onChange={setWebsite} placeholder="https://yoursite.com" />
        <Field label={t.profileCreator.instagram} value={instagram} onChange={setInstagram} placeholder="https://instagram.com/…" urlDomain="instagram.com" />

        <TextArea label={t.profileCreator.about} value={about} onChange={setAbout} placeholder={t.profileCreator.aboutPlaceholder} />

        <SaveBar onSave={save} busy={busy} saved={saved} error={error} />
      </div>
    </div>
  )
}
