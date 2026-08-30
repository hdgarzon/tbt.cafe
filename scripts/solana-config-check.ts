/** En mainnet, el endpoint publico no vale. Prueba primero. */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

type Config = typeof import('../src/lib/solana/config')

/**
 * El modulo lee la red AL IMPORTARSE y el RPC AL LLAMARSE, asi que el entorno
 * tiene que seguir en pie mientras corre la asercion. Restaurarlo antes —como
 * haria un `finally` alrededor del require— deja a `getRpcUrl` leyendo la
 * variable ya borrada.
 */
function withEnv<T>(env: Record<string, string | undefined>, fn: (m: Config) => T): T {
  const previous = { ...process.env }
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  for (const key of Object.keys(require.cache)) {
    if (key.includes('solana/config')) delete require.cache[key]
  }
  try {
    return fn(require('../src/lib/solana/config') as Config)
  } finally {
    process.env = previous
  }
}

// ---- devnet: el publico es lo correcto
withEnv({ SOLANA_NETWORK: 'devnet', SOLANA_RPC_URL: undefined }, (m) => {
  ok('devnet usa el endpoint publico', m.getRpcUrl().includes('devnet'))
})

// ---- mainnet sin la variable: se dice, no se degrada
withEnv({ SOLANA_NETWORK: 'mainnet-beta', SOLANA_RPC_URL: undefined }, (m) => {
  let threw = false
  let message = ''
  try {
    m.getRpcUrl()
  } catch (e) {
    threw = true
    message = (e as Error).message
  }
  ok('mainnet sin RPC propio lanza', threw, 'caeria al endpoint publico en silencio')
  ok('y el mensaje nombra la variable', message.includes('SOLANA_RPC_URL'))
})

// ---- mainnet con la variable: la usa
withEnv({ SOLANA_NETWORK: 'mainnet-beta', SOLANA_RPC_URL: 'https://rpc.example.com' }, (m) => {
  ok('mainnet usa el RPC configurado', m.getRpcUrl() === 'https://rpc.example.com')
})

// ---- el enlace del explorador distingue la red
withEnv({ SOLANA_NETWORK: 'devnet' }, (m) => {
  ok('devnet lleva su parametro de cluster', m.getExplorerUrl('abc').includes('cluster=devnet'))
})
withEnv({ SOLANA_NETWORK: 'mainnet-beta', SOLANA_RPC_URL: 'https://rpc.example.com' }, (m) => {
  ok('mainnet no lo lleva', !m.getExplorerUrl('abc').includes('cluster='))
})

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
