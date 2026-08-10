import { quote, minPriceFor, royaltyAmountOf, transferQuote, type Royalty } from '../src/lib/fees'
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
  const q = quote(price, r)
  eq(`venta ${price} comprador`, q.buyerTotal, buyer)
  eq(`venta ${price} procesamiento`, q.processing, proc)
  eq(`venta ${price} vendedor`, q.sellerNet, seller)
}
// §2.2 tabla del piso
const floors: [number, number, number][] = [
  [50, 75, 15.02], [200, 225, 10.67], [500, 525, 1.97], [1200, 1260, 16.67], [20000, 21000, 411.47],
]
for (const [r, floor, payout] of floors) {
  eq(`piso regalía ${r}`, minPriceFor(fix(r)), floor)
  eq(`vendedor en el piso ${r}`, quote(floor, fix(r)).sellerNet, payout)
}
// §2.3 regalía fija completa en donación de valor cero
eq('regalía fija en transferencia de 0', transferQuote(0, fix(1200), false).royalty, 1200)
eq('regalía % en transferencia de 0', transferQuote(0, pct(10), false).royalty, 0)
eq('sin piso en porcentaje', minPriceFor(pct(10)), 0)
eq('resolución sin regalía', royaltyAmountOf({ type: 'none', value: 0 }, 5000), 0)
console.log(bad === 0 ? '\nTODAS LAS CIFRAS COINCIDEN' : `\n${bad} DISCREPANCIAS`)
process.exit(bad === 0 ? 0 : 1)
