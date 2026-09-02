import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/**
 * Autenticar en el punto de consecuencia, y ofreciendo el paso.
 *
 * Gating Spec 01. Una acción que necesita sesión abre la autenticación y se
 * COMPLETA después. No falla en silencio, no escribe una frase y para, y no
 * cierra la puerta de una sala en la que la visita era bienvenida.
 *
 * `RoastQuestions.tsx` ya lo hacía bien y es la referencia. Esto comprueba que
 * el resto lo hace igual — y sobre construcciones del código, nunca sobre la
 * prosa que las explica.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const shell = read('src/components/AppShell.tsx')
const gate = read('src/components/SignInGate.tsx')
const favData = read('src/lib/favorites-data.ts')
const actions = read('src/components/WorkActions.tsx')
const curation = read('src/components/CurationModal.tsx')

// ---- la reanudación
{
  ok('openAuth acepta una acción pendiente', shell.includes('openAuth: (options?: { resume?: () => void }) => void'))
  ok('se guarda envuelta en una función',
     shell.includes('setResumeAfterAuth(() => options?.resume ?? null)'),
     'sin el envoltorio React la trataría como actualizador y la EJECUTARÍA sin sesión')
  ok('cancelar la descarta', shell.includes('onClose={() => closeAuth(false)}'),
     'una acción que sobrevive a un «no» se dispara sola la próxima vez')
  ok('el teléfono la reanuda', shell.includes('closeAuth(true)'))
  ok('y el biométrico también', shell.split('closeAuth(true)').length - 1 >= 2,
     'entrar con huella tiene que reanudar igual que entrar con código')
}

// ---- favoritos: informar, ofrecer, reanudar
{
  ok('la capa de datos informa en la forma de la casa',
     favData.includes("return { error: 'needSignIn' as const }"))
  ok('y ya no devuelve un false mudo',
     !/if \(!user\) return false\n\n  const already/.test(favData),
     'ese false acababa en setSaved y el corazón no se llenaba')
  ok('el componente ofrece el paso y reanuda',
     actions.includes('openAuth({ resume: onFavorite })'))
}

// ---- curación: la puerta va al abrir
{
  const effect = curation.slice(curation.indexOf('useEffect(() => {'), curation.indexOf('if (!open || !target) return null'))
  ok('se comprueba la sesión AL ABRIR', effect.includes('openAuth()'),
     'comprobarlo al publicar tira el trabajo ya escrito')
  ok('y el envío conserva su respaldo, con reanudación',
     curation.includes('openAuth({ resume: submit })'))
  ok('el modal no se cierra al pedir sesión', !effect.includes('onClose()'),
     'el sheet se abre encima; cerrarlo obligaría a escribirlo todo otra vez')
}

// ---- la puerta compartida
{
  ok('la puerta lleva botón', gate.includes('openAuth({ resume: onSignedIn })'))
  ok('y reusa una cadena que ya existe en los cuatro idiomas', gate.includes('t.header.signIn'))

  for (const page of ['favorites', 'creations', 'acquisitions']) {
    const src = read(`src/app/collections/${page}/page.tsx`)
    ok(`/collections/${page} ofrece la salida`, src.includes('<SignInGate'))
    ok(`  y vuelve a cargarse al entrar`, src.includes('onSignedIn={load}'),
       'la sesión se comprueba una vez al montar: sin esto se queda en la misma frase')
  }
}

// ---- la trampa del evento como opciones
{
  const files: string[] = []
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.tsx')) files.push(p)
    }
  }
  walk('src')
  const offenders = files.filter((f) => readFileSync(f, 'utf8').includes('onClick={openAuth}'))
  ok('nadie pasa el evento del clic como opciones', offenders.length === 0,
     offenders.join(', ') + ' — onClick={openAuth} manda un MouseEvent donde van las opciones')
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
