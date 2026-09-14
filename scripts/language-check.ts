import { readFileSync } from 'fs'
import { join } from 'path'
import { retrieve, KNOWLEDGE, type Locale } from '../src/lib/assistant/knowledge'
import { ROAST_ARTICLES } from '../src/lib/roast-content'

/**
 * El lenguaje dice lo que el producto hace — Work Order 01, Steps 10 y 11.
 *
 * Unas veinte frases no eran un nombre viejo: afirmaban que un certificado y una
 * clave privada llegaban por MMS y no se mostraban nunca en pantalla. El producto
 * ya no hace nada de eso — emite un titulo, lo manda por correo con un SMS que
 * confirma el envio, y no entrega ninguna clave. La version 11 del prototipo no
 * tiene una sola aparicion de esas palabras; estos tres archivos tampoco.
 *
 * Y la regalia se bifurca una vez: en una obra registrada por un coleccionista es
 * del registrante. En la de un creador sigue siendo del creador, y eso no se toca.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const hits = (text: string, re: RegExp) => text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) ?? []

const FILES = ['src/lib/roast-content.ts', 'src/lib/legal-content.ts', 'src/lib/assistant/knowledge.ts']

// ---- cero apariciones, como en la version 11
{
  const FORBIDDEN: [string, RegExp][] = [
    ['certificate', /\bcertificates?\b/i],
    ['certificado (sustantivo)', /\bcertificados?\b/i],
    ['certificat', /\bcertificats?\b/i],
    ['transfer code', /transfer code/i],
    ['MMS only', /MMS only/i],
    ['private key', /private key|clave privada|llave privada|chave privada|clé privée/i],
    ['nunca en pantalla', /never (shown|displayed) on screen/i],
  ]
  for (let f = 0; f < FILES.length; f++) {
    const text = read(FILES[f])
    for (let i = 0; i < FORBIDDEN.length; i++) {
      const [name, re] = FORBIDDEN[i]
      const found = hits(text, re)
      ok(`${FILES[f]}: sin «${name}»`, found.length === 0, found.slice(0, 3).join(', '))
    }
  }

  ok('roast: sin MMS', hits(read('src/lib/roast-content.ts'), /\bmms\b/i).length === 0)
  ok('asistente: sin MMS, tampoco como termino de busqueda', hits(read('src/lib/assistant/knowledge.ts'), /\bmms\b/i).length === 0)
  const legal = read('src/lib/legal-content.ts')
  ok(
    'legal: el unico MMS es el de Transb.it en «About»',
    hits(legal, /\bMMS\b/).length === 1 && legal.includes('SMS/MMS interactions'),
    'lo conserva la version 11: describe a la empresa, no la entrega del titulo'
  )
}

// ---- la regalia se bifurca una vez, y la del creador no se reescribe
{
  const text = read('src/lib/roast-content.ts')
  ok('«registrant royalty» aparece una sola vez', hits(text, /registrant royalty/).length === 1)

  const article = ROAST_ARTICLES.find((a) => a.id === 'set-royalty')
  const body = article ? article.body : []
  const last = body.slice(-2).map((b) => (b.kind === 'p' ? b.html : '')).join(' ')
  ok('y es al final del articulo de la regalia', last.includes('registrant royalty') && last.includes('redirected'))
  ok(
    'las filas «Royalty to creator» siguen siendo tres',
    hits(text, /"Royalty to creator"/).length === 3,
    'en una obra de creador sigue siendo una regalia de creador'
  )
}

// ---- el asistente encuentra el titulo en los cuatro idiomas
{
  ok('el documento se llama title_delivery', KNOWLEDGE.some((d) => d.id === 'title_delivery'))
  ok('y no queda el viejo', !KNOWLEDGE.some((d) => d.id === 'certificate_delivery'))

  const ASKS: [Locale, string][] = [
    ['en', 'Where is my title?'],
    ['es', '¿Dónde está mi título?'],
    ['pt', 'Onde está meu título?'],
    ['fr', 'Où est mon titre ?'],
  ]
  for (let i = 0; i < ASKS.length; i++) {
    const [locale, q] = ASKS[i]
    const first = retrieve(q, locale)[0]
    ok(`${locale}: «${q}» recupera el titulo`, first?.id === 'title_delivery', first?.id ?? 'nada')
  }
  const phone = retrieve('I lost my phone', 'en')[0]
  ok('«I lost my phone» sigue siendo autenticacion', phone?.id === 'authentication', phone?.id ?? 'nada')
}

// ---- el correo, mientras llega el de la Stage 5
{
  const email = read('src/app/api/send-email/route.ts')
  ok('TBT no se expande como «Token Basado en Trabajo»', !email.includes('Token Basado en Trabajo'))
  ok('se expande como Transferable Billable Token', hits(email, /TBT - Transferable Billable Token/).length === 2)
  ok(
    'el boton no promete un certificado',
    !/Ver (mi|tu) certificado TBT/i.test(email),
    'el enlace lleva a la pagina de la obra, no a un titulo'
  )
  ok('sin «ID de Certificación» ni «DETALLES DE TU CERTIFICACIÓN»', !email.includes('ID de Certificación') && !email.includes('DETALLES DE TU CERTIFICACIÓN'))
}

// ---- el resto del producto que habla del titulo
//
// Los tickets de sistema, la notificacion de registro, la tarjeta OG, la
// descripcion del sitio y el panel. La notificacion prometia ademas una llave de
// transferencia en el telefono: la llave no existe desde la migracion 046.
{
  const MORE = [
    'src/lib/system-tickets.ts',
    'src/lib/email-templates.ts',
    'src/lib/og-copy.ts',
    'src/app/layout.tsx',
    'src/app/admin/page.tsx',
    'src/lib/solana/config.ts',
  ]
  const NOUN = /\bcertificates?\b|\bcertificats?\b|\bcertificados?\b/i
  for (let f = 0; f < MORE.length; f++) {
    const found = hits(read(MORE[f]), NOUN)
    ok(`${MORE[f]}: sin «certificate»`, found.length === 0, found.slice(0, 3).join(', '))
  }

  const templates = read('src/lib/email-templates.ts')
  ok(
    'la notificacion de registro no promete una llave',
    !/transfer key|llave de transferencia|chave de transferência|clé de transfert/i.test(templates),
    'la llave no existe desde la migracion 046'
  )
  ok(
    'ni algo enviado al telefono',
    !/sent to your phone|enviaron a tu teléfono|enviados para o seu telefone|envoyés à votre téléphone/i.test(templates)
  )
  ok(
    'el ticket de entrega fallida no menciona una llave',
    !/and key did not|y su llave|e a chave|et sa clé/.test(read('src/lib/system-tickets.ts'))
  )
  ok(
    'el aviso de Twilio habla del titulo',
    read('src/app/api/twilio/status/route.ts').includes("subject: 'title delivery failed'")
  )
}

// ---- los catalogos de la interfaz, en los cuatro idiomas
//
// La pantalla final de Brew decia que el certificado, con la clave privada de
// transferencia, se habia enviado al telefono, y enseñaba el numero. Nada de eso
// ocurre. «Certificado» como estado de la obra —certificada, certificado— es un
// adjetivo, no el documento, y se queda.
{
  // Adjetivos y participios: el estado de la obra, lo que alguien ha
  // certificado, lo que aun no se puede certificar. Ninguno nombra el documento.
  const ADJECTIVE_KEYS = [
    'work.certified',
    'myCollections.statusCertified',
    'myCollections.eventCreation',
    'myCollections.creationsSub',
    'myCollections.creationsEmpty',
    'brew.scanBlockTitle',
  ]
  const DOC = /\bcertificates?\b|\bcertificats?\b|\bcertificados?\b/i
  const SECRET = /private key|transfer key|clave privada|clave de transferencia|llave privada|chave privada|chave de transferência|clé privée|clé de transfert/i
  const LANGS = ['en', 'es', 'pt', 'fr']

  const walk = (node: unknown, path: string, out: [string, string][]) => {
    if (typeof node === 'string') out.push([path, node])
    else if (Array.isArray(node)) for (let i = 0; i < node.length; i++) walk(node[i], `${path}.${i}`, out)
    else if (node && typeof node === 'object') {
      const keys = Object.keys(node as Record<string, unknown>)
      for (let i = 0; i < keys.length; i++) walk((node as Record<string, unknown>)[keys[i]], path ? `${path}.${keys[i]}` : keys[i], out)
    }
  };

  for (let l = 0; l < LANGS.length; l++) {
    const values: [string, string][] = []
    walk(JSON.parse(read(`src/i18n/messages/${LANGS[l]}.json`)), '', values)
    const doc: string[] = []
    const secret: string[] = []
    const mms: string[] = []
    for (let i = 0; i < values.length; i++) {
      const [path, value] = values[i]
      if (DOC.test(value) && ADJECTIVE_KEYS.indexOf(path) === -1) doc.push(path)
      if (SECRET.test(value)) secret.push(path)
      if (/\bMMS\b/.test(value)) mms.push(path)
    }
    ok(`${LANGS[l]}.json: ningun valor nombra un certificado`, doc.length === 0, doc.join(', '))
    ok(`${LANGS[l]}.json: ninguno promete una clave`, secret.length === 0, secret.join(', '))
    ok(`${LANGS[l]}.json: ninguno habla de MMS`, mms.length === 0, mms.join(', '))
  }

  const wizard = read('src/components/brew/BrewWizard.tsx')
  ok(
    'la tarjeta final no pone un telefono detras del titulo enviado',
    wizard.includes('{t.brew.certSentTo}') && !/\{t\.brew\.certSentTo\}\s*\{maskedPhone/.test(wizard),
    'el titulo va por correo; enseñar el numero dice lo contrario'
  )
  ok('el SMS no ofrece «Ver certificado»', !read('src/app/api/send-sms/route.ts').includes('Ver certificado'))
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
