# TBT-5 · Paso 2: cómo se envía el ACH a la cuenta de EE. UU.

Informe antes de construir, para la decisión 95 (enmienda *US bank payouts 01*). No se ha
construido nada ni se ha tocado producción. El código que se cita es `origin/main` @ `6bf4615`.

- **Fecha:** 11 de noviembre de 2026. Todas las fuentes se consultaron ese día.
- **Documentos de base**, descargados de TBT-5 y comprobados contra el md5 que muestra la tarea:
  - `TBT_WO02_Amendment_US_Bank_Payouts_01.docx`: 17 563 bytes, md5 `322f8dc22c4d62d9456fbd3cd5fb7630` ✔
  - `TBT_Work_Order_02_Text.md`: 68 500 bytes, md5 `7799b838957ec9d004796ff737d82226` ✔ (con los
    Sets 6 y 7; sustituye a la versión de 45 297 bytes)
- **Etiquetas:** **[V]** significa verificado en una fuente oficial citada. **[I]** significa
  inferido: lo deduzco, pero ninguna fuente lo dice. **[P]** significa pendiente de una prueba o de
  una respuesta por escrito.

---

## 1. Respuesta corta

1. **Stripe no puede enviar este ACH** a personas que viven fuera de los países de cuenta completa.
   Ninguna de sus vías encaja:
   - **Connect.** Su vía transfronteriza solo llega a EE. UU., Reino Unido, EEE, Canadá y Suiza, y
     excluye a las cuentas con acuerdo de *recipient* [V].
   - **Global Payouts.** Sí envía ACH a cuentas de EE. UU., pero solo a destinatarios cuyo país es
     EE. UU. Colombia, Argentina, Brasil y Chile no están en su tabla [V].
   - **El objetivo de fondo tampoco se cumple.** Con Global Payouts, verificar al destinatario es
     responsabilidad nuestra [V]. Stripe no recoge TIN ni W-8BEN [V]. La plataforma entra en el
     flujo del dinero, con la cuestión de licencia que eso abre [V].
   - Quedan dos pruebas en el sandbox para confirmarlo en la API (§4).
2. **ARQ no es quien envía.** Es donde la persona tiene la cuenta de EE. UU. que recibe: a su
   nombre, en Lead Bank [V]. No encontré API de pagos masivos para plataformas [I]. ARQ resuelve la
   cuenta del vendedor, no los cuatro requisitos del lado que paga.
3. **Propuesta: Trolley** como proveedor que envía el ACH.
   - **Documentado:** filtro de sanciones (estado AML por destinatario), recogida de W-8/W-9 con
     retención y presentación 1099/1042, nombre exacto del titular obligatorio en la cuenta
     bancaria, ACH doméstico a USD 1 [V].
   - **Sin documentar:** si compara el nombre con el banco, si verifica la titularidad, si bloquea
     el pago sin formulario fiscal y si acepta a un residente en Colombia con cuenta de EE. UU. [P].
   - **Costo fijo:** ≈ **USD 6 000/año** (Pay + Tax + Trust), más cargos por uso.
   - **Alternativa:** Tipalti, solo con presupuesto a medida.
4. **Hueco nuevo que la enmienda da por resuelto.** §1 exige que el titular coincida con la
   *identidad verificada*. Fuera de Connect, tbt.cafe no verifica identidad: `legal_name` lo
   escribe la propia persona (`profile/creator`). Hace falta un verificador de identidad para la
   vía ACH: Trolley Trust o Stripe Identity (§5.3).
5. **No hay motivo de STOP AND ASK** mientras Trolley (o Tipalti) confirme por escrito los puntos
   [P] de §5.2. Si ninguno verifica el nombre y filtra sanciones antes de pagar, sí lo hay.

---

## 2. Lo que exige la enmienda (§1, resumido)

