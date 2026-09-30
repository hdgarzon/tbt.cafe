import { quote, minPriceFor, royaltyAmountOf, transferQuote, type Royalty } from '../src/lib/fees'
import { testRules } from './rules-fixture'

// La aritmetica se prueba con reglas fijadas aqui. Las tablas §1.1 y §2.2 se
// escribieron con el piso anterior (5% / $25); se conservan con esas reglas
// para que la formula siga cuadrando al centavo, y el piso D-8 (10% / $50, el
// valor por defecto de 058) tiene su propia tabla.
const RULES = testRules()
const OLD_FLOOR = testRules({ royalty_floor_pct: 5, royalty_floor_min: 25 })
const pct = (v: number): Royalty => ({ type: 'percentage', value: v })
const fix = (v: number): Royalty => ({ type: 'fixed', value: v })
let bad = 0
const eq = (label: string, got: number, want: number) => {
  const ok = Math.abs(got - want) < 0.005
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${got.toFixed(2)} (esperado ${want.toFixed(2)})`)
}
// §1.1 tabla de referencia
const rows: [number, Royalty, number, number, number][] = [
  [12000, pct(10), 12008, 35.33, 10756.67],
  [18000, pct(10), 18008, 52.73, 16139.27],
  [45000, pct(10), 45008, 131.03, 40360.97],
  [5000, fix(1200), 5008, 35.33, 3756.67],
]
for (const [price, r, buyer, proc, seller] of rows) {
  const q = quote(price, r, RULES)
  eq(`venta ${price} comprador`, q.buyerTotal, buyer)
  eq(`venta ${price} procesamiento`, q.processing, proc)
  eq(`venta ${price} vendedor`, q.sellerNet, seller)
}
// §2.2 tabla del piso
const floors: [number, number, number][] = [
  [50, 75, 15.02], [200, 225, 10.67], [500, 525, 1.97], [1200, 1260, 16.67], [20000, 21000, 411.47],
]
for (const [r, floor, payout] of floors) {
  eq(`piso regalía ${r}`, minPriceFor(fix(r), OLD_FLOOR), floor)
  eq(`vendedor en el piso ${r}`, quote(floor, fix(r), OLD_FLOOR).sellerNet, payout)
}
// §2.3 regalía fija completa en donación de valor cero
eq('regalía fija en transferencia de 0', transferQuote(0, fix(1200), false, RULES).royalty, 1200)
eq('regalía % en transferencia de 0', transferQuote(0, pct(10), false, RULES).royalty, 0)
eq('sin piso en porcentaje', minPriceFor(pct(10), RULES), 0)
// D-8: la regalía más el mayor entre el 10% de la regalía y $50
eq('piso D-8, regalía 200', minPriceFor(fix(200), RULES), 250)
eq('piso D-8, regalía 1200', minPriceFor(fix(1200), RULES), 1320)
// Las tarifas salen de la fila: con otras cifras, otro total
eq('tarifa de comprador de configuración', quote(1000, pct(10), testRules({ service_fee_buyer: 9 })).buyerTotal, 1009)
eq('tarifa de transferencia de configuración', transferQuote(0, pct(10), false, testRules({ transfer_fee: 5 })).transferFee, 5)
eq('resolución sin regalía', royaltyAmountOf({ type: 'none', value: 0 }, 5000), 0)
console.log(bad === 0 ? '\nTODAS LAS CIFRAS COINCIDEN' : `\n${bad} DISCREPANCIAS`)
process.exit(bad === 0 ? 0 : 1)
