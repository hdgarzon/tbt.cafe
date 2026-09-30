'use client'

import type { ReactNode } from 'react'
import { useLocale } from '@/i18n/LocaleProvider'
import { BrewChrome, BrewButton, BrewTitle, BrewLabel, BrewInput, BrewSelect } from '@/components/brew/BrewChrome'

/**
 * Las dos pantallas del coleccionista — Work Order 01 Step 20, del prototipo v11
 * (phase 2: "The Creator" y "How it came to you").
 *
 * Todo lo que se escribe aquí es la palabra del coleccionista, no un hecho
 * verificado: eso es lo que registra un título bonded. Dos reglas legales:
 * de un creador vivo solo ciudad y país, nunca una dirección; y ningún
 * contacto de un tercero se publica. Las aplica el servidor (/api/brew/bonded);
 * esta pantalla solo no pide lo que no debe pedir.
 */

export type BondedInput = {
  status: '' | 'living' | 'deceased' | 'unknown'
  category: 'individual' | 'group' | 'corporation'
  name: string
  unattributed: boolean
  alias: string
  city: string
  reachable: '' | 'yes' | 'no'
  contact: string
  credentials: string
  website: string
  instagram: string
  about: string
  estateName: string
  estateRep: string
  estateContact: string
  docType: '' | 'bill' | 'gallery' | 'auction' | 'inherit' | 'gift' | 'none'
  source: string
  acquired: string
  pricePaid: string
  provenance: string
}

export const EMPTY_BONDED: BondedInput = {
  status: '',
  category: 'individual',
  name: '',
  unattributed: false,
  alias: '',
  city: '',
  reachable: '',
  contact: '',
  credentials: '',
  website: '',
  instagram: '',
  about: '',
  estateName: '',
  estateRep: '',
  estateContact: '',
  docType: '',
  source: '',
  acquired: '',
  pricePaid: '',
  provenance: '',
}