| Requisito | Texto de §1, en corto |
|---|---|
| Ruta | País de cuenta completa (`provider_countries.merchant`): Connect, tal cual. Resto de países habilitados: ACH a una cuenta de EE. UU. a nombre de la persona (o razón social), enviado por tbt.cafe. |
| Antes del primer ACH | (1) el titular coincide con la identidad verificada; (2) la cuenta está verificada; (3) filtro de sanciones; (4) W-8BEN (no estadounidense) o W-9 (estadounidense) archivado y reportes presentados donde toque. El proveedor lo elige tbt.cafe; cumplirlo no es opcional. |
| ACH devuelto | Las ganancias vuelven a cobrables, el destino queda fallido, aviso `payout_failed` (variante devuelto) y ticket. |
| STOP AND ASK | Si ningún proveedor verifica el nombre y filtra sanciones antes de pagar, o si no se pueden recoger y presentar los formularios fiscales. |

---

## 3. Stripe: qué permite y qué no

**Hecho de partida.** El operador es **88 Greenwich Ave LLC**, en Connecticut, EE. UU.
(`src/lib/legal-content.ts`). Una plataforma de EE. UU. es remitente válido para las dos vías.

### 3.1 Connect con una cuenta bancaria de EE. UU. como cuenta externa: **no**

