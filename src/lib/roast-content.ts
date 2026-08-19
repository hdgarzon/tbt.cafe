/**
 * Roast — los once artículos, portados VERBATIM del prototipo.
 *
 * Es la superficie donde los clientes aprenden las reglas, y el índice del
 * handoff la nombra entre las cuatro que hay que actualizar EN LA MISMA PASADA
 * cuando cambia una regla de dinero: el código, Roast, el conocimiento del
 * asistente y la especificación. Dos veces en desarrollo una regla cambió en
 * el código y estas cuatro se quedaron atrás, produciendo material
 * confiadamente equivocado.
 *
 * Así que si tocas una tarifa, este archivo es parte del cambio.
 *
 * IDIOMA: existen solo en inglés, como los legales. Traducir explicaciones de
 * reglas de dinero sin revisarlas es la manera exacta de que digan otra cosa
 * en cada idioma.
 */

export type RoastBlock =
  | { kind: 'p'; html: string }
  /** Marca centrada con pie opcional — 'transbit' o 'brocha'. */
  | { kind: 'mark'; which: string; caption: string | null }
  /** Las tres cadenas, dibujadas en casa y no con logos de terceros. */
  | { kind: 'triad'; rows: { chain: string; role: string; detail: string }[] }
  /** Ejemplo de dinero: filas etiqueta/valor, con una final de total. */
  | { kind: 'x'; title: string; rows: { label: string; value: string; total: boolean }[] }

export type RoastArticle = {
  id: string
  title: string
  minutes: number
  summary: string
  body: RoastBlock[]
}

