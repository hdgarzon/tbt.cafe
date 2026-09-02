import { readFileSync } from 'fs'
import { join } from 'path'
import { retrieve, KNOWLEDGE, type Locale } from '../src/lib/assistant/knowledge'
import { FEE, ROYALTY_FLOOR } from '../src/lib/fees'
import { parseReply } from '../src/lib/assistant/provider'

/**
 * Lo que el asistente sabe, y lo que la aplicación le promete que sabe.
 *
 * Las tres preguntas sugeridas son las que la propia pantalla pone delante de
 * quien llega. «How do I collect payouts?» no recuperaba NADA en los cuatro
 * idiomas, y «How do I brew a TBT?» solo alcanzaba el documento de la tarifa —
 * que habla de dinero, no del proceso. El asistente contestaba, correctamente,
 * que no sabía; el hueco estaba en la base.
 *
 * Se comprueba contra las cadenas de i18n, no contra una lista aquí: un chip
 * nuevo, o una traducción que use otra palabra, cae solo.
 */

const LOCALES: Locale[] = ['en', 'es', 'pt', 'fr']

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const dict = (l: Locale) =>
  JSON.parse(readFileSync(join(process.cwd(), `src/i18n/messages/${l}.json`), 'utf8'))

// ---- lo que la pantalla ofrece, la base lo tiene
{
  for (const locale of LOCALES) {
    const suggestions: string[] = dict(locale).assistant?.suggestions ?? []
    ok(`${locale}: hay preguntas sugeridas`, suggestions.length > 0)
    for (const q of suggestions) {
      const hits = retrieve(q, locale)
      ok(`${locale}: «${q}»`, hits.length > 0,
         'la aplicación la sugiere y la base no tiene nada que responder')
    }
  }
}

// ---- cada documento habla los cuatro idiomas
{
  for (const doc of KNOWLEDGE) {
    const faltan = LOCALES.filter((l) => !doc.body[l]?.trim() || !doc.terms[l]?.length)
    ok(`'${doc.id}' completo en los cuatro`, faltan.length === 0, faltan.join(', '))
  }
  ok('los identificadores no se repiten',
     new Set(KNOWLEDGE.map((d) => d.id)).size === KNOWLEDGE.length)
}

// ---- LAS CIFRAS SE DERIVAN, NO SE ESCRIBEN
//
// Es la regla que el propio módulo declara: dos veces en este proyecto una regla
// de dinero cambió en el código mientras la documentación se quedaba atrás. Se
// mira el CUERPO del archivo, sin comentarios — la prosa que explica la regla
// cita las cifras a propósito, y cazarla sería la trampa de siempre.
{
  const src = readFileSync(join(process.cwd(), 'src/lib/assistant/knowledge.ts'), 'utf8')
  const body = src
    .slice(src.indexOf('export const KNOWLEDGE'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

  // `$0` es deliberado: «nunca se presenta como $0» es la frase, no una cifra.
  const dinero = (body.match(/\$(?!\{)\d+/g) ?? []).filter((m) => m !== '$0')
  ok('ninguna cantidad escrita a mano', dinero.length === 0, dinero.join(', '))

  const pct = body.match(/(?<!\{[^}]*)\b\d+(?:[.,]\d+)?\s*%/g) ?? []
  ok('ningún porcentaje escrito a mano', pct.length === 0, pct.join(', '))

  ok('la tarifa viene de FEE', body.includes('${FEE}'))
  ok('el piso viene de ROYALTY_FLOOR',
     body.includes('${FLOOR_MIN}') && body.includes('${FLOOR_PCT}'))
  ok('el procesamiento viene de stripePct', body.includes('${STRIPE_PCT}'))
}

// ---- y los valores derivados son los que el resto del sistema usa
{
  const reg = KNOWLEDGE.find((d) => d.id === 'registration_fee')!
  ok('la tarifa que se cuenta es la que se cobra', reg.body.en.includes(`$${FEE.service}`))
  const roy = KNOWLEDGE.find((d) => d.id === 'royalties')!
  ok('el piso que se cuenta es el que se aplica',
     roy.body.en.includes(`$${ROYALTY_FLOOR.min}`) &&
     roy.body.en.includes(`${ROYALTY_FLOOR.pct * 100}%`))
}

// ---- una respuesta cortada no tumba la conversación
//
// `JSON.parse` sobre una respuesta truncada lanza «Unterminated string», y eso
// subía como un 500: la conversación entera se caía por ser la respuesta larga.
// Se vio en el log cuatro veces seguidas al alargar la base de conocimiento.
{
  const entera = '{"text": "Registering happens in Brew.", "cta": null, "escalate": false}'
  const cortada = '{"text": "Registering happens in Brew. You need a creator profile fi'

  const a = parseReply(entera)
  ok('una respuesta entera se lee igual', a.text === 'Registering happens in Brew.' && !a.escalate)

  let salvada: ReturnType<typeof parseReply> | null = null
  try { salvada = parseReply(cortada) } catch { /* cae abajo */ }
  ok('una cortada se rescata en vez de lanzar', salvada !== null)
  ok('  y conserva lo que alcanzó a decir',
     (salvada?.text ?? '').startsWith('Registering happens in Brew.'))
  ok('  y se marca para que la retome una persona', salvada?.escalate === true,
     'media respuesta presentada como completa es peor que un error')

  const porTope = parseReply(entera, 'MAX_TOKENS')
  ok('quedarse sin sitio también escala', porTope.escalate === true)

  let lanzo = false
  try { parseReply('esto no es json ni por asomo') } catch { lanzo = true }
  ok('lo irrecuperable sí lanza', lanzo, 'inventar una respuesta sería peor que fallar')
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