function Textarea({ value, onChange, rows, placeholder }: { value: string; onChange: (v: string) => void; rows: number; placeholder?: string }) {
  return (
    <textarea
      rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full border border-hairline rounded-xl outline-none px-3.5 py-3 text-[14px] text-ink bg-paper focus:border-ink transition-colors"
    />
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-[11.5px] leading-[1.5] text-ink-soft mt-1.5">{children}</p>
}

type StepProps = {
  value: BondedInput
  onChange: (v: BondedInput) => void
  onBack: () => void
  onNext: () => void
  onClose: () => void
  progressPct: number
}

export function CollectorCreatorStep({ value: v, onChange, onBack, onNext, onClose, progressPct }: StepProps) {
  const { t } = useLocale()
  const c = t.collector
  const set = (patch: Partial<BondedInput>) => onChange({ ...v, ...patch })
  const known = v.status === 'living' || v.status === 'deceased'
  const showName = v.status !== '' && !(v.status === 'unknown' && v.unattributed)
  const canContinue = v.status !== '' && (v.unattributed || v.name.trim().length > 0)
  const nameLabel = v.category === 'group' ? c.nameGroup : v.category === 'corporation' ? c.nameCorporation : c.nameIndividual

  return (
    <BrewChrome
      onBack={onBack}
      backLabel={t.creator.back}
      onClose={onClose}
      progressPct={progressPct}
      dock={<BrewButton onClick={onNext} disabled={!canContinue}>{t.brew.next}</BrewButton>}
    >
      <BrewTitle required>{c.creatorTitle}</BrewTitle>
      <p className="text-[12.5px] text-ink-soft mt-1.5">{c.creatorSub}</p>
      <p className="text-[12px] leading-[1.55] text-ink-soft bg-paper-warm border border-hairline rounded-xl p-3 mt-3">{c.creatorNote}</p>

      <div className="mt-4">
        <BrewLabel required>{c.statusLabel}</BrewLabel>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['living', c.statusLiving, c.statusLivingSub],
              ['deceased', c.statusDeceased, c.statusDeceasedSub],
              ['unknown', c.statusUnknown, c.statusUnknownSub],
            ] as const
          ).map(([k, label, sub]) => (
            <button
              key={k}
              type="button"
              onClick={() => set({ status: k, ...(k !== 'unknown' ? { unattributed: false } : {}) })}
              aria-pressed={v.status === k}
              className={`text-left border rounded-xl p-2.5 transition-colors ${v.status === k ? 'border-ink bg-paper-warm' : 'border-hairline bg-paper'}`}
            >
              <div className="text-[13px] font-medium text-ink">{label}</div>
              <div className="text-[11px] text-ink-soft mt-0.5">{sub}</div>
            </button>
          ))}
        </div>
      </div>

      {v.status !== '' && (
        <>
          {v.status === 'unknown' && (
            <label className="flex items-center gap-2 mt-3.5 text-[13px] text-ink">
              <input type="checkbox" checked={v.unattributed} onChange={(e) => set({ unattributed: e.target.checked, ...(e.target.checked ? { name: '', alias: '' } : {}) })} />
              {c.unattributedLabel}
            </label>
          )}

          <div className="mt-3.5">
            <BrewLabel>{c.categoryLabel}</BrewLabel>
            <BrewSelect value={v.category} onChange={(e) => set({ category: e.target.value as BondedInput['category'] })}>
              <option value="individual">{c.categoryIndividual}</option>
              <option value="group">{c.categoryGroup}</option>
              <option value="corporation">{c.categoryCorporation}</option>
            </BrewSelect>
          </div>

          {showName && (
            <>
              <div className="mt-3.5">
                <BrewLabel required>{nameLabel}</BrewLabel>
                <BrewInput value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder={c.namePlaceholder} />
              </div>
              <div className="mt-3.5">
                <BrewLabel>{c.aliasLabel}</BrewLabel>
                <BrewInput value={v.alias} onChange={(e) => set({ alias: e.target.value })} placeholder={c.aliasPlaceholder} />
              </div>
            </>
          )}

          <div className="mt-3.5">
            <BrewLabel>{v.status === 'living' ? c.cityLivingLabel : c.cityLabel}</BrewLabel>
            <BrewInput value={v.city} onChange={(e) => set({ city: e.target.value })} placeholder={c.cityPlaceholder} />
            {v.status === 'living' && <Note>{c.cityLivingNote}</Note>}
          </div>

          {v.status === 'living' && (
            <div className="mt-3.5">
              <BrewLabel>{c.reachLabel}</BrewLabel>
              <BrewSelect value={v.reachable} onChange={(e) => set({ reachable: e.target.value as BondedInput['reachable'] })}>
                <option value="">{c.chooseOne}</option>
                <option value="yes">{c.reachYes}</option>
                <option value="no">{c.reachNo}</option>
              </BrewSelect>
            </div>
          )}

          {v.status === 'living' && v.reachable === 'yes' && (
            <div className="mt-3.5">
              <BrewLabel>{c.contactLabel}</BrewLabel>
              <BrewInput value={v.contact} onChange={(e) => set({ contact: e.target.value })} placeholder={c.contactPlaceholder} />
              <Note>{c.contactNote}</Note>
            </div>
          )}

          {v.status === 'deceased' && (
            <div className="mt-5">
              <div className="text-[11px] uppercase tracking-[0.1em] text-ink-soft">{c.estateHead}</div>
              <Note>{c.estateIntro}</Note>
              <div className="mt-3">
                <BrewLabel>{c.estateNameLabel}</BrewLabel>
                <BrewInput value={v.estateName} onChange={(e) => set({ estateName: e.target.value })} placeholder={c.estateNamePlaceholder} />
              </div>
              <div className="mt-3.5">
                <BrewLabel>{c.estateRepLabel}</BrewLabel>
                <BrewInput value={v.estateRep} onChange={(e) => set({ estateRep: e.target.value })} placeholder={c.estateRepPlaceholder} />
              </div>
              <div className="mt-3.5">
                <BrewLabel>{c.estateContactLabel}</BrewLabel>
                <BrewInput value={v.estateContact} onChange={(e) => set({ estateContact: e.target.value })} placeholder={c.contactPlaceholder} />
                <Note>{c.estateContactNote}</Note>
              </div>
            </div>
          )}

          {known && (
            <div className="mt-5">
              <div className="text-[11px] uppercase tracking-[0.1em] text-ink-soft">{c.knownHead}</div>
              <div className="mt-3">
                <BrewLabel>{c.credentialsLabel}</BrewLabel>
                <Textarea rows={2} value={v.credentials} onChange={(x) => set({ credentials: x })} placeholder={c.credentialsPlaceholder} />
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3.5">
                <div>
                  <BrewLabel>{c.websiteLabel}</BrewLabel>
                  <BrewInput value={v.website} onChange={(e) => set({ website: e.target.value })} placeholder="https://" />
                </div>
                <div>
                  <BrewLabel>{c.instagramLabel}</BrewLabel>
                  <BrewInput value={v.instagram} onChange={(e) => set({ instagram: e.target.value })} placeholder="@handle" />
                </div>
              </div>
              <div className="mt-3.5">
                <BrewLabel>{c.aboutLabel}</BrewLabel>
                <Textarea rows={3} value={v.about} onChange={(x) => set({ about: x })} placeholder={c.aboutPlaceholder} />
              </div>
            </div>
          )}
        </>
      )}
    </BrewChrome>
  )
}