export const ROAST_ARTICLES: RoastArticle[] = [
  {
    "id": "what-is-a-tbt",
    "title": "What a TBT is",
    "minutes": 4,
    "summary": "Transferable Billable Token — anchored on Bitcoin, sailing on Solana, engraved in Arweave.",
    "body": [
      {
        "kind": "p",
        "html": "<b>TBT</b> stands for <b>Transferable Billable Token</b>. Each of those three words is doing work, and the last one is the noun."
      },
      {
        "kind": "p",
        "html": "A TBT <b>is a token</b>. Not a document describing a token, and not a receipt for one held elsewhere. It is an object that exists on-chain, that you hold, that moves when you move it, and that anyone can verify without asking us."
      },
      {
        "kind": "p",
        "html": "It lives across three blockchains at once — <b>anchored on Bitcoin, sailing on Solana, engraved in Arweave</b>. Each one does something the others cannot."
      },
      {
        "kind": "triad",
        "rows": [
          {
            "chain": "Bitcoin",
            "role": "Anchored",
            "detail": "A fingerprint of the record is timestamped to the most durable chain there is. It proves the record existed when we say it did, and has not been altered since — including by us."
          },
          {
            "chain": "Solana",
            "role": "Sailing",
            "detail": "The token itself lives here, and moves here. Fast enough that a transfer completes while you are still looking at the screen, and public enough that anyone can check who holds it."
          },
          {
            "chain": "Arweave",
            "role": "Engraved",
            "detail": "The record itself — title, creator, year, the statement made at registration — stored permanently, paid once, with no subscription keeping it alive."
          }
        ]
      },
      {
        "kind": "p",
        "html": "Using all three together is <b>the first of its kind</b>. Most systems pick one chain and accept its weaknesses. A TBT takes what each does best: Bitcoin’s permanence, Solana’s speed, Arweave’s storage. The result is a record that is fast to move, cheap to keep, and effectively impossible to falsify."
      },
      {
        "kind": "p",
        "html": "What the token carries is the point:"
      },
      {
        "kind": "p",
        "html": "<b>Authorship.</b> Who made the work, and when. Sealed at registration and never rewritten — the certificate of authorship lives inside the token."
      },
      {
        "kind": "p",
        "html": "<b>Ownership.</b> Who holds it now. Not our word for it: the asset sits in a wallet, and an ordinary blockchain explorer will tell you whose."
      },
      {
        "kind": "p",
        "html": "<b>History.</b> Every hand it has passed through, in order, with dates and values. Provenance that accumulates rather than resets."
      },
      {
        "kind": "p",
        "html": "<b>Commercial terms.</b> Its price, its availability, and the creator’s royalty — which travels with the token permanently and pays out on every future sale. This is the <b>billable</b> part, and it is what a certificate alone could never do."
      },
      {
        "kind": "p",
        "html": "So a certificate of authorship is one of the things a TBT holds. It is not the whole of what a TBT is."
      },
      {
        "kind": "p",
        "html": "<b>Transferable</b> means it moves, and the moving is recorded. Sell it, gift it, pass it to an institution — each movement is written to the chain and joins the history. Ownership genuinely changes hands rather than being noted in someone’s database."
      },
      {
        "kind": "p",
        "html": "<b>Billable</b> means it carries money. A price when it is for sale. A royalty that returns to the creator on every resale, <b>enforced at settlement</b> rather than left to the goodwill of whoever handles the next transaction. A work that keeps earning for the person who made it."
      },
      {
        "kind": "mark",
        "which": "transbit",
        "caption": "Where the TBT comes from"
      },
      {
        "kind": "p",
        "html": "The TBT was not invented for art. It came from <b>finance</b>, and it is still used there."
      },
      {
        "kind": "p",
        "html": "<b>Transb.it</b> built the TBT to manage transfers — value arriving in one form, such as a card payment or cash, and moving to another. The token manages the movement itself: what was paid, what is owed, where it is going, and what happens at each step. It is in use today with <b>banks, credit unions and cooperatives</b>."
      },
      {
        "kind": "p",
        "html": "That is why it works for art. The problem an artist has — proving what is theirs, moving it safely, and being paid every time it changes hands — is a transfer problem. It had already been solved somewhere more demanding."
      },
      {
        "kind": "mark",
        "which": "brocha",
        "caption": "The cultural half"
      },
      {
        "kind": "p",
        "html": "<b>BROCHA</b> — the <i>Bella Orden Rebelde de Campeones por el Arte Elevado</i> — is a decentralised collective and creative movement founded by the painter <b>Sara Alarcón</b> in Medellín. BROCHA leads the cultural side of this work and curates the first TBT-certified collection."
      },
      {
        "kind": "p",
        "html": "Sara’s leadership is the reason this is built the way it is: for the <b>artist with a phone</b>, without wallets, without jargon, without asking anyone to learn a new vocabulary in order to keep what is already theirs."
      },
      {
        "kind": "p",
        "html": "<i>“TBTs aren’t about technology. They’re about dignity. It’s about making sure a girl drawing in a village has the same global power as someone in New York or London.”</i> — Sara Alarcón"
      },
      {
        "kind": "p",
        "html": "The <b>Transferable Billable Token</b> was invented by <b>Federico Lara</b>, a futurist and technologist, and founder of Transb.it. tbt.cafe is the collaboration between Transb.it and BROCHA."
      },
      {
        "kind": "p",
        "html": "One last thing, and it is the reason for all three chains: <b>none of this depends on tbt.cafe continuing to exist.</b> The token is on Solana, the record is engraved in Arweave, the timestamp is anchored to Bitcoin. If we disappear tomorrow, what you hold survives."
      }
    ]
  },
  {
    "id": "brew-first",
    "title": "Brewing your first TBT",
    "minutes": 4,
    "summary": "What actually happens when you register a work — the two moments that matter, and what arrives on your phone.",
    "body": [
      {
        "kind": "p",
        "html": "A TBT — a <b>Transferable Billable Token</b> — is the token that holds your work’s authorship, its ownership, its history and its commercial terms. It is written to the Solana blockchain. Once brewed, anyone can verify who made the work, and when, at its public page — no wallet, no crypto knowledge, nothing to install."
      },
      {
        "kind": "p",
        "html": "Brewing has <b>two distinct moments</b>, and they are not the same thing. First you <b>seal</b> the work: that completes authorship. The Seal is your signature — after it, the record of what you made and when is fixed. Then you <b>pay</b>: that registers the sealed record to the blockchain, where it becomes publicly verifiable."
      },
      {
        "kind": "p",
        "html": "Registration costs a flat <b>$8</b>, plus card processing. That is the whole price. There is no subscription, no gas fee to worry about, no percentage of your work’s value."
      },
      {
        "kind": "p",
        "html": "<b>Your first ten registrations are on us.</b> The $8 is shown, and tbt.cafe covers it — you will see how many remain each time you register. After that, registration is charged normally."
      },
      {
        "kind": "x",
        "title": "What you pay to brew, once your first ten are used",
        "rows": [
          {
            "label": "Registration fee",
            "value": "8.00 USD",
            "total": false
          },
          {
            "label": "Card processing",
            "value": "0.53 USD",
            "total": false
          },
          {
            "label": "Total",
            "value": "8.53 USD",
            "total": true
          }
        ]
      },
      {
        "kind": "p",
        "html": "While a registration is covered, that total is <b>0.00 USD</b> to you — the fee is still $8, and tbt.cafe pays it."
      },
      {
        "kind": "p",
        "html": "When registration completes, your <b>certificate and private key arrive by MMS</b> — on your phone, and only there. They are never shown on screen, because screens get screenshotted and shared. The message is the original. Keep it."
      },
      {
        "kind": "p",
        "html": "Your first brew automatically creates “Series 1” for you. Series are how your works group together on your creator page — you can rename and reorganise them later."
      }
    ]
  },
  {
    "id": "set-royalty",
    "title": "Setting your royalty",
    "minutes": 3,
    "summary": "What the percentage means, where the money comes from, and why it locks forever at the first sale.",
    "body": [
      {
        "kind": "p",
        "html": "When you brew a work you choose a royalty — a percentage that comes back to you every time the work is sold or transferred, forever."
      },
      {
        "kind": "p",
        "html": "The royalty is <b>deducted from the sale price</b>, never added on top of it. If a work sells for 12,000 USD with a 10% royalty, the 1,200 comes out of the sale, to you — the buyer pays the 12,000 plus their own $8 service fee, and nothing more."
      },
      {
        "kind": "p",
        "html": "A royalty can be set two ways. A <b>percentage</b> moves with the price: 10% of a 12,000 sale is 1,200; 10% of a 3,000 sale is 300. A <b>fixed amount</b> does not move at all — set it at 1,200 USD and you receive 1,200 USD whatever the work sells for, on every sale and every transfer."
      },
      {
        "kind": "x",
        "title": "Fixed royalty of 1,200 USD, work sells at 5,000",
        "rows": [
          {
            "label": "Sale price",
            "value": "5,000.00 USD",
            "total": false
          },
          {
            "label": "Royalty to creator",
            "value": "1,200.00 USD",
            "total": false
          },
          {
            "label": "Service fee",
            "value": "8.00 USD",
            "total": false
          },
          {
            "label": "Card processing",
            "value": "35.33 USD",
            "total": false
          },
          {
            "label": "Seller payout",
            "value": "3,756.67 USD",
            "total": true
          }
        ]
      },
      {
        "kind": "p",
        "html": "Because a fixed royalty is owed in full whatever the price, a work carrying one has a <b>minimum price</b>: the royalty plus the greater of 5% or 25 USD. That floor covers the fees and keeps a sale from ever costing the seller money. Offers below it cannot be accepted."
      },
      {
        "kind": "x",
        "title": "A 12,000 USD sale with 10% royalty",
        "rows": [
          {
            "label": "Buyer pays",
            "value": "12,000.00 USD",
            "total": false
          },
          {
            "label": "Royalty to creator",
            "value": "1,200.00 USD",
            "total": false
          },
          {
            "label": "Seller receives (after fees)",
            "value": "10,756.67 USD",
            "total": false
          },
          {
            "label": "Nothing added at checkout",
            "value": "",
            "total": true
          }
        ]
      },
      {
        "kind": "p",
        "html": "One rule to know before you choose: <b>the royalty locks permanently at the first sale</b>. Until anyone has bought the work you can adjust the percentage freely. The moment the first sale completes, it is fixed for the life of the work — collectors who later hold the work can never change it, and neither can you."
      },
      {
        "kind": "p",
        "html": "Choose a number you’d be content with in ten years. Most creators land between 5% and 15%."
      }
    ]
  },
  {
    "id": "selling",
    "title": "Selling a work",
    "minutes": 4,
    "summary": "Availability states, what the buyer pays versus what you receive, and the full fee breakdown with real numbers.",
    "body": [
      {
        "kind": "p",
        "html": "Every work you hold has an availability state, set from its Action tab: <b>For sale</b> (anyone can buy at your price), <b>Reserved</b> (visible but on hold), or <b>Not for sale</b>. Separately, you can choose to <b>take offers</b> — buyers propose a price and you decide."
      },
      {
        "kind": "p",
        "html": "When a sale completes, three things come out of the sale price: the creator’s royalty, an <b>$8 service fee</b>, and card processing of <b>2.9% + $0.30</b> calculated on the royalty and fee together. The rest is your payout."
      },
      {
        "kind": "x",
        "title": "Selling at 18,000 USD, 10% royalty",
        "rows": [
          {
            "label": "Sale price",
            "value": "18,000.00 USD",
            "total": false
          },
          {
            "label": "Royalty to creator",
            "value": "1,800.00 USD",
            "total": false
          },
          {
            "label": "Service fee",
            "value": "8.00 USD",
            "total": false
          },
          {
            "label": "Card processing",
            "value": "52.73 USD",
            "total": false
          },
          {
            "label": "Your payout",
            "value": "16,139.27 USD",
            "total": true
          }
        ]
      },
      {
        "kind": "p",
        "html": "The buyer pays the listed price plus their own flat <b>$8 service fee</b>. The <b>$8</b> shown above is yours as the seller — the service fee is charged on both sides of a sale, once to each party. The royalty and card processing come out of your side only."
      },
      {
        "kind": "p",
        "html": "Your payout does not vanish into a balance somewhere. It accumulates in <b>Payouts</b>, where you collect it when you choose — more on that in “Collecting your payouts.”"
      }
    ]
  },
  {
    "id": "buying",
    "title": "Buying a work",
    "minutes": 4,
    "summary": "What you pay, what arrives, and what you actually own afterwards.",
    "body": [
      {
        "kind": "p",
        "html": "When a work is <b>For sale</b>, you can buy it outright. When the owner is <b>taking offers</b>, you can propose a price instead — see “Making and receiving offers.” Either way, what happens after you pay is the same."
      },
      {
        "kind": "p",
        "html": "Your total is the <b>price plus a flat $8 service fee</b>. Nothing else is added. The creator’s royalty and the card processing come out of the <b>seller’s</b> side, not yours — so what you see before you confirm is exactly what your card is charged."
      },
      {
        "kind": "x",
        "title": "Buying a work listed at 4,000 USD",
        "rows": [
          {
            "label": "Price",
            "value": "4,000.00 USD",
            "total": false
          },
          {
            "label": "Service fee",
            "value": "8.00 USD",
            "total": false
          },
          {
            "label": "You pay",
            "value": "4,008.00 USD",
            "total": true
          }
        ]
      },
      {
        "kind": "p",
        "html": "Payment is taken first. Then ownership transfers and the record is written to Solana — usually within a minute. Your <b>new certificate arrives by MMS</b>, on your phone and only there. That message is your original. Keep it."
      },
      {
        "kind": "p",
        "html": "Above certain amounts we ask for more proof that it is really you. From <b>500 USD</b> we ask for your biometric; from <b>1,000 USD</b> your bank verifies the payment as well. That second step also moves fraud liability to your bank, which protects you if a card is ever used without permission."
      },
      {
        "kind": "p",
        "html": "What you own afterwards is the <b>token itself</b> — holding the certificate of authorship, the record of custody, and the work’s commercial terms. You can hold it, transfer it, or sell it on. If you later sell, the creator’s royalty is paid from your proceeds — that is the arrangement the creator set, and it does not change hands with the work."
      },
      {
        "kind": "p",
        "html": "Your name appears as the current holder on the work’s public page. If you would rather not be named, set your collector profile to <b>anonymous</b> — the work stays public, and you show as a private collector."
      }
    ]
  },
  {
    "id": "offers",
    "title": "Making and receiving offers",
    "minutes": 3,
    "summary": "How offers move, when money actually changes hands, and what the countdown means.",
    "body": [
      {
        "kind": "p",
        "html": "An offer is a proposed price on a work — nothing more, until it is accepted. <b>No money moves when an offer is made.</b> Your card is not charged for offering, and nothing is taken from a seller for receiving one."
      },
      {
        "kind": "p",
        "html": "When a seller accepts an offer, the buyer gets a window to complete the purchase — you’ll see a countdown on the accepted offer. Only when the buyer confirms and pays does money move: the sale then settles exactly like any other sale, with the royalty and fees deducted from the agreed price."
      },
      {
        "kind": "p",
        "html": "Offers you’ve made live in <b>Offers → Made</b>, where you can cancel them. Offers on your works live in <b>Offers → Received</b>, where you respond. A declined or expired offer simply ends — no charge to anyone."
      },
      {
        "kind": "p",
        "html": "The creator’s royalty applies to offer sales the same as fixed-price sales: deducted from the agreed price, paid to the creator."
      }
    ]
  },
  {
    "id": "transfers",
    "title": "Transferring ownership",
    "minutes": 4,
    "summary": "The two-phase card hold, the 24-hour window, and why the new certificate travels by MMS.",
    "body": [
      {
        "kind": "p",
        "html": "A transfer moves a work to a specific person — a sale you’ve arranged privately, or a gift. You name the recipient, their mobile number, and the value being recorded."
      },
      {
        "kind": "p",
        "html": "The sender pays the <b>Transfer Cost</b>: the creator’s royalty on the recorded value, an $8 transfer fee, and card processing on those two together."
      },
      {
        "kind": "x",
        "title": "Transferring at 1,322 USD recorded value, 10% royalty",
        "rows": [
          {
            "label": "Royalty",
            "value": "132.20 USD",
            "total": false
          },
          {
            "label": "Transfer fee",
            "value": "8.00 USD",
            "total": false
          },
          {
            "label": "Card processing",
            "value": "4.37 USD",
            "total": false
          },
          {
            "label": "Transfer Cost",
            "value": "144.57 USD",
            "total": true
          }
        ]
      },
      {
        "kind": "p",
        "html": "Payment is <b>two-phase</b>. When you send the transfer, your card is <b>authorised but not charged</b> — the amount is held. Only when the recipient accepts is it captured. If they decline, or don’t respond within <b>24 hours</b>, or you cancel, the hold is released and nothing is taken."
      },
      {
        "kind": "p",
        "html": "When a transfer completes, the work’s new certificate and key go to the recipient <b>by MMS</b> — same rule as brewing: never on screen, only on the phone of the person who now holds the work."
      }
    ]
  },
  {
    "id": "payouts",
    "title": "Collecting your payouts",
    "minutes": 3,
    "summary": "Where your money accumulates, how collection works, and what the payout block on your receipt records.",
    "body": [
      {
        "kind": "p",
        "html": "Money you earn — from sales, and royalties on resales of your works — accumulates in <b>Payouts</b>. It waits there until you collect it; nothing is pushed to you automatically."
      },
      {
        "kind": "p",
        "html": "Collecting takes two steps: verify (your itemised payouts, confirmed with a touch), then choose a method — <b>PayPal</b>, <b>USDT</b>, or <b>BTC</b>. A <b>2.3% payout fee</b> applies, plus the method’s own cost (PayPal’s 2.9% + $0.30, or the network fee for crypto)."
      },
      {
        "kind": "x",
        "title": "Collecting 10,756.67 USD via PayPal",
        "rows": [
          {
            "label": "Gross payout",
            "value": "10,756.67 USD",
            "total": false
          },
          {
            "label": "PayPal fee",
            "value": "312.24 USD",
            "total": false
          },
          {
            "label": "Payout fee (2.3%)",
            "value": "247.40 USD",
            "total": false
          },
          {
            "label": "You receive",
            "value": "10,197.02 USD",
            "total": true
          }
        ]
      },
      {
        "kind": "p",
        "html": "When you collect, the payouts you selected are grouped into a <b>payout block</b> with an identifier like <b>PYT-BLK-7F3A92</b>. The block is a settlement record — your permanent, verifiable reference for that collection. Its receipt lists <b>every payout collected in the block</b>, so you can always see exactly which sales and royalties made up a given deposit."
      },
      {
        "kind": "p",
        "html": "Past collections live under the history icon on the Payouts page. Open any payout block to see its method, the payouts it contains, the fees, and the net you received."
      }
    ]
  },
  {
    "id": "fixed-royalty",
    "title": "Fixed royalties, and when to use one",
    "minutes": 3,
    "summary": "A royalty that does not move with the price — what it protects, and the floor it creates.",
    "body": [
      {
        "kind": "p",
        "html": "A royalty can be set two ways. A <b>percentage</b> moves with the price. A <b>fixed amount</b> does not move at all: set it at 1,200 USD and you receive 1,200 USD whatever the work sells for, on every sale and every transfer."
      },
      {
        "kind": "p",
        "html": "A fixed royalty suits work whose value you expect to hold steady, or where you want a floor under what you receive regardless of how the market moves. A percentage suits work you expect to appreciate — it rises with the price."
      },
      {
        "kind": "p",
        "html": "Because a fixed royalty is owed in full whatever the price, a work carrying one has a <b>minimum price</b>: the royalty plus the greater of 5% or 25 USD. That floor covers the fees and keeps a sale from ever costing the seller money."
      },
      {
        "kind": "x",
        "title": "A work with a 1,200 USD fixed royalty",
        "rows": [
          {
            "label": "Fixed royalty",
            "value": "1,200.00 USD",
            "total": false
          },
          {
            "label": "Floor (greater of 5% or 25)",
            "value": "60.00 USD",
            "total": false
          },
          {
            "label": "Minimum price",
            "value": "1,260.00 USD",
            "total": true
          }
        ]
      },
      {
        "kind": "p",
        "html": "Offers below the minimum cannot be accepted, and the offer sheet says so before anyone wastes an offer. If you raise a fixed royalty above what the current price supports, we lift the price to the new minimum rather than leave the work priced at a loss."
      },
      {
        "kind": "p",
        "html": "Like any royalty, the <b>type locks at the first sale</b> along with the amount. Choose deliberately — percentage and fixed behave very differently over a work’s life."
      }
    ]
  },
  {
    "id": "staying-safe",
    "title": "Keeping your work and your money safe",
    "minutes": 4,
    "summary": "The four things that protect you, and the one that matters most.",
    "body": [
      {
        "kind": "p",
        "html": "There are no accounts here — there is <b>authentication</b>. Your phone number is your identity, verified by a code. Everything else layers on top of that."
      },
      {
        "kind": "p",
        "html": "<b>Biometric</b> uses your device’s fingerprint or face. Nothing biometric ever leaves your device; we only ever learn that your device confirmed you. It is required from <b>500 USD</b>, and it is what stops someone using a session you left open."
      },
      {
        "kind": "p",
        "html": "Your <b>private code</b> is a short code only you know. It matters because it is the one thing a stolen, unlocked phone cannot supply. That is why it is required <b>every time you collect a payout</b>, and <b>whenever you change where you get paid</b> — with no minimum amount."
      },
      {
        "kind": "p",
        "html": "A <b>recovery email</b> lets you reset your private code if you forget it, and gives us a second way to reach you. It is optional in general, but required if you sell or collect — because without it, a forgotten code would lock you out of your own money."
      },
      {
        "kind": "p",
        "html": "Some notifications <b>cannot be switched off</b>: a change to your payout destination, a failed payout, and anything we flag as suspicious. If someone could silence those, they could redirect your money quietly. Leaving them on is the point."
      },
      {
        "kind": "p",
        "html": "One habit worth having: if you ever get a notification about a payout destination change you did not make, treat it as urgent and open a help request immediately. That is the single warning that matters most."
      }
    ]
  },
  {
    "id": "if-we-disappear",
    "title": "What survives if tbt.cafe disappears",
    "minutes": 3,
    "summary": "The test the whole architecture is built to pass.",
    "body": [
      {
        "kind": "p",
        "html": "A certificate that is only as durable as the company issuing it is not really a certificate — it is a subscription. So the honest question is what remains if we stop existing."
      },
      {
        "kind": "p",
        "html": "Your <b>ownership record</b> is on Solana. Anyone with an ordinary blockchain explorer can look up the asset and see who holds it. No involvement from us is required."
      },
      {
        "kind": "p",
        "html": "That asset points at your <b>registration record on Arweave</b>, stored permanently and publicly addressable. Creator, title, year, the content fingerprint, and the statement you recorded at registration. It does not sit on our servers."
      },
      {
        "kind": "p",
        "html": "And the <b>Bitcoin anchor</b> proves that record existed when it says it did and has not been altered — verifiable by anyone, using the proof file we store alongside the record."
      },
      {
        "kind": "p",
        "html": "Every step of that chain runs on infrastructure nobody at tbt.cafe operates or pays for. That is deliberate, and it is the reason the architecture has several layers rather than one convenient database."
      },
      {
        "kind": "p",
        "html": "The practical consequence for you: <b>keep the MMS</b>. Your certificate and private key arrive there and only there. The public record survives us; your private copy is yours to hold."
      }
    ]
  }
]

export function roastArticle(id: string): RoastArticle | undefined {
  return ROAST_ARTICLES.find((a) => a.id === id)
}
