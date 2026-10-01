/**
 * Base de conocimiento del asistente — Backend Spec 04 §2.
 *
 * Recuperación, NO ajuste fino. Las reglas cambian —tarifas, umbrales, tipos de
 * regalía, métodos de cobro— y un modelo afinado se queda con lo que era cierto
 * el día del entrenamiento y se equivoca en silencio.
 *
 * Por qué el anclaje no es opcional aquí: las reglas de tbt.cafe son raras. Una
 * tarifa de servicio de $8 cobrada a AMBOS lados, regalías fijas con un piso de
 * `regalía + max(5%, $25)`, la regalía que se congela en la primera venta, una
 * ventana de liquidación de 7 o 14 días, títulos que llegan por correo con un SMS
 * que confirma el envío, y las primeras diez registraciones de cada creador cubiertas por la casa
 * —de modo que "registrar cuesta $8" es cierto en general y falso para las diez
 * primeras—. Un modelo sin anclaje inventará una estructura de tarifas
 * plausible, porque las estructuras plausibles son lo que ha visto.
 *
 * Las CIFRAS no se escriben a mano en cada idioma: se interpolan desde las
 * constantes de precio. El handoff cuenta que dos veces en este proyecto una
 * regla de dinero cambió en el código mientras la documentación y el asistente
 * se quedaban atrás, produciendo material seguro de sí mismo y equivocado.
 * Derivarlas hace que esa deriva no pueda ocurrir.
 */
import { FEE as CARD } from '@/lib/fees'
import type { Rules } from '@/lib/rules-shape'

export type Locale = 'en' | 'es' | 'pt' | 'fr'

export type KnowledgeDoc = {
  id: string
  /** Términos de búsqueda por idioma; el idioma de la pregunta manda. */
  terms: Record<Locale, string[]>
  body: Record<Locale, string>
}

/** Lo que la base de conocimiento lee de la configuracion (Work Order 02, 1.4). */
export type KnowledgeRules = Pick<Rules, 'fees' | 'royalty' | 'covered' | 'transferWindowHours' | 'offers'>

/**
 * Los documentos, con las cifras de la fila vigente. Una funcion y no una
 * constante: si el panel cambia una tarifa, el asistente la cuenta en la
 * siguiente pregunta, sin desplegar.
 */
