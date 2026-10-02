import { readFileSync } from 'fs'
import { join } from 'path'
import { saleQuote, minPriceFor, royaltyAmountOf, transferQuote, cents, type Royalty } from '../src/lib/fees'
import { testRules } from './rules-fixture'

/**
 * La aritmetica del dinero — Work Order 02, Stage 0.1 y 0.2a.
 *
 * Procesamiento = 2.9% x cargo + $0.30, redondeado hacia arriba desde medio
 * centavo, donde cargo = precio + tarifa de servicio del comprador. Las cinco
 * filas de referencia de 0.1d, diez mil precios y regalias al azar que cuadran
 * al centavo (comprador = vendedor + regalia neta + plataforma + procesamiento),
 * y el piso de una regalia fija, que nunca deja al vendedor en cero o menos
 * despues de la comision de cobro.
 */

const RULES = testRules()
const pct = (v: number): Royalty => ({ type: 'percentage', value: v })
const fix = (v: number): Royalty => ({ type: 'fixed', value: v })
const none: Royalty = { type: 'none', value: 0 }
let bad = 0
const eq = (label: string, got: number | null, want: number | null) => {
  const ok = got === want || (got !== null && want !== null && Math.abs(got - want) < 0.005)
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${got === null ? '—' : got.toFixed(2)} (esperado ${want === null ? '—' : want.toFixed(2)})`)
}
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

// ---- 0.1d: las cinco filas
//       precio  regalia     comprador  procesamiento  regalia neta  plataforma  vendedor   app fee
const ROWS: [number, Royalty, number, number, number | null, number, number, number][] = [
  [12000, pct(10), 12008.0, 348.53, 1192.0, 24.0, 10443.47, 1564.53],
  [18000, pct(10), 18008.0, 522.53, 1792.0, 24.0, 15669.47, 2338.53],
  [45000, pct(10), 45008.0, 1305.53, 4492.0, 24.0, 39186.47, 5821.53],
  [5000, fix(1200), 5008.0, 145.53, 1192.0, 24.0, 3646.47, 1361.53],
  [2000, none, 2008.0, 58.53, null, 16.0, 1933.47, 74.53],
]
for (let i = 0; i < ROWS.length; i++) {
  const [price, r, buyer, proc, earning, platform, seller, appFee] = ROWS[i]
  const d = saleQuote({ price, royalty: r, path: 'direct' }, RULES)
  eq(`${price} comprador`, d.buyerTotal, buyer)
  eq(`${price} procesamiento`, d.processing, proc)
  eq(`${price} regalia neta`, d.royaltyGross > 0 ? d.royaltyEarning : null, earning)
  eq(`${price} plataforma`, d.platformTake, platform)
  eq(`${price} vendedor`, d.sellerNet, seller)
  eq(`${price} app fee (directa)`, d.applicationFee, appFee)
  const p = saleQuote({ price, royalty: r, path: 'platform' }, RULES)
  ok(`${price} plataforma: sin app fee, mismas cifras`, p.applicationFee === null && p.sellerNet === d.sellerNet && p.processing === d.processing)
}

// ---- 0.2a: diez mil al azar, al centavo
{
  let seed = 20260930
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  let unbalanced = 0
  let feeMismatch = 0
  let first = ''
  for (let i = 0; i < 10000; i++) {
    const price = Math.round(rand() * 5_000_000) / 100 + 1
    const kind = i % 3
    const r: Royalty = kind === 0 ? none : kind === 1 ? pct(Math.round(rand() * 900) / 10) : fix(Math.round(rand() * price * 50) / 100)
    const q = saleQuote({ price, royalty: r, path: 'direct' }, RULES)
    const lhs = cents(q.buyerTotal)
    const rhs = cents(q.sellerNet) + cents(q.royaltyEarning) + cents(q.platformTake) + cents(q.processing)
    if (lhs !== rhs) {
      unbalanced++
      if (!first) first = `${price} ${JSON.stringify(r)}: ${lhs} vs ${rhs}`
    }
    // 0.1b: el vendedor recibe cargo − app fee, que es su neto.
    if (cents(q.charge) - cents(q.applicationFee ?? 0) !== cents(q.sellerNet)) feeMismatch++
  }
  ok('diez mil ventas cuadran al centavo', unbalanced === 0, `${unbalanced} sin cuadrar; primera: ${first}`)
  ok('en la via directa, cargo − app fee = neto del vendedor', feeMismatch === 0, `${feeMismatch} discrepancias`)
}

// ---- 0.2a: el piso de una regalia fija nunca deja al vendedor en cero tras la comision de cobro
{
  const collection = RULES.payouts.platformPct
  let worst = Infinity
  for (let r = 1; r <= 50000; r += r < 100 ? 1 : r < 1000 ? 7 : 113) {
    const floor = minPriceFor(fix(r), RULES)
    const net = saleQuote({ price: floor, royalty: fix(r), path: 'platform' }, RULES).sellerNet * (1 - collection)
    if (net < worst) worst = net
  }
  ok('en el piso, el vendedor recibe mas de cero despues del 2.3%', worst > 0, `peor caso ${worst.toFixed(2)}`)
}

// ---- lo que no cambia
eq('regalia fija en transferencia de 0', transferQuote(0, fix(1200), false, RULES).royalty, 1200)
eq('regalia % en transferencia de 0', transferQuote(0, pct(10), false, RULES).royalty, 0)
eq('sin piso en porcentaje', minPriceFor(pct(10), RULES), 0)
eq('piso D-8, regalia 200', minPriceFor(fix(200), RULES), 250)
eq('piso D-8, regalia 1200', minPriceFor(fix(1200), RULES), 1320)
eq('tarifa de comprador de configuracion', saleQuote({ price: 1000, royalty: pct(10), path: 'direct' }, testRules({ service_fee_buyer: 9 })).buyerTotal, 1009)
eq('tarifa de transferencia de configuracion', transferQuote(0, pct(10), false, testRules({ transfer_fee: 5 })).transferFee, 5)
eq('resolucion sin regalia', royaltyAmountOf(none, 5000), 0)

// ---- 0.1a: nada mas calcula una tarifa
{
  const fees = readFileSync(join(__dirname, '..', 'src/lib/fees.ts'), 'utf8')
  ok('la aritmetica anterior se borro', !/export function quote\(/.test(fees))
  ok('la tabla de referencia de fees.ts es la de 0.1d', /10,443\.47/.test(fees) && !/10,756\.67/.test(fees))
}

console.log(bad === 0 ? '\nTODAS LAS CIFRAS COINCIDEN' : `\n${bad} DISCREPANCIAS`)
process.exit(bad === 0 ? 0 : 1)