- **[V] Regiones transfronterizas.** Las plataformas de EE. UU., Reino Unido, EEE, Canadá o Suiza
  pueden transferir a cuentas conectadas solo dentro de esas regiones. Para cualquier otro país,
  Stripe remite a ventas o a Global Payouts.
  ([Connect cross-border payouts](https://docs.stripe.com/connect/cross-border-payouts))
- **[V] Cuentas *recipient*.** La misma página dice que no hay pagos transfronterizos a cuentas
  bajo acuerdo de *recipient*, y remite a Global Payouts. Nuestro alta crea cuentas v2 con
  `configuration.recipient` (`src/app/api/payouts/connect/route.ts`).
- **[V] País del banco.** La regla de Stripe es una cuenta bancaria física en el país de la cuenta
  Stripe, en una moneda admitida, y no virtual. Excepciones: USD en Canadá y EUR en la mayoría de
  Europa.
  ([Stripe Support: requisitos para abrir cuenta en otro país](https://support.stripe.com/questions/requirements-to-open-a-stripe-account-in-another-country))
- **[V] Formatos.** Colombia y Argentina figuran como "solo cuentas de Connect cross-border
  payouts", con formato de banco local (código de banco de 3 dígitos en CO, CBU en AR).
  ([Bank account formats](https://docs.stripe.com/connect/payouts-bank-accounts))
- **[I]** Una cuenta conectada CO no acepta como cuenta externa una de EE. UU. Lo prueba la fila C1
  de §4.
- **[I]** Abrir al vendedor una cuenta conectada **de país EE. UU.** no es salida: exige datos
  fiscales y domicilio de EE. UU., y declararlos sin tenerlos falsea la identidad.

### 3.2 Global Payouts: **envía ACH, pero no a nuestros destinatarios**

[Global Payouts](https://docs.stripe.com/global-payouts) ·
[Recipient requirements](https://docs.stripe.com/global-payouts/recipient-requirements) ·
[Create recipients](https://docs.stripe.com/global-payouts/recipient-creation) ·
[Comparación con Connect](https://docs.stripe.com/connect/cross-border-payouts-to-recipients/compare-global-payouts)

| Punto | Lo que dice Stripe | |
|---|---|---|
| Quién envía | Empresas de GB y US (EU y AU en vista previa privada). Requiere **Treasury** con una cuenta financiera fondeada. | [V] |
| ACH | Existe la capacidad `bank_accounts.ach` del destinatario, con el país en `identity.country`. Para remitente US, la fila *United States · USD · Local bank method* pide solo correo y nombre. | [V] |
| Nuestros países | Colombia, Argentina, Brasil y Chile **no aparecen** como país de destinatario, ni en local ni por wire. México y Perú sí, pero en MXN y PEN a banco local: no es ACH a una cuenta de EE. UU. | [V] |
| País del destinatario | El país del destinatario determina los métodos. Para los 1099, Stripe usa el país de la dirección del destinatario, o `identity.country` si no hay dirección. Poner `us` a alguien que vive en Colombia sería declarar un dato falso que además alimenta los formularios fiscales. | [V] la regla, [I] la conclusión |
| Licencia | La comparación ubica Global Payouts en marketplaces con licencias de transmisor (MTL). La plataforma financia los pagos desde su propia cuenta y forma parte del flujo, y Stripe advierte que puede hacer falta una MTL. Connect, en cambio, queda cubierto por la licencia de Stripe. | [V] |
| Identidad y verificación | Al destinatario se le piden pocos datos. Stripe dice que verificar a los destinatarios y recoger lo necesario es responsabilidad del negocio. La titularidad vía Financial Connections está en **vista previa** con lista de espera. | [V] |
| Sanciones | Las páginas no describen ningún filtro sobre destinatarios del que se pueda depender. | [V] (ausencia) |
| Fiscal | Los 1099 están en vista previa privada, solo en modo live y solo para destinatarios de EE. UU. *"Global Payouts doesn't collect TINs from recipients"*; Stripe no los verifica con el IRS. No hay W-8BEN. ([Tax reporting](https://docs.stripe.com/global-payouts/tax-reporting)) | [V] |
| Riesgo | Solo se cancela mientras está en curso. Las reversiones no están garantizadas y hay que pedirlas en 24 h. | [V] |
| Claves | Funciona con claves de sandbox. En live exige una clave restringida, no `sk_live`. | [V] |

**Conclusión [I].** Aunque se forzara el país, Global Payouts deja de nuestro lado justo lo que
Federico quería en Stripe: identidad, sanciones e impuestos. Además mete a tbt.cafe en el flujo
del dinero.

### 3.3 W-8 / W-9 en Stripe

**[V]** Stripe recoge W-9, W-8BEN y W-8BEN-E y puede pausar los pagos de quien no lo entregue.
Pero está en **vista previa privada para empresas de EE. UU.** y es para **cuentas conectadas**
sin Dashboard completo. Con Global Payouts no está disponible. El precio por formulario solo se ve
en el Dashboard. ([W-8 and W-9 tax forms](https://docs.stripe.com/connect/w8-w9-tax-forms))

Sirve para la vía Connect que ya existe, no para la vía ACH.

### 3.4 Costos de Stripe (referencia)

- **[V] Connect** (modelo "you handle pricing"): USD 2 por cuenta activa al mes, 0,25 % + USD 0,25
  por payout, transfronterizo desde 0,25 %.
- **[V] 1099:** USD 2,99 por formulario al IRS, USD 1,49 por estado y USD 2,99 por envío postal.
- **[V] Global Payouts** no publica precio en esa página.
- Fuente: [Connect pricing](https://stripe.com/connect/pricing).

---

## 4. Pruebas en el sandbox: **[P] pendientes**

El script de prueba (`probe.mjs`) queda fuera del repositorio porque no es código del producto.
Crea cuentas y métodos de pago de prueba con datos ficticios (`Cliente Demo`,
`cliente.demo+…@example.com`, ruta de prueba `110000000`). No mueve dinero. Lee la clave solo de
la variable `STRIPE_TEST_KEY` y se niega a correr si no empieza por `sk_test_` o `rk_test_`. No
lee ningún `.env`. Ya se comprobó que sin clave sale sin hacer nada.

Henry lo corre con la clave escrita sin eco, para que no quede en el historial:

```bash
read -s STRIPE_TEST_KEY && export STRIPE_TEST_KEY && node probe.mjs; unset STRIPE_TEST_KEY
```

| Fila | Qué hace | Esperado según la documentación | Resultado |
|---|---|---|---|
| C1 | Cuenta Connect CO (*recipient*) con cuenta externa de EE. UU. | Rechazo | [P] |
| C2 | Cuenta Connect CO (*recipient*) sin banco | Rechazo o creación (aclara si una plataforma US puede abrir cuentas CO) | [P] |
| C3 | Control: cuenta Connect US con cuenta de EE. UU. | Se crea | [P] |
| G1 | Control: destinatario de Global Payouts US con `bank_accounts.ach` | Se crea (o "Treasury no habilitado", que también es dato) | [P] |
| G2 | Destinatario de Global Payouts CO con `bank_accounts.ach` | Rechazo | [P] |
| G3 | Destinatario de Global Payouts CO con `bank_accounts.local` | Rechazo: CO no está en la tabla | [P] |
| G4 | Si G2 o G3 se crean: cuenta de EE. UU. para ese destinatario CO | Rechazo | [P] |
| G5 | Control: cuenta de EE. UU. para el destinatario US | Se crea | [P] |

**Intento del 11 de noviembre:** las seis llamadas volvieron con `401 api_key_expired`. Es la
misma clave de test que ya había caducado el 6 de noviembre. No se creó nada en el sandbox. Las
filas siguen pendientes hasta que se rote la clave de test.

**Regla:** si alguna fila contradice lo esperado (sobre todo G2 o G4 aceptados), cambian §1 y §3 y
hay que avisar a Federico antes de construir.

Sin depender del sandbox, conviene pedir a ventas de Stripe un "no" por escrito. La propia
documentación remite a ventas para lo que no es autoservicio.

---

## 5. Si Stripe no puede: el proveedor

### 5.1 ARQ: el lado que recibe, no el que envía

- **[V]** Cada usuario recibe número de cuenta y de ruta propios. El beneficiario es **su propio
  nombre**, el banco es **Lead Bank** y la cuenta es corriente.
  ([ARQ: transferencias wire a ARQ](https://www.arqfinance.com/help/articles/how-can-i-make-wire-transfers-to-arq))
- **[V]** ARQ cobra **USD 3** por cada ACH, enviado o recibido. Tarda de 3 a 6 días hábiles.
  ([ARQ: enviar dólares por ACH](https://www.arqfinance.com/help/articles/send-dollars-usd-via-ach-bank-transfer) ·
  [ARQ: recibir ACH](https://www.arqfinance.com/help/articles/how-to-receive-an-ach-transfer))
- **[V]** ARQ anunció que cambian el número de cuenta, la ruta y la dirección del banco de las
  cuentas de EE. UU. Los datos viejos dejan de funcionar y los pagos a ellos se devuelven.
  ([ARQ: tus datos de cuenta en EE. UU. cambian](https://www.arqfinance.com/help/articles/your-us-account-details-are-changing))
  Esto es justo un ACH devuelto de §1, y el aviso de cambio de destino ya existente debe cubrirlo.
- **[V]** Sus cuentas de empresa permiten pagos masivos desde su panel.
  ([ARQ: pagos masivos](https://www.arqfinance.com/help/articles/how-can-i-make-bulk-payments))
- **[I]** No encontré API pública de pagos masivos, ni filtro de sanciones o W-8BEN ofrecidos al
  pagador. Como remitente, ARQ no cubre §1.
- **Para la pantalla de cobro [I]:** quien use ARQ recibe USD 3 menos por cobro y espera de 3 a
  6 días. Conviene decirlo junto a `payout_cost_ach`.

### 5.2 Propuesta: Trolley

**Por qué Trolley.** Está hecho para pagos masivos a creadores y titulares de regalías. Acepta
`royalties` como tipo de ingreso en cada pago [V]. Trae el filtro AML y los formularios fiscales en
el mismo producto, y publica sus precios.

| Requisito de §1 | Cómo lo cubre Trolley | Estado |
|---|---|---|
| **Coincidencia de nombre** | La cuenta exige `accountHolderName`, el nombre exacto del titular en su banco. Con *Trust* se verifica la identidad con documento (11 000+ plantillas) y foto en vivo. La comparación entre `accountHolderName` y el nombre verificado la puede hacer tbt.cafe al dar de alta. | [V] el campo y la verificación de identidad. **[P]** que Trolley compruebe el nombre contra el banco. |
| **Cuenta verificada** | Al alta valida el formato (la ruta de EE. UU. va en `branchId`, 9 dígitos). | **[P]** la titularidad: no está documentada. Si no la cubre, Stripe Financial Connections la da por separado (§5.3), con la duda de si enlaza cuentas de Lead Bank. |
| **Filtro de sanciones** | `complianceStatus`: estado de "AML watchlist compliance screening" por destinatario, con `pending`, `review`, `verified` y `blocked`. | [V]. **[P]** si se repite en cada pago y si `blocked` impide pagar. |
| **W-8BEN o W-9** | Trolley Tax: recogida digital de W-8/W-9, retención automática por jurisdicción y tratado, presentación 1099/1042 y reverificación al vencer. | [V]. **[P]** que nombre W-8BEN expresamente, si presenta 1042-S y si bloquea el pago sin formulario válido. |
| **ACH devuelto** | — | **[P]** el evento o *webhook* de devolución. |
| **Residente fuera de EE. UU. con cuenta de EE. UU.** | Los ejemplos de la API usan el mismo país para dirección y banco. | **[P]** es lo primero que hay que confirmar. |

Fuentes: [API de Trolley](https://developers.trolley.com/api/) · [Trolley Tax](https://trolley.com/tax/) ·
[Trolley Trust](https://trolley.com/trust/) · [Precios](https://trolley.com/pricing/)

**Costo [V] según la página de precios.** Pay, Tax y Trust son módulos anuales que se suman. El
"USD 0/año" de la calculadora es el total sin módulos, no un plan gratis.

| Concepto | Precio |
|---|---|
| Pay (envío de pagos) | USD 2 399 / año |
| Tax (W-8/W-9, retención, reportes al IRS), una jurisdicción | USD 2 399 / año |
| Trust (identidad) | USD 1 199 / año; 10 verificaciones gratis al mes, luego USD 2,50 cada una |
| ACH doméstico en USD | USD 1,00 por pago |
| Constancia al IRS | USD 2,00 por formulario |
| **Fijo** | **USD 5 997 / año (≈ USD 500 / mes)** |

**Ejemplo [I]** (volumen supuesto, no medido): 100 personas cobrando 4 veces al año.
- 400 ACH: USD 400.
- 100 constancias al IRS: USD 200.
- 100 verificaciones de identidad: caben en las 120 gratis del año.
- **Total ≈ USD 6 600 al año.**

Si Trolley no hace falta para la identidad (§5.3), se quita Trust: **≈ USD 4 800 fijos**.

**Flujo del dinero [I].** Las ventas de la vía de plataforma quedan en el saldo de Stripe de
tbt.cafe. De ahí salen a la cuenta bancaria de tbt.cafe, que fondea Trolley, y Trolley envía el
ACH. Esto pone a tbt.cafe en el flujo del pago (ver §6.1).

### 5.3 La identidad verificada que §1 da por hecha

- **[V] en el código:** fuera de Connect no hay verificación de identidad. `profiles.legal_name`
  lo escribe la persona (`src/app/profile/creator/page.tsx`). Connect sí hace KYC, pero la vía ACH
  no pasa por Connect.
- Hay dos opciones:
  - **Trolley Trust:** USD 2,50 por verificación tras las 10 gratis al mes [V]. Queda todo en un
    proveedor.
  - **Stripe Identity:** USD 1,50 por verificación con documento y selfie; documentos de más de 100
    países [V] ([Stripe Identity](https://stripe.com/identity)). Mantiene la identidad en Stripe,
    como prefiere Federico, y permite quitar Trust (−USD 1 199/año).
- **Titularidad de la cuenta [V]:** Stripe Financial Connections devuelve los titulares que da el
  banco. La comparación automática (*Ownership Match*) está en vista previa.
  ([Ownership](https://docs.stripe.com/financial-connections/ownership))
  - **[P]** si cubre cuentas de Lead Bank emitidas por ARQ. Si no, la titularidad queda en manos
    de Trolley o de una verificación manual.

### 5.4 Alternativas

- **Tipalti Mass Payments [V]:** desde USD 249/mes. Anuncia filtro OFAC/AML y recogida de W-9/W-8,
  aunque la página de precios lista los formularios en el producto de cuentas por pagar. El precio
  por pago solo va por presupuesto. Es la reserva si Trolley no confirma §5.2.
  ([Tipalti pricing](https://tipalti.com/pricing/))
- **Enviar el ACH desde un banco nuestro** y montar aparte KYC, sanciones y formularios: cargamos
  los cuatro requisitos y la licencia. Descartado [I].
- **No evaluados a fondo:** Dwolla (centrado en EE. UU.), Payoneer y Wise. Si Trolley y Tipalti
  fallan, son los siguientes a mirar.

---

## 6. Lo que no decide la tecnología (para el abogado)

1. **Licencia de transmisor de dinero [I].** Con Connect, Stripe dice que el flujo queda cubierto
   por su licencia. Con Trolley o con Global Payouts, el dinero del vendedor sale de nuestra
   cuenta, y que el proveedor tenga licencia no responde por sí solo si tbt.cafe necesita algo.
2. **Retención sobre regalías a no residentes [I].** El W-8BEN sirve para decidir si hay retención
   y a qué tasa por tratado. Si las regalías se consideran de fuente estadounidense, aparece el
   1042-S. El criterio es del abogado; Trolley lo ejecuta.
3. **Países excluidos por sanciones [I]:** la lista, sea cual sea el proveedor, debe reflejarse en
   `provider_countries`.

---

## 7. Qué preguntar antes de firmar

**A Trolley, por escrito:**
1. ¿Paga por ACH a una cuenta de EE. UU. a nombre de alguien que vive en Colombia o Argentina?
2. ¿Compara `accountHolderName` con el banco? ¿Verifica la titularidad, y cómo?
3. ¿El filtro AML se repite en cada pago? ¿`blocked` impide pagar?
4. ¿Sin W-8BEN o W-9 válido se bloquea el pago? ¿Presenta 1042-S?
5. ¿Qué evento avisa de un ACH devuelto, y con qué código?
6. ¿Qué módulos hacen falta para 1–4, y qué precio dan por volumen?

**A Stripe (ventas):** ¿existe alguna vía, aunque no sea autoservicio, para enviar ACH a una
cuenta de EE. UU. de una persona que reside en CO o AR, con KYC, sanciones y W-8BEN de su lado?

---

## 8. Qué se reaprovecha del código (para cuando se construya)

- **Se queda tal cual:** `payouts/connect`, `refreshConnectAccount`/`disburseBlock` en la vía
  Connect, `payout_connect_accounts` y el handler de `account.updated`.
- **Se adapta:**
  - `create_payout_block` ya distingue el costo por proveedor; se añade el ACH con `payout_cost_ach`.
  - `payouts/collect` mantiene el segundo factor, la pausa y el ticket de institución.
  - En `payout-rails.ts`, `usdcEnabled` y `stripe_connect_stablecoin` se sustituyen por
    `us_ach_enabled`.
  - El aviso de cambio de destino (`check:payoutnotice`) sigue igual.
- **Nuevo:**
  - Tabla del destinatario en el proveedor (estado AML, formulario fiscal, cuenta).
  - Un estado **devuelto** en el bloque. Hoy `paid` significa "llegó al saldo de Stripe". Un ACH
    puede volver días después, así que `paid` solo puede afirmarse con el evento del proveedor, y
    una devolución reabre las ganancias sin pagarlas dos veces.
- **Archivos con USDC** en `src/`, según `git grep`: `selling`, `admin/config`, `payouts/collect`,
  `payout-rails`, `seller`, `payout-data`, `rules-shape`, `offers-server`. La lista completa de 22
  archivos de §3 de la enmienda incluye también textos legales, Roast, asistente e i18n.
