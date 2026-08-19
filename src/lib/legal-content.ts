/**
 * Los cuatro documentos del pie — portados VERBATIM del prototipo.
 *
 * Dos de ellos vienen marcados `draft`, y esa marca NO es decorativa: el
 * índice del handoff lista la revisión por abogados como punto abierto, y
 * nombra en concreto la redacción de privacidad para el acceso del asistente
 * a datos y las solicitudes de borrado contra un registro inmutable en cadena.
 * Publicarlos sin la marca sería presentar un borrador como texto vigente.
 *
 * IDIOMA: existen solo en inglés. El resto de la app va en cuatro idiomas,
 * pero un texto legal traducido sin abogado no es una traducción, es un
 * documento distinto que nadie ha revisado. Se quedan en inglés hasta que
 * alguien con competencia para ello los traduzca.
 */

export type LegalBlock =
  | { kind: 'h'; text: string }
  | { kind: 'p'; html: string }
  | { kind: 'ul'; items: string[] }

export type LegalDoc = {
  slug: string
  title: string
  /** Pendiente de revisión por abogados. Se anuncia en la página. */
  draft: boolean
  body: LegalBlock[]
}

export const LEGAL_ENTITY = "88 Greenwich Ave LLC, d/b/a Transb.it"
export const LEGAL_ADDRESS = "88 Greenwich Ave, Floor 3, Greenwich, CT 06830, United States"
export const LEGAL_UPDATED = "7 August 2026"

