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

// ---- el asistente, abierto a quien todavía no se ha unido
{
  const chat = read('src/components/AssistantChat.tsx')
  const route = read('src/app/api/assistant/route.ts')
  const ctx = read('src/lib/assistant/context.ts')
  const feed = read('src/components/NotificationFeed.tsx')

  ok('el icono del header abre el panel, sin preguntar',
     shell.includes('onNotifications={() => setNotifOpen(true)}'),
     'era el gate de fuera: sin sesión el panel no llegaba a abrirse')
  ok('la pestaña del asistente ya no exige sesión',
     !chat.includes('if (signedIn === false)'),
     'es la única superficie cuyo trabajo es explicar la plataforma a quien no se ha unido')
  ok('y envía sin cabecera cuando no la hay',
     chat.includes('...(session ? { Authorization: `Bearer ${session.access_token}` } : {})'))
  ok('la de notificaciones SIGUE cerrada', feed.includes('if (signedIn === false)'),
     'es personal por definición y no tiene nada que enseñarle a una visita')

  ok('el servidor ya no rechaza sin sesión',
     !route.includes('if (!auth.ok) return NextResponse.json(auth.body'))
  ok('y solo carga el contexto personal si hay quien',
     route.includes('auth.ok ? await loadPersonContext(auth.supabase, auth.user.id) : null'))
  ok('el conocimiento se recupera igual para todos',
     route.includes('const docs = retrieve(question, locale)'),
     'retrieve() es puro sobre documentos estáticos y no toca dato de nadie')

  ok('a una visita se le DICE que lo es', ctx.includes('You are speaking to a visitor who has not signed in.'),
     'un contexto vacío el modelo lo lee como «no tiene nada», y de ahí inventa una cifra')
  ok('y que no invente cifras', ctx.includes('Never estimate, guess or invent a figure about them.'))

  ok('escalar sin destinatario pide la sesión en ese momento',
     route.includes('needsSignIn = true') && chat.includes('if (body.needsSignIn) openAuth()'),
     'un ticket sin persona a quien responder no es una escalada')
}

// ---- el asistente no manda a nadie a una página que no existe
//
// Abrirlo a visitas lo sacó a la luz: lo que inventa con más naturalidad al
// hablar con quien no ha entrado es `/signin`, y aquí autenticarse es un sheet.

{
  const { ALLOWED_CTA } = require('../src/lib/assistant/provider') as { ALLOWED_CTA: readonly string[] }
  const provider = read('src/lib/assistant/provider.ts')

  ok('el enlace se compara contra una lista, no contra «empieza por /»',
     provider.includes('(ALLOWED_CTA as readonly string[]).includes(parsed.cta.href)') &&
     !provider.includes("parsed.cta.href?.startsWith('/') ? parsed.cta"))
  ok('y al modelo se le dice que no hay página de acceso',
     provider.includes('There is NO sign-in page'))

  /** Existe si hay carpeta con ese nombre, o si el padre tiene un segmento dinámico. */
  const routeExists = (route: string): boolean => {
    const parts = route.replace(/^\//, '').split('/')
    let dir = join(process.cwd(), 'src/app')
    for (const part of parts) {
      const literal = join(dir, part)
      try {
        if (statSync(literal).isDirectory()) { dir = literal; continue }
      } catch { /* sigue: puede ser dinámico */ }
      const dynamic = readdirSync(dir).find((n) => n.startsWith('[') && n.endsWith(']'))
      if (!dynamic) return false
      dir = join(dir, dynamic)
    }
    return true
  }
  const missing = ALLOWED_CTA.filter((route) => !routeExists(route))
  ok(`las ${ALLOWED_CTA.length} rutas ofrecidas existen en src/app`, missing.length === 0,
     'no existen: ' + missing.join(', '))
  ok('y ninguna es la de acceso inventada',
     !ALLOWED_CTA.some((r) => ['/signin', '/login', '/account'].includes(r)))
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
