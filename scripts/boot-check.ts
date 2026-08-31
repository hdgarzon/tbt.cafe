import * as ts from 'typescript'
import { readdirSync, statSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Ningún módulo se cae por un secreto de tiempo de ejecución — al IMPORTARSE.
 *
 * Next importa cada ruta durante el build para recoger los datos de página. Un
 * módulo que lanza en su cuerpo, o que construye un cliente ahí, no falla
 * cuando alguien lo llama: falla al construir, y se lleva el despliegue entero
 * por delante aunque la ruta afectada no se use.
 *
 * Le costó a este repo los previews en rojo durante semanas —`lib/stripe.ts` se
 * arregló por eso— y luego otra vez con `api/stripe/webhook`, que se quedó
 * atrás con su propio `throw` y su propio `createClient`:
 *
 *   Error: SUPABASE_SERVICE_ROLE_KEY is required for the Stripe webhook
 *   Failed to collect page data for /api/stripe/webhook
 *
 * LA REGLA NO ES «NUNCA LANCES AL IMPORTAR»
 *
 * Es: no lances por un secreto de TIEMPO DE EJECUCIÓN. Las `NEXT_PUBLIC_*` se
 * incrustan al construir, así que si faltan la aplicación no puede funcionar en
 * el navegador y caerse en el build es lo correcto — por eso `lib/supabase.ts`
 * pasa, y pasa por la regla, no por una lista de excepciones.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const files: string[] = []
const walk = (d: string) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n)
    if (statSync(p).isDirectory()) walk(p)
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) files.push(p)
  }
}
walk('src')

/** Lo que abre una conexión o lee una credencial en cuanto se evalúa. */
const CONSTRUCTORS = /^(createClient|createAdminClient|createRouteClient|createAuthServerClient|getMetaplex|getPayerKeypair)$/
const NEW_CONSTRUCTORS = /^(Stripe|S3Client|SNSClient|Twilio)$/

type Finding = { line: number; what: string }

function inspect(file: string): { findings: Finding[]; runtimeSecrets: string[] } {
  const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const findings: Finding[] = []
  const runtimeSecrets: string[] = []
  const lineOf = (n: ts.Node) => src.getLineAndCharacterOfPosition(n.getStart()).line + 1

  // Qué variables de entorno se leen EN EL CUERPO del módulo, no dentro de una
  // función. Es lo que decide si un throw de arriba es legítimo.
  const collectEnv = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && node.expression.getText() === 'process.env') {
      const name = node.name.getText()
      if (!name.startsWith('NEXT_PUBLIC_')) runtimeSecrets.push(name)
    }
    if (!ts.isFunctionLike(node)) ts.forEachChild(node, collectEnv)
  }

  for (const st of src.statements) {
    collectEnv(st)

    if (ts.isThrowStatement(st)) findings.push({ line: lineOf(st), what: 'throw al importar' })

    if (ts.isIfStatement(st)) {
      const body = st.thenStatement
      const throws = ts.isThrowStatement(body) || (ts.isBlock(body) && body.statements.some(ts.isThrowStatement))
      if (throws) findings.push({ line: lineOf(st), what: 'if (...) throw al importar' })
    }

    const flagInit = (node: ts.Node, line: number) => {
      if (ts.isCallExpression(node) && CONSTRUCTORS.test(node.expression.getText())) {
        findings.push({ line, what: `${node.expression.getText()}() al importar` })
      }
      if (ts.isNewExpression(node) && NEW_CONSTRUCTORS.test(node.expression.getText())) {
        findings.push({ line, what: `new ${node.expression.getText()}() al importar` })
      }
    }

    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (d.initializer) flagInit(d.initializer, lineOf(d))
      }
    }
    if (ts.isExpressionStatement(st)) flagInit(st.expression, lineOf(st))
  }

  return { findings, runtimeSecrets }
}

const offenders: string[] = []
let scanned = 0

for (const file of files) {
  const { findings, runtimeSecrets } = inspect(file)
  scanned++
  // Sin secretos de ejecución arriba, un throw al importar es una comprobación
  // de build legítima y se deja pasar.
  if (!findings.length || !runtimeSecrets.length) continue
  offenders.push(`${file} — ${findings.map((f) => `${f.line}: ${f.what}`).join(' · ')} (lee ${Array.from(new Set(runtimeSecrets)).join(', ')})`)
}

ok(`se revisaron ${scanned} módulos`, scanned > 100, 'el recorrido no encontró el árbol')
ok('ningún módulo se cae al importarse por un secreto de ejecución', offenders.length === 0,
   '\n     ' + offenders.join('\n     '))

// Y las dos que ya se arreglaron, para que no vuelvan.
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
{
  const hook = read('src/app/api/stripe/webhook/route.ts')
  ok('el webhook construye su cliente al usarlo', hook.includes('client ??= createAdminClient()'))
  ok('y usa el único service-role del proyecto', !hook.includes("from '@supabase/supabase-js'"))

  const stripeLib = read('src/lib/stripe.ts')
  ok('stripe sigue siendo perezoso', stripeLib.includes('function stripeClient()'))

  const browser = read('src/lib/supabase.ts')
  ok('el cliente del navegador puede seguir cayéndose al construir',
     browser.includes('NEXT_PUBLIC_SUPABASE_ANON_KEY') && !browser.includes('SERVICE_ROLE'),
     'sus variables se incrustan al construir: ahí un fallo es la respuesta correcta')
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