export const LEGAL_DOCS: LegalDoc[] = [
  {
    "slug": "about",
    "title": "About",
    "draft": false,
    "body": [
      {
        "kind": "h",
        "text": "The collaboration"
      },
      {
        "kind": "p",
        "html": "tbt.cafe is a collaboration between <b>Transb.it</b> and <b>BROCHA</b>."
      },
      {
        "kind": "p",
        "html": "<b>Transb.it</b> (pronounced “Transbit”) is a hyper-financial transactional platform built to simplify and secure digital and SMS/MMS interactions — connecting high technology with human technology, so that advanced capability is usable by everyone. Transb.it is operated by 88 Greenwich Ave LLC, d/b/a Transb.it."
      },
      {
        "kind": "p",
        "html": "<b>BROCHA</b> — <i>Bella Orden Rebelde de Campeones por el Arte Elevado</i> — is a decentralised collective and creative movement founded by the painter <b>Sara Alarcón</b> in Medellín, dedicated to elevating art through collaboration, cultural rebellion and education. BROCHA curates the first TBT-certified collection and leads the cultural side of the work."
      },
      {
        "kind": "p",
        "html": "<a href=\"https://www.brocha.art/\" target=\"_blank\" rel=\"noopener\" class=\"legal-link\">brocha.art</a>"
      },
      {
        "kind": "h",
        "text": "Who invented the TBT"
      },
      {
        "kind": "p",
        "html": "The <b>Transferable Billable Token</b> was invented by <b>Federico Lara</b>, a futurist and technologist, and founder of Transb.it."
      },
      {
        "kind": "p",
        "html": "The idea came from a specific observation: that the systems for moving value across borders serve some people well and others barely at all, and that artists are among the worst served. A painter in Medellín has the same claim to protection, provenance and income as one in New York, and almost none of the same infrastructure."
      },
      {
        "kind": "h",
        "text": "Why it exists"
      },
      {
        "kind": "p",
        "html": "In an era where creative integrity is under constant threat, TBTs are built to protect, manage and monetise creative works with transparency — and without crypto wallets or technical jargon. A new kind of creative sovereignty, where <b>art earns as it moves, and its story is preserved forever</b>."
      },
      {
        "kind": "p",
        "html": "The system is built for the <b>artist with a phone</b>. Registering or transferring a work should be no harder than sending a message, and it should not require anyone to learn a new vocabulary in order to keep what is theirs."
      },
      {
        "kind": "p",
        "html": "<i>“TBTs aren’t about technology. They’re about dignity. It’s about making sure a girl drawing in a village has the same global power as someone in New York or London.”</i> — Sara Alarcón"
      },
      {
        "kind": "h",
        "text": "What we are building toward"
      },
      {
        "kind": "p",
        "html": "A world where a painting in Medellín or a sketch in Bogotá is globally protected, instantly verifiable, and perpetually profitable for the person who made it — with the record outlasting the platform that created it."
      },
      {
        "kind": "h",
        "text": "Contact"
      },
      {
        "kind": "p",
        "html": "88 Greenwich Ave LLC, d/b/a Transb.it<br>88 Greenwich Ave, Floor 3, Greenwich, CT 06830, United States"
      }
    ]
  },
  {
    "slug": "terms",
    "title": "Terms of Service",
    "draft": true,
    "body": [
      {
        "kind": "h",
        "text": "1. Who you are contracting with"
      },
      {
        "kind": "p",
        "html": "tbt.cafe is operated by <b>88 Greenwich Ave LLC, d/b/a Transb.it</b>, 88 Greenwich Ave, Floor 3, Greenwich, CT 06830, United States. In these terms, \"we\", \"us\" and \"tbt.cafe\" mean that entity. \"You\" means the person or organisation using the platform."
      },
      {
        "kind": "h",
        "text": "2. What a TBT is"
      },
      {
        "kind": "p",
        "html": "A <b>TBT — Transferable Billable Token</b> — is a blockchain token, issued on Solana, that holds a work’s authorship record, its current ownership, its transfer history, and its commercial terms including any royalty."
      },
      {
        "kind": "p",
        "html": "A certificate of authorship is one of the things the token carries. It is <b>not</b> the whole of what a TBT is, and what you acquire when you buy a TBT is <b>the token and everything it holds</b>."
      },
      {
        "kind": "p",
        "html": "A TBT is <b>not</b>:"
      },
      {
        "kind": "ul",
        "items": [
          "a licence to use the underlying work;",
          "a transfer of copyright or any other intellectual property right in the underlying work;",
          "a security, investment contract, or instrument offered for its potential to appreciate;",
          "a guarantee of value, resale, or market for any work."
        ]
      },
      {
        "kind": "p",
        "html": "Rights in the underlying work remain with whoever holds them and are a matter between the parties involved. Selling a TBT transfers the token, its authorship record, and the record of custody — nothing more."
      },
      {
        "kind": "h",
        "text": "3. Authentication, not accounts"
      },
      {
        "kind": "p",
        "html": "tbt.cafe has <b>authentication</b>, not accounts. Your identity rests on a mobile number verified by code, and on the security factors you add: a recovery email, a private code, and biometric confirmation on your device."
      },
      {
        "kind": "p",
        "html": "You are responsible for keeping these factors secure and for everything done through your verified identity. If you believe your identity or device has been compromised, contact us immediately."
      },
      {
        "kind": "h",
        "text": "4. Custody"
      },
      {
        "kind": "p",
        "html": "We generate and hold the blockchain keys associated with your TBTs, so that you can use the platform without a crypto wallet or technical knowledge. You direct what happens to your TBTs; we execute those instructions."
      },
      {
        "kind": "p",
        "html": "Your certificate and private key are delivered by <b>MMS only</b> and are never displayed on screen. That message is your copy. We cannot retrieve a delivered key for you, and you should keep the message."
      },
      {
        "kind": "h",
        "text": "5. Registration"
      },
      {
        "kind": "p",
        "html": "Registering a work has two distinct moments. <b>Sealing</b> completes the authorship record. <b>Registration</b> writes it to the blockchain. Registration costs a flat <b>$8</b> plus card processing."
      },
      {
        "kind": "p",
        "html": "A creator’s <b>first ten registrations are paid for by tbt.cafe</b>. The fee is shown and absorbed by us. Only a completed registration counts against that allowance. We may vary or withdraw this programme for future registrations at any time; allowances already used are unaffected."
      },
      {
        "kind": "p",
        "html": "You warrant that you hold the rights necessary to register any work you submit, and that doing so infringes nobody else’s rights. Submissions are scanned before registration, and we may block or reverse a registration we believe to be infringing or fraudulent."
      },
      {
        "kind": "h",
        "text": "6. Sales, fees and royalties"
      },
      {
        "kind": "p",
        "html": "On a sale, the <b>buyer pays the price plus a flat $8 service fee</b>. The <b>seller has a separate $8 service fee deducted</b> from their proceeds, along with the creator’s royalty and card processing. The service fee is charged once to each party."
      },
      {
        "kind": "p",
        "html": "A royalty may be set as a <b>percentage</b> of the sale or as a <b>fixed amount</b>. Either way it is deducted from the seller’s proceeds and is <b>never added to the buyer’s price</b>."
      },
      {
        "kind": "p",
        "html": "A royalty <b>locks permanently at the first sale</b> — both its amount and its type. Before that, the creator may change it freely."
      },
      {
        "kind": "p",
        "html": "Where a work carries a fixed royalty, it has a <b>minimum price</b>: the royalty plus the greater of 5% or $25. Prices and offers below that minimum cannot be set or accepted."
      },
      {
        "kind": "h",
        "text": "7. Transfers"
      },
      {
        "kind": "p",
        "html": "A transfer moves a TBT to a named recipient. The sender pays the transfer cost — any royalty, the service fee, and card processing. The sender’s card is <b>authorised, not charged</b>, and captured only when the recipient accepts. If the recipient does not accept within 24 hours, or the sender cancels, the authorisation is released."
      },
      {
        "kind": "p",
        "html": "A fixed royalty is owed in full on a transfer whatever value is recorded, including a transfer at zero value."
      },
      {
        "kind": "h",
        "text": "8. Payouts and settlement"
      },
      {
        "kind": "p",
        "html": "Money owed to you is <b>not immediately collectable</b>. It is held for a settlement period — currently seven days, or fourteen days above $1,000 — before becoming available. Amounts arising from transfers and offers are released when the counterparty completes."
      },
      {
        "kind": "p",
        "html": "Collecting a payout carries a platform fee of <b>2.3%</b> of the gross plus the cost of your chosen method. You will see the gross, the fees, and the net before confirming."
      },
      {
        "kind": "p",
        "html": "You are responsible for providing accurate payout details, and for any tax arising on income you receive. We may be required to collect tax information from you and to report payments made to you."
      },
      {
        "kind": "h",
        "text": "9. The blockchain record is permanent"
      },
      {
        "kind": "p",
        "html": "Registrations, transfers and ownership changes are written to public blockchains and to permanent storage. <b>They cannot be edited, reversed, or deleted — including by us.</b> That permanence is the point of the platform."
      },
      {
        "kind": "p",
        "html": "Where a record needs correction, we can annotate it or issue a superseding record. We cannot erase what has been written."
      },
      {
        "kind": "h",
        "text": "10. What we do not promise"
      },
      {
        "kind": "p",
        "html": "We do not guarantee that a work will sell, at what price, or that any market will exist for it. We do not verify the artistic merit, provenance beyond our own records, or legal status of any work. The platform is provided as it is, and we exclude warranties to the fullest extent the law allows."
      },
      {
        "kind": "h",
        "text": "11. Suspension"
      },
      {
        "kind": "p",
        "html": "We may suspend or restrict access where we reasonably believe there is fraud, infringement, abuse, or a legal requirement to do so. Where we can, we will tell you why."
      },
      {
        "kind": "h",
        "text": "12. Changes"
      },
      {
        "kind": "p",
        "html": "We may change these terms. Material changes will be notified in the platform and by email where we hold one. Continuing to use tbt.cafe after a change means accepting it."
      },
      {
        "kind": "h",
        "text": "13. Governing law"
      },
      {
        "kind": "p",
        "html": "<b>[Governing law and jurisdiction — to be confirmed by counsel.]</b> This clause is deliberately unfilled pending legal review."
      },
      {
        "kind": "h",
        "text": "14. Contact"
      },
      {
        "kind": "p",
        "html": "88 Greenwich Ave LLC, d/b/a Transb.it<br>88 Greenwich Ave, Floor 3, Greenwich, CT 06830, United States<br>Support requests are best raised through the Help Request tab inside the platform."
      }
    ]
  },
  {
    "slug": "security",
    "title": "Security",
    "draft": false,
    "body": [
      {
        "kind": "h",
        "text": "How your identity works"
      },
      {
        "kind": "p",
        "html": "tbt.cafe has <b>authentication, not accounts</b>. Your mobile number is your identity, verified by a code. Everything else layers on top."
      },
      {
        "kind": "ul",
        "items": [
          "<b>Biometric</b> — your device’s fingerprint or face. Nothing biometric ever leaves your device; we learn only that your device recognised you.",
          "<b>Private code</b> — a short code only you know. It matters because it is the one factor a stolen, unlocked phone cannot supply.",
          "<b>Recovery email</b> — lets you reset your private code, and gives us a second way to reach you."
        ]
      },
      {
        "kind": "h",
        "text": "More proof for more money"
      },
      {
        "kind": "p",
        "html": "We ask for more confirmation as the amount rises — the same idea applied consistently."
      },
      {
        "kind": "ul",
        "items": [
          "From <b>$500</b>: biometric confirmation.",
          "From <b>$1,000</b>: biometric, and your bank verifies the payment. That second step also moves fraud liability to your bank, which protects you.",
          "<b>Collecting a payout</b>, and <b>changing where you get paid</b>: biometric and your private code, at any amount. Redirecting payment is what an attacker would try first, so it is the most heavily guarded action on the platform."
        ]
      },
      {
        "kind": "h",
        "text": "Notifications that cannot be silenced"
      },
      {
        "kind": "p",
        "html": "A change to your payout destination, a failed payout, and anything we flag as suspicious will always reach you. If those could be switched off, someone could redirect your money quietly."
      },
      {
        "kind": "p",
        "html": "If you are ever told your payout destination changed and it was not you, treat it as urgent and open a help request immediately."
      },
      {
        "kind": "h",
        "text": "Payments"
      },
      {
        "kind": "p",
        "html": "Card details are entered inside <b>Stripe</b> and never reach tbt.cafe. We hold a reference, never your card number. Payments are screened for fraud, and card verification checks run on every transaction."
      },
      {
        "kind": "h",
        "text": "Your certificate and key"
      },
      {
        "kind": "p",
        "html": "Your certificate and private key arrive by <b>MMS only</b>, and are never shown on screen — screens get photographed and shared. That message is the original. Keep it."
      },
      {
        "kind": "h",
        "text": "The record itself"
      },
      {
        "kind": "p",
        "html": "Ownership is written to <b>Solana</b>. The record is stored permanently on <b>Arweave</b>. A fingerprint of it is <b>anchored to Bitcoin</b>, which proves the record existed when we say it did and has not been altered since — including by us."
      },
      {
        "kind": "p",
        "html": "None of that depends on tbt.cafe continuing to exist."
      }
    ]
  },
  {
    "slug": "privacy",
    "title": "Privacy Policy",
    "draft": true,
    "body": [
      {
        "kind": "h",
        "text": "1. Who controls your information"
      },
      {
        "kind": "p",
        "html": "<b>88 Greenwich Ave LLC, d/b/a Transb.it</b>, 88 Greenwich Ave, Floor 3, Greenwich, CT 06830, United States, is responsible for the personal information described here."
      },
      {
        "kind": "h",
        "text": "2. What we collect"
      },
      {
        "kind": "ul",
        "items": [
          "<b>Identity</b> — your mobile number (verified by code), and, where you provide them, your legal name, public alias, entity or collective name, and recovery email.",
          "<b>Works</b> — what you register: title, description, images or media links, and the context recorded at registration.",
          "<b>Transactions</b> — purchases, sales, offers, transfers, payouts, and the amounts involved.",
          "<b>Payout details</b> — bank or wallet destinations, held so we can pay you.",
          "<b>Support</b> — help requests you open, and conversations with the AI assistant.",
          "<b>Technical</b> — device, browser, approximate location and IP, used for security and fraud prevention."
        ]
      },
      {
        "kind": "h",
        "text": "3. What we do not collect"
      },
      {
        "kind": "p",
        "html": "<b>Card details never reach us.</b> Payments are handled inside Stripe; we receive a reference, never your card number."
      },
      {
        "kind": "p",
        "html": "<b>Biometric data never leaves your device.</b> When you confirm with a fingerprint or face, your device tells us only that it recognised you. We never receive, store, or see the biometric itself."
      },
      {
        "kind": "h",
        "text": "4. What is public"
      },
      {
        "kind": "p",
        "html": "Some information is <b>public by design</b>, because verifiable provenance is the purpose of the platform. A work’s authorship, its registration date, its transfer history and its current holder are written to public blockchains and visible to anyone."
      },
      {
        "kind": "p",
        "html": "If you would rather not be named publicly as a holder, you can set your collector profile to <b>anonymous</b> — the work stays public and you appear as a private collector."
      },
      {
        "kind": "h",
        "text": "5. The AI assistant"
      },
      {
        "kind": "p",
        "html": "The assistant can see <b>your own</b> platform data — your works, transactions, payouts and support requests — so that it can answer usefully about your situation. It cannot access anyone else’s information."
      },
      {
        "kind": "p",
        "html": "Conversations are retained so we can improve support and resolve disputes. They are treated with the same protection as the underlying records."
      },
      {
        "kind": "h",
        "text": "6. Who we share with"
      },
      {
        "kind": "ul",
        "items": [
          "<b>Stripe</b> — to take payments and make payouts.",
          "<b>Twilio</b> — to send verification codes, certificates and keys by SMS and MMS.",
          "<b>SendGrid</b> — to send email notifications.",
          "<b>Public blockchains</b> — Solana, Arweave and Bitcoin, for the records described above.",
          "<b>Our AI provider</b> — to operate the assistant.",
          "<b>Authorities</b> — where we are legally required."
        ]
      },
      {
        "kind": "p",
        "html": "We do not sell your personal information."
      },
      {
        "kind": "h",
        "text": "7. Deletion, and what cannot be deleted"
      },
      {
        "kind": "p",
        "html": "You may ask us to delete your personal information, and we will do so where we can."
      },
      {
        "kind": "p",
        "html": "<b>We cannot delete what is written to a public blockchain.</b> Registration records, ownership and transfer history are permanent and beyond our control — that permanence is what makes a TBT worth holding. Before you register a work, please understand that its authorship record is intended to outlast us and cannot be withdrawn."
      },
      {
        "kind": "p",
        "html": "What we can do is remove or anonymise the information held in our own systems, and disconnect it from your identity, subject to records we are required to keep."
      },
      {
        "kind": "h",
        "text": "8. Your choices"
      },
      {
        "kind": "ul",
        "items": [
          "Notification preferences, in Settings. Some protective notifications — a change to your payout destination, a failed payout, suspicious activity — cannot be switched off, because silencing them would put your money at risk.",
          "Anonymous collector display, in your collector profile.",
          "Access to, correction of, or a copy of your information, by request."
        ]
      },
      {
        "kind": "h",
        "text": "9. Retention"
      },
      {
        "kind": "p",
        "html": "We keep personal information for as long as you use tbt.cafe, and afterwards where we need it for legal, tax, accounting or dispute purposes. Blockchain records are permanent."
      },
      {
        "kind": "h",
        "text": "10. International transfer"
      },
      {
        "kind": "p",
        "html": "We operate from the United States and work with creators and collectors across Latin America, Europe and elsewhere. Your information may be processed in countries other than your own."
      },
      {
        "kind": "h",
        "text": "11. Changes and contact"
      },
      {
        "kind": "p",
        "html": "We will notify material changes in the platform and by email where we hold one. Questions about this policy can be raised through the Help Request tab, or in writing to 88 Greenwich Ave LLC, d/b/a Transb.it, 88 Greenwich Ave, Floor 3, Greenwich, CT 06830, United States."
      }
    ]
  }
]

export function legalDoc(slug: string): LegalDoc | undefined {
  return LEGAL_DOCS.find((d) => d.slug === slug)
}