export function CollectorProvenanceStep({
  value: v,
  onChange,
  document,
  onDocument,
  onBack,
  onNext,
  onClose,
  progressPct,
}: StepProps & { document: File | null; onDocument: (f: File | null) => void }) {
  const { t } = useLocale()
  const c = t.collector
  const set = (patch: Partial<BondedInput>) => onChange({ ...v, ...patch })

  return (
    <BrewChrome onBack={onBack} backLabel={t.creator.back} onClose={onClose} progressPct={progressPct} dock={<BrewButton onClick={onNext}>{t.brew.continue}</BrewButton>}>
      <BrewTitle required>{c.provenanceTitle}</BrewTitle>
      <p className="text-[12.5px] text-ink-soft mt-1.5">{c.provenanceSub}</p>

      <div className="mt-4">
        <BrewLabel>{c.docTypeLabel}</BrewLabel>
        <BrewSelect
          value={v.docType}
          onChange={(e) => {
            const docType = e.target.value as BondedInput['docType']
            set({ docType })
            if (!docType || docType === 'none') onDocument(null)
          }}
        >
          <option value="">{c.chooseOne}</option>
          <option value="bill">{c.docBill}</option>
          <option value="gallery">{c.docGallery}</option>
          <option value="auction">{c.docAuction}</option>
          <option value="inherit">{c.docInherit}</option>
          <option value="gift">{c.docGift}</option>
          <option value="none">{c.docNone}</option>
        </BrewSelect>
      </div>

      <div className="mt-3.5">
        <BrewLabel>{c.sourceLabel}</BrewLabel>
        <BrewInput value={v.source} onChange={(e) => set({ source: e.target.value })} placeholder={c.sourcePlaceholder} />
      </div>

      <div className="grid grid-cols-2 gap-3 mt-3.5">
        <div>
          <BrewLabel>{c.acquiredLabel}</BrewLabel>
          <BrewInput value={v.acquired} onChange={(e) => set({ acquired: e.target.value })} placeholder={c.acquiredPlaceholder} />
        </div>
        <div>
          <BrewLabel>{c.pricePaidLabel}</BrewLabel>
          <BrewInput value={v.pricePaid} onChange={(e) => set({ pricePaid: e.target.value })} placeholder={c.optional} />
        </div>
      </div>
      <Note>{c.pricePaidNote}</Note>

      {v.docType !== '' && v.docType !== 'none' && (
        <div className="mt-3.5">
          <BrewLabel>{c.attachLabel}</BrewLabel>
          <label className="block border border-dashed border-hairline rounded-xl p-4 text-center text-[12.5px] text-ink-soft cursor-pointer hover:border-ink">
            {document ? document.name : c.attachPlaceholder}
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => onDocument(e.target.files?.[0] ?? null)}
            />
          </label>
          <Note>{c.attachNote}</Note>
        </div>
      )}

      <div className="mt-3.5">
        <BrewLabel>{c.provenanceLabel}</BrewLabel>
        <Textarea rows={4} value={v.provenance} onChange={(x) => set({ provenance: x })} placeholder={c.provenancePlaceholder} />
      </div>
    </BrewChrome>
  )
}