export function knowledgeFor(rules: KnowledgeRules): KnowledgeDoc[] {
const FEE = rules.fees.registration
const COVERED = rules.covered.count
/** El piso de una regalia fija y el procesamiento, derivados igual que la tarifa. */
const FLOOR_PCT = rules.royalty.floorPct
const FLOOR_MIN = rules.royalty.floorMin
const STRIPE_PCT = CARD.stripePct * 100
const HOURS = rules.transferWindowHours
const OFFER_MAX = rules.offers.maxHours
const PAY_HOURS = rules.offers.paymentWindowHours

return [
  {
    /*
     * COMO se registra, que no es lo mismo que CUANTO cuesta.
     *
     * Faltaba, y el hueco se veia desde la primera pantalla: «How do I brew a
     * TBT?» es una de las tres preguntas que la propia aplicacion sugiere, y lo
     * unico que recuperaba era el documento de la tarifa — que habla de dinero.
     * El asistente contestaba, correctamente, que no sabia el proceso.
     */
    id: 'how_to_register',
    terms: {
      en: ['how do i brew', 'brew a tbt', 'how to register', 'steps', 'seal', 'process', 'certify', 'start'],
      es: ['cómo registro', 'cómo registrar', 'pasos', 'sellar', 'sello', 'proceso', 'certificar', 'empezar'],
      pt: ['como registro', 'como registrar', 'passos', 'selar', 'selo', 'processo', 'certificar', 'começar'],
      fr: ['comment enregistrer', 'étapes', 'sceller', 'sceau', 'processus', 'certifier', 'commencer'],
    },
    body: {
      en: `Registering happens in Brew. You need a creator profile first. There are two ways through: Cold Brew asks step by step, and Espresso is a short interview, spoken or written, that collects the same things. You give the work — image, title, category, technique, when it was made — and the image is scanned for originality before anything is sealed. Then the value and the royalty terms, then the Context: where and when, with a summary you can edit. The Seal is a press and hold, and it freezes the price, the royalty, the context and the scan into that moment; it also opens a payment window of ten minutes. After payment — or straight through, if the registration is covered — the work is certified: the token is minted on Solana, the record is published to Arweave and anchored to Bitcoin, and your title arrives by email, with a text confirming it was sent.`,
      es: `El registro ocurre en Brew. Antes hace falta un perfil de creador. Hay dos caminos: Cold Brew pregunta paso a paso, y Espresso es una entrevista corta, hablada o escrita, que recoge lo mismo. Se entrega la obra — imagen, título, categoría, técnica, cuándo se hizo — y la imagen se escanea por originalidad antes de sellar nada. Luego el valor y los términos de regalía, y después el Contexto: dónde y cuándo, con un resumen que puedes editar. El Sello se mantiene pulsado, y congela en ese instante el precio, la regalía, el contexto y el escaneo; también abre una ventana de pago de diez minutos. Tras el pago — o directo, si la registración está cubierta — la obra queda certificada: se acuña el token en Solana, el registro se publica en Arweave y se ancla a Bitcoin, y tu título de propiedad llega por correo, con un SMS que confirma el envío.`,
      pt: `O registro acontece no Brew. Antes é preciso um perfil de criador. Há dois caminhos: Cold Brew pergunta passo a passo, e Espresso é uma entrevista curta, falada ou escrita, que recolhe as mesmas coisas. Você entrega a obra — imagem, título, categoria, técnica, quando foi feita — e a imagem é examinada quanto à originalidade antes de selar qualquer coisa. Depois o valor e os termos de royalty, e então o Contexto: onde e quando, com um resumo que você pode editar. O Selo é pressionar e segurar, e congela naquele instante o preço, o royalty, o contexto e a verificação; também abre uma janela de pagamento de dez minutos. Após o pagamento — ou direto, se o registro estiver coberto — a obra fica certificada: o token é cunhado na Solana, o registro é publicado na Arweave e ancorado ao Bitcoin, e o seu título de propriedade chega por e-mail, com um SMS confirmando o envio.`,
      fr: `L'enregistrement se fait dans Brew. Il faut d'abord un profil de créateur. Deux chemins : Cold Brew pose les questions une à une, et Espresso est un entretien court, parlé ou écrit, qui recueille les mêmes éléments. Vous remettez l'œuvre — image, titre, catégorie, technique, date — et l'image est analysée pour l'originalité avant que quoi que ce soit ne soit scellé. Ensuite la valeur et les conditions de redevance, puis le Contexte : où et quand, avec un résumé que vous pouvez modifier. Le Sceau se fait en maintenant appuyé, et il fige à cet instant le prix, la redevance, le contexte et l'analyse ; il ouvre aussi une fenêtre de paiement de dix minutes. Après le paiement — ou directement, si l'enregistrement est offert — l'œuvre est certifiée : le jeton est frappé sur Solana, le registre est publié sur Arweave et ancré à Bitcoin, et votre titre de propriété arrive par e-mail, un SMS confirmant l'envoi.`,
    },
  },
  {
    /*
     * Como se cobra. Tampoco estaba, y «How do I collect payouts?» es la
     * tercera pregunta sugerida: no recuperaba NADA en los cuatro idiomas.
     *
     * Los dias y el umbral viven en `platform_config` y una administradora los
     * cambia sin desplegar, asi que aqui va la REGLA y no la cifra. La fecha
     * exacta la ensena la pantalla de cobros, que la lee de la fila.
     */
    id: 'payouts',
    terms: {
      en: ['payout', 'payouts', 'collect', 'get paid', 'withdraw', 'settlement', 'available', 'pending'],
      es: ['cobro', 'cobros', 'cobrar', 'retirar', 'liquidación', 'disponible', 'pendiente', 'cómo cobro'],
      pt: ['saque', 'saques', 'receber', 'retirar', 'liquidação', 'disponível', 'pendente', 'como recebo'],
      fr: ['versement', 'versements', 'encaisser', 'retirer', 'règlement', 'disponible', 'en attente'],
    },
    body: {
      en: `What you earn appears under Payouts. A royalty from a purchase arrives as pending and waits out a settlement window, which is longer for large sales; the exact date is shown next to the amount. A royalty from a transfer or an accepted offer does not wait at all — the counterparty accepting is the condition, so it lands available immediately. The service fee of $${FEE} is taken out of the royalty before it is recorded. Paying out charges the platform rate plus whatever the method itself costs, which depends on your country and the method you chose; the screen quotes both before you confirm. Payment runs through Stripe Connect, to a bank account or in USDC, and you choose the method each time you collect. Where payouts don't reach your country yet, your earnings are kept until they do. Galleries, museums and estates are paid by our team, on request. Nobody is ever paid a royalty on their own sale.`,
      es: `Lo que ganas aparece en Cobros. Una regalía de una compra entra como pendiente y espera una ventana de liquidación, más larga en ventas grandes; la fecha exacta se muestra junto al monto. Una regalía de una transferencia o de una oferta aceptada no espera nada — la aceptación de la contraparte ES la condición, así que entra disponible de inmediato. La tarifa de servicio de $${FEE} se descuenta de la regalía antes de anotarla. Cobrar cuesta la tasa de la plataforma más lo que cueste el método, que depende de tu país y de cuál elegiste; la pantalla cotiza las dos antes de que confirmes. El pago va por Stripe Connect, a una cuenta bancaria o en USDC, y eliges el método cada vez que cobras. Donde los cobros aún no llegan a tu país, tus ganancias se guardan hasta que lleguen. Galerías, museos y sucesiones cobran a través de nuestro equipo, a pedido. Nadie cobra regalía por su propia venta.`,
      pt: `O que você ganha aparece em Saques. Um royalty de uma compra entra como pendente e aguarda uma janela de liquidação, mais longa em vendas grandes; a data exata aparece ao lado do valor. Um royalty de uma transferência ou de uma oferta aceita não espera — a aceitação da contraparte É a condição, então entra disponível na hora. A taxa de serviço de $${FEE} é descontada do royalty antes de registrá-lo. Sacar custa a taxa da plataforma mais o que o método cobrar, o que depende do seu país e do método escolhido; a tela cota as duas antes de você confirmar. O pagamento vai pela Stripe Connect, para uma conta bancária ou em USDC, e você escolhe o método a cada saque. Onde os saques ainda não chegam ao seu país, seus ganhos ficam guardados até chegarem. Galerias, museus e espólios recebem por meio da nossa equipe, mediante pedido. Ninguém recebe royalty pela própria venda.`,
      fr: `Ce que vous gagnez apparaît dans Versements. Une redevance issue d'un achat arrive en attente et patiente le temps d'un règlement, plus long pour les ventes importantes ; la date exacte est affichée à côté du montant. Une redevance issue d'un transfert ou d'une offre acceptée n'attend pas — l'acceptation de la contrepartie EST la condition, elle est donc disponible immédiatement. Les frais de service de $${FEE} sont déduits de la redevance avant son enregistrement. Encaisser coûte le taux de la plateforme plus ce que coûte le moyen choisi, qui dépend de votre pays ; l'écran chiffre les deux avant confirmation. Le paiement passe par Stripe Connect, vers un compte bancaire ou en USDC, et vous choisissez le moyen à chaque encaissement. Là où les versements n'arrivent pas encore dans votre pays, vos gains sont conservés jusqu'à ce qu'ils y arrivent. Les galeries, musées et successions sont payés par notre équipe, sur demande. Personne ne touche de redevance sur sa propre vente.`,
    },
  },
  {
    id: 'registration_fee',
    terms: {
      en: ['register', 'registration', 'cost', 'price to register', 'brew', 'fee', 'free'],
      es: ['registrar', 'registro', 'costo', 'cuánto cuesta', 'precio', 'tarifa', 'gratis'],
      pt: ['registrar', 'registro', 'custo', 'quanto custa', 'preço', 'taxa', 'grátis'],
      fr: ['enregistrer', 'enregistrement', 'coût', 'combien', 'prix', 'frais', 'gratuit'],
    },
    body: {
      en: `Registering a work costs $${FEE} plus card processing. But a creator's first ${COVERED} registrations are paid for by tbt.cafe: the $${FEE} is shown, struck through, and marked "Covered by tbt.cafe" — it is never presented as $0. Only a completed registration uses up one of the ${COVERED}; an abandoned attempt does not. After the allowance is used, registration is charged normally.`,
      es: `Registrar una obra cuesta $${FEE} más el procesamiento de la tarjeta. Pero las primeras ${COVERED} registraciones de cada creador las paga tbt.cafe: los $${FEE} se muestran tachados y marcados "Cubierto por tbt.cafe" — nunca se presentan como $0. Solo una registración completada gasta una de las ${COVERED}; un intento abandonado no. Agotado el cupo, el registro se cobra normal.`,
      pt: `Registrar uma obra custa $${FEE} mais o processamento do cartão. Mas os primeiros ${COVERED} registros de cada criador são pagos pelo tbt.cafe: os $${FEE} aparecem riscados e marcados "Coberto pelo tbt.cafe" — nunca como $0. Só um registro concluído consome um dos ${COVERED}; uma tentativa abandonada não. Esgotada a cota, o registro é cobrado normalmente.`,
      fr: `Enregistrer une œuvre coûte $${FEE} plus les frais de carte. Mais les ${COVERED} premiers enregistrements de chaque créateur sont payés par tbt.cafe : les $${FEE} sont affichés barrés et marqués « Offert par tbt.cafe » — jamais présentés comme $0. Seul un enregistrement terminé consomme l'un des ${COVERED} ; une tentative abandonnée non. Une fois le quota épuisé, l'enregistrement est facturé normalement.`,
    },
  },
  {
    id: 'sale_fees',
    terms: {
      en: ['sale', 'sell', 'buyer pays', 'service fee', 'how much do i get', 'payout on a sale', 'processing'],
      es: ['venta', 'vender', 'comprador paga', 'tarifa de servicio', 'cuánto recibo', 'procesamiento'],
      pt: ['venda', 'vender', 'comprador paga', 'taxa de serviço', 'quanto recebo', 'processamento'],
      fr: ['vente', 'vendre', 'acheteur paie', 'frais de service', 'combien je reçois', 'traitement'],
    },
    body: {
      en: `Selling a work needs approval: apply from Selling in the menu. Registering, transferring, gifting and receiving royalties need none. On a sale the buyer pays the price plus $${FEE}. The seller has $${FEE} deducted as well — the service fee is charged on both sides, $${FEE * 2} per sale to the platform. Card processing is (royalty + $${FEE}) x ${STRIPE_PCT}% + $0.30 and is borne by the seller only; it is never added to the buyer. The seller receives price − royalty − $${FEE} − processing.`,
      es: `Vender una obra necesita aprobación: se solicita desde Vender en el menú. Registrar, transferir, regalar y recibir regalías no la necesitan. En una venta el comprador paga el precio más $${FEE}. Al vendedor también se le descuentan $${FEE} — la tarifa de servicio se cobra en ambos lados, $${FEE * 2} por venta para la plataforma. El procesamiento de tarjeta es (regalía + $${FEE}) x ${STRIPE_PCT}% + $0,30 y lo absorbe solo el vendedor; nunca se le suma al comprador. El vendedor recibe precio − regalía − $${FEE} − procesamiento.`,
      pt: `Vender uma obra exige aprovação: peça em Vender, no menu. Registrar, transferir, presentear e receber royalties não exigem. Em uma venda o comprador paga o preço mais $${FEE}. Do vendedor também são descontados $${FEE} — a taxa de serviço é cobrada dos dois lados, $${FEE * 2} por venda para a plataforma. O processamento do cartão é (royalty + $${FEE}) x ${STRIPE_PCT}% + $0,30 e é absorvido só pelo vendedor; nunca é somado ao comprador. O vendedor recebe preço − royalty − $${FEE} − processamento.`,
      fr: `Vendre une œuvre nécessite une approbation : la demande se fait depuis Vendre dans le menu. Enregistrer, transférer, offrir et recevoir des redevances n'en demandent pas. Lors d'une vente, l'acheteur paie le prix plus $${FEE}. Le vendeur se voit aussi déduire $${FEE} — les frais de service sont prélevés des deux côtés, $${FEE * 2} par vente pour la plateforme. Les frais de carte sont (redevance + $${FEE}) x ${STRIPE_PCT} % + $0,30 et sont supportés uniquement par le vendeur ; ils ne sont jamais ajoutés à l'acheteur. Le vendeur reçoit prix − redevance − $${FEE} − frais.`,
    },
  },
  {
    id: 'royalties',
    terms: {
      en: ['royalty', 'royalties', 'percentage', 'fixed royalty', 'resale', 'minimum price', 'floor'],
      es: ['regalía', 'regalías', 'porcentaje', 'regalía fija', 'reventa', 'precio mínimo', 'piso'],
      pt: ['royalty', 'royalties', 'direitos autorais', 'direitos', 'porcentagem', 'royalty fixo', 'revenda', 'preço mínimo', 'piso'],
      fr: ['redevance', 'redevances', 'pourcentage', 'redevance fixe', 'revente', 'prix minimum', 'plancher'],
    },
    body: {
      en: `A royalty is either a percentage of the value or a fixed amount. A fixed royalty is absolute: it is owed in full whatever the value, including a zero-value gift transfer. Because that could otherwise leave a seller paying to sell, a fixed royalty gives the work a minimum price of royalty + max(${FLOOR_PCT}%, $${FLOOR_MIN}), and that floor is enforced — a price or an offer below it is rejected. There is no shortfall payment and no prepaid royalty. The royalty locks permanently at the first sale, both its amount and its type. A fixed royalty never displays a percentage, because none applies.`,
      es: `Una regalía es un porcentaje del valor o un monto fijo. Una regalía fija es absoluta: se debe completa sea cual sea el valor, incluso en una donación de valor cero. Como eso podría dejar al vendedor pagando por vender, una regalía fija le da a la obra un precio mínimo de regalía + max(${FLOOR_PCT}%, $${FLOOR_MIN}), y ese piso se hace cumplir — un precio o una oferta por debajo se rechazan. No hay pago de faltante ni regalía prepagada. La regalía se congela para siempre en la primera venta, tanto el monto como el tipo. Una regalía fija nunca muestra un porcentaje, porque no aplica ninguno.`,
      pt: `Um royalty é uma porcentagem do valor ou um valor fixo. Um royalty fixo é absoluto: é devido integralmente qualquer que seja o valor, inclusive numa transferência de valor zero. Como isso poderia deixar o vendedor pagando para vender, um royalty fixo dá à obra um preço mínimo de royalty + max(${FLOOR_PCT}%, $${FLOOR_MIN}), e esse piso é obrigatório — preço ou oferta abaixo dele são recusados. Não há pagamento de diferença nem royalty pré-pago. O royalty é travado permanentemente na primeira venda, valor e tipo. Um royalty fixo nunca exibe porcentagem, porque nenhuma se aplica.`,
      fr: `Une redevance est soit un pourcentage de la valeur, soit un montant fixe. Une redevance fixe est absolue : elle est due en totalité quelle que soit la valeur, y compris pour un don de valeur nulle. Comme cela pourrait amener un vendeur à payer pour vendre, une redevance fixe donne à l'œuvre un prix minimum de redevance + max(${FLOOR_PCT} %, $${FLOOR_MIN}), et ce plancher est appliqué — un prix ou une offre en dessous est refusé. Il n'existe ni paiement de complément ni redevance prépayée. La redevance est verrouillée définitivement à la première vente, son montant comme son type. Une redevance fixe n'affiche jamais de pourcentage, car aucun ne s'applique.`,
    },
  },
  {
    id: 'title_delivery',
    terms: {
      en: ['title', 'email', 'delivery', 'did not arrive', 'where is my title', 'recover'],
      es: ['título de propiedad', 'correo', 'entrega', 'no llegó', 'dónde está mi título', 'recuperar'],
      pt: ['título de propriedade', 'e-mail', 'entrega', 'não chegou', 'onde está meu título', 'recuperar'],
      fr: ['titre de propriété', 'e-mail', 'livraison', "n'est pas arrivé", 'où est mon titre', 'récupérer'],
    },
    body: {
      en: `Your title arrives by email, and a text confirms it was sent. Nothing on it is secret — show it, print it, forward it. A new title is issued every time the work changes hands, so the newest one is always the current one. Lost it? It is simply reissued: your ownership lives on-chain, not in the message. Notifications otherwise never use SMS — they go to email and the in-app feed.`,
      es: `Tu título de propiedad llega por correo electrónico, y un SMS confirma que se envió. No contiene nada secreto: puedes mostrarlo, imprimirlo o reenviarlo. Cada vez que la obra cambia de manos se emite un título nuevo, así que el más reciente es siempre el vigente. ¿Lo perdiste? Simplemente se vuelve a emitir: tu propiedad vive en la cadena, no en el mensaje. Por lo demás, las notificaciones nunca usan SMS: van al correo y al feed dentro de la app.`,
      pt: `Seu título de propriedade chega por e-mail, e um SMS confirma o envio. Nada nele é secreto: mostre, imprima, encaminhe. Um novo título é emitido sempre que a obra muda de mãos, então o mais recente é sempre o vigente. Perdeu? Ele é simplesmente reemitido: sua propriedade está na cadeia, não na mensagem. Fora isso, as notificações nunca usam SMS: vão para o e-mail e o feed no app.`,
      fr: `Votre titre de propriété arrive par e-mail, et un SMS confirme son envoi. Il ne contient rien de secret : montrez-le, imprimez-le, transférez-le. Un nouveau titre est émis chaque fois que l'œuvre change de mains, donc le plus récent est toujours celui en vigueur. Perdu ? Il est simplement réémis : votre propriété vit sur la chaîne, pas dans le message. Sinon, les notifications n'utilisent jamais le SMS : elles vont à l'e-mail et au fil dans l'application.`,
    },
  },
  {
    id: 'transfers',
    terms: {
      en: ['transfer', 'send a tbt', 'gift', 'recipient', 'transfer cost'],
      es: ['transferencia', 'transferir', 'enviar un tbt', 'regalo', 'destinatario', 'costo de transferencia'],
      pt: ['transferência', 'transferir', 'enviar um tbt', 'presente', 'destinatário', 'custo da transferência'],
      fr: ['transfert', 'transférer', 'envoyer un tbt', 'cadeau', 'destinataire', 'coût du transfert'],
    },
    body: {
      en: `On a transfer the sender pays; there is no buyer. The cost is the royalty plus $${FEE} plus processing of (royalty + $${FEE}) x ${STRIPE_PCT}% + $0.30. A transfer value may be zero — with a percentage royalty the royalty is then zero, but a fixed royalty is still owed in full. Transfers carry no minimum price floor, because the sender is the paying party and sees the full cost before committing. A transfer must be accepted within ${HOURS} hours, and the recipient sees and confirms the declared value before accepting. A sale made elsewhere — in person, at auction, through a gallery — completes here as a transfer: the sender declares the price, it is recorded publicly in the work's history, and any royalty is calculated on it. tbt.cafe is not a party to that sale.`,
      es: `En una transferencia paga el emisor; no hay comprador. El costo es la regalía más $${FEE} más el procesamiento de (regalía + $${FEE}) x ${STRIPE_PCT}% + $0,30. El valor de una transferencia puede ser cero: con regalía porcentual la regalía es entonces cero, pero una regalía fija se debe completa igual. Las transferencias no llevan piso de precio, porque quien paga es el emisor y ve el costo completo antes de confirmar. Una transferencia debe aceptarse dentro de ${HOURS} horas, y el destinatario ve y confirma el valor declarado antes de aceptar. Una venta hecha fuera — en persona, en una subasta, a través de una galería — se completa aquí como transferencia: el emisor declara el precio, queda registrado públicamente en el historial de la obra y la regalía, si la hay, se calcula sobre él. tbt.cafe no es parte de esa venta.`,
      pt: `Numa transferência quem paga é o remetente; não há comprador. O custo é o royalty mais $${FEE} mais o processamento de (royalty + $${FEE}) x ${STRIPE_PCT}% + $0,30. O valor de uma transferência pode ser zero: com royalty percentual o royalty é então zero, mas um royalty fixo continua devido integralmente. Transferências não têm piso de preço, porque quem paga é o remetente e vê o custo completo antes de confirmar. Uma transferência precisa ser aceita em até ${HOURS} horas, e o destinatário vê e confirma o valor declarado antes de aceitar. Uma venda feita fora — pessoalmente, em leilão, por uma galeria — se conclui aqui como transferência: o remetente declara o preço, ele fica registrado publicamente no histórico da obra e o royalty, se houver, é calculado sobre ele. A tbt.cafe não é parte dessa venda.`,
      fr: `Lors d'un transfert, c'est l'expéditeur qui paie ; il n'y a pas d'acheteur. Le coût est la redevance plus $${FEE} plus les frais de (redevance + $${FEE}) x ${STRIPE_PCT} % + $0,30. La valeur d'un transfert peut être nulle : avec une redevance en pourcentage elle est alors nulle, mais une redevance fixe reste due en totalité. Les transferts n'ont pas de prix plancher, car l'expéditeur est la partie payante et voit le coût complet avant de confirmer. Un transfert doit être accepté dans les ${HOURS} heures, et le destinataire voit et confirme la valeur déclarée avant d'accepter. Une vente conclue ailleurs — en personne, aux enchères, par une galerie — se finalise ici comme un transfert : l'expéditeur déclare le prix, il est enregistré publiquement dans l'historique de l'œuvre et la redevance éventuelle est calculée dessus. tbt.cafe n'est pas partie à cette vente.`,
    },
  },
  {
    id: 'offers',
    terms: {
      en: ['offer', 'offers', 'make an offer', 'accept an offer', 'counteroffer', 'bid'],
      es: ['oferta', 'ofertas', 'hacer una oferta', 'aceptar una oferta', 'contraoferta', 'puja'],
      pt: ['oferta', 'ofertas', 'fazer uma oferta', 'aceitar uma oferta', 'contraproposta', 'lance'],
      fr: ['offre', 'offres', 'faire une offre', 'accepter une offre', 'contre-offre', 'enchère'],
    },
    body: {
      en: `An offer is a proposed price; no money moves when it is made. It stands for up to ${OFFER_MAX} hours, with an optional message. When the owner accepts, the work is frozen for that offer — its price and availability can't change and other open offers wait — and the buyer has ${PAY_HOURS} hours to pay; if they don't, the offer lapses and the work is free again. Messages with offers are private between the two parties, may be reviewed by tbt.cafe, and can be reported. If the owner isn't approved to sell yet, they can't accept until they are; an offer that expires first lapses, and the buyer is told when the owner is approved. Offers live in History → Offers.`,
      es: `Una oferta es un precio propuesto; al hacerla no se mueve dinero. Vale hasta ${OFFER_MAX} horas, con un mensaje opcional. Cuando el dueño la acepta, la obra queda congelada para esa oferta —su precio y su disponibilidad no cambian y las demás ofertas abiertas esperan— y el comprador tiene ${PAY_HOURS} horas para pagar; si no paga, la oferta vence y la obra queda libre. Los mensajes de las ofertas son privados entre las dos partes, tbt.cafe puede revisarlos y se pueden reportar. Si el dueño aún no está aprobado para vender, no puede aceptar hasta estarlo; una oferta que vence antes caduca, y al comprador se le avisa cuando el dueño queda aprobado. Las ofertas están en Historial → Ofertas.`,
      pt: `Uma oferta é um preço proposto; ao fazê-la nenhum dinheiro se move. Vale por até ${OFFER_MAX} horas, com uma mensagem opcional. Quando o dono aceita, a obra fica congelada para essa oferta — preço e disponibilidade não mudam e as outras ofertas abertas esperam — e o comprador tem ${PAY_HOURS} horas para pagar; se não pagar, a oferta caduca e a obra fica livre. As mensagens das ofertas são privadas entre as duas partes, a tbt.cafe pode revisá-las e elas podem ser denunciadas. Se o dono ainda não está aprovado para vender, não pode aceitar até estar; uma oferta que vence antes caduca, e o comprador é avisado quando o dono for aprovado. As ofertas ficam em Histórico → Ofertas.`,
      fr: `Une offre est un prix proposé ; aucun argent ne bouge quand elle est faite. Elle vaut jusqu'à ${OFFER_MAX} heures, avec un message facultatif. Quand le propriétaire l'accepte, l'œuvre est gelée pour cette offre — son prix et sa disponibilité ne changent plus et les autres offres ouvertes attendent — et l'acheteur a ${PAY_HOURS} heures pour payer ; sinon l'offre expire et l'œuvre redevient libre. Les messages des offres sont privés entre les deux parties, tbt.cafe peut les consulter et ils peuvent être signalés. Si le propriétaire n'est pas encore approuvé pour vendre, il ne peut pas accepter avant de l'être ; une offre qui expire avant devient caduque, et l'acheteur est prévenu quand le propriétaire est approuvé. Les offres se trouvent dans Historique → Offres.`,
    },
  },
  {
    id: 'payment_window',
    terms: {
      en: ['payment window', 'expired', 'seal', 'countdown', 'ran out of time'],
      es: ['ventana de pago', 'venció', 'vencida', 'sellar', 'contador', 'se acabó el tiempo'],
      pt: ['janela de pagamento', 'venceu', 'selar', 'contador', 'acabou o tempo'],
      fr: ['fenêtre de paiement', 'expiré', 'sceller', 'compte à rebours', 'plus de temps'],
    },
    body: {
      en: `Sealing a work freezes its price, royalties, context and originality scan at one moment, and all of that goes into the permanent record. Payment must happen inside the window that opens at sealing. If it lapses, nothing is lost: the draft stays and the creator seals again, which recaptures those anchors and opens a new window.`,
      es: `Sellar una obra congela su precio, sus regalías, su contexto y el escaneo de originalidad en un instante, y todo eso entra en el registro permanente. El pago tiene que ocurrir dentro de la ventana que se abre al sellar. Si vence, no se pierde nada: el borrador sigue ahí y el creador vuelve a sellar, lo que recaptura esos anclajes y abre una ventana nueva.`,
      pt: `Selar uma obra congela preço, royalties, contexto e a verificação de originalidade num instante, e tudo isso entra no registro permanente. O pagamento precisa acontecer dentro da janela que abre ao selar. Se vencer, nada se perde: o rascunho continua e o criador sela de novo, o que recaptura essas âncoras e abre uma janela nova.`,
      fr: `Sceller une œuvre fige son prix, ses redevances, son contexte et l'analyse d'originalité à un instant précis, et tout cela entre dans le registre permanent. Le paiement doit avoir lieu dans la fenêtre qui s'ouvre au scellage. Si elle expire, rien n'est perdu : le brouillon reste et le créateur scelle à nouveau, ce qui recapture ces ancrages et ouvre une nouvelle fenêtre.`,
    },
  },
  {
    id: 'what_is_a_tbt',
    terms: {
      en: ['what is a tbt', 'nft', 'token', 'title of authorship', 'bitcoin'],
      es: ['qué es un tbt', 'nft', 'token', 'título de autoría', 'bitcoin'],
      pt: ['o que é um tbt', 'nft', 'token', 'título de autoria', 'bitcoin'],
      fr: ["qu'est-ce qu'un tbt", 'nft', 'jeton', "titre d'auteur", 'bitcoin'],
    },
    body: {
      en: `A TBT is a Transferable Billable Token: a token that holds a work's title of authorship, its ownership, its transfer history and its commercial terms, including any royalty. The title is one of the things the token carries, not the definition of it. Records are anchored to Bitcoin, which timestamps them; nothing is issued on Bitcoin. Chain-written records cannot be altered — corrective records supersede, they never erase.`,
      es: `Un TBT es un Token Transferible Facturable: un token que contiene el título de autoría de una obra, su propiedad, su historial de transferencias y sus términos comerciales, incluida cualquier regalía. El título es una de las cosas que el token lleva, no su definición. Los registros se anclan a Bitcoin, que les pone fecha; en Bitcoin no se emite nada. Lo escrito en cadena no se puede alterar: los registros correctivos sustituyen, nunca borran.`,
      pt: `Um TBT é um Token Transferível Faturável: um token que contém o título de autoria de uma obra, sua propriedade, seu histórico de transferências e seus termos comerciais, incluindo qualquer royalty. O título é uma das coisas que o token carrega, não a definição dele. Os registros são ancorados ao Bitcoin, que os data; nada é emitido no Bitcoin. O que é escrito na cadeia não pode ser alterado: registros corretivos substituem, nunca apagam.`,
      fr: `Un TBT est un Token Transférable Facturable : un jeton qui contient le titre d'auteur d'une œuvre, sa propriété, son historique de transferts et ses conditions commerciales, y compris toute redevance. Le titre est l'une des choses que le jeton porte, non sa définition. Les registres sont ancrés à Bitcoin, qui les horodate ; rien n'est émis sur Bitcoin. Ce qui est écrit sur la chaîne ne peut être modifié : les registres correctifs remplacent, ils n'effacent jamais.`,
    },
  },
  {
    id: 'authentication',
    terms: {
      en: ['sign in', 'authentication', 'private code', 'biometric', 'account', 'lost my phone'],
      es: ['iniciar sesión', 'autenticación', 'código privado', 'biométrico', 'cuenta', 'perdí mi teléfono'],
      pt: ['entrar', 'autenticação', 'código privado', 'biometria', 'conta', 'perdi meu telefone'],
      fr: ['connexion', 'authentification', 'code privé', 'biométrie', 'compte', 'perdu mon téléphone'],
    },
    body: {
      en: `tbt.cafe has authentication, not accounts. Access is by mobile number with an SMS one-time code, optionally with biometrics per device. The private code is a separate knowledge factor that gates money movement; it is stored hashed, so it can never be recovered — if it is forgotten, open a help request. An e-Mail address is optional, and never required to own, sell or collect.`,
      es: `tbt.cafe tiene autenticación, no cuentas. El acceso es por número de móvil con un código de un solo uso por SMS, y opcionalmente con biometría por dispositivo. El código privado es un factor aparte que protege el movimiento de dinero; se guarda cifrado, así que nunca se puede recuperar — si se olvida, abre una solicitud de ayuda. El e-Mail es opcional, y nunca es obligatorio para poseer, vender o cobrar.`,
      pt: `O tbt.cafe tem autenticação, não contas. O acesso é por número de celular com um código de uso único por SMS, e opcionalmente com biometria por dispositivo. O código privado é um fator separado que protege a movimentação de dinheiro; é armazenado com hash, então nunca pode ser recuperado — se for esquecido, abra uma solicitação de ajuda. O e-mail é opcional, e nunca é obrigatório para possuir, vender ou receber.`,
      fr: `tbt.cafe dispose d'une authentification, pas de comptes. L'accès se fait par numéro de mobile avec un code à usage unique par SMS, et éventuellement par biométrie sur chaque appareil. Le code privé est un facteur distinct qui protège les mouvements d'argent ; il est stocké haché, donc jamais récupérable — en cas d'oubli, ouvrez une demande d'aide. L'e-mail est facultatif, et jamais requis pour posséder, vendre ou percevoir.`,
    },
  },
]
}

/**
 * Recuperación por idioma de la pregunta. Buscar en español contra contenido en
 * español da mejores respuestas que recuperar en inglés y traducir al generar.
 *
 * Devuelve vacío cuando nada casa, y eso importa: si no se recupera nada, el
 * asistente NO sabe y lo dice, en vez de inventar una estructura de tarifas
 * verosímil.
 */
export function retrieve(question: string, locale: Locale, rules: KnowledgeRules, limit = 3): KnowledgeDoc[] {
  const q = question.toLowerCase()
  const scored = knowledgeFor(rules).map((doc) => {
    let score = 0
    for (const term of doc.terms[locale]) {
      if (q.includes(term.toLowerCase())) score += term.length
    }
    return { doc, score }
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)

  return scored.slice(0, limit).map((s) => s.doc)
}
