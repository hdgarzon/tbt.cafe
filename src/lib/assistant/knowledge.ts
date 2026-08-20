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
 * ventana de liquidación de 7 o 14 días, certificados que solo se entregan por
 * MMS, y las primeras diez registraciones de cada creador cubiertas por la casa
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
import { FEE as PLATFORM } from '@/lib/fees'

export type Locale = 'en' | 'es' | 'pt' | 'fr'

export type KnowledgeDoc = {
  id: string
  /** Términos de búsqueda por idioma; el idioma de la pregunta manda. */
  terms: Record<Locale, string[]>
  body: Record<Locale, string>
}

const FEE = PLATFORM.service
const COVERED = 10

export const KNOWLEDGE: KnowledgeDoc[] = [
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
      en: `On a sale the buyer pays the price plus $${FEE}. The seller has $${FEE} deducted as well — the service fee is charged on both sides, $${FEE * 2} per sale to the platform. Card processing is (royalty + $${FEE}) x 2.9% + $0.30 and is borne by the seller only; it is never added to the buyer. The seller receives price − royalty − $${FEE} − processing.`,
      es: `En una venta el comprador paga el precio más $${FEE}. Al vendedor también se le descuentan $${FEE} — la tarifa de servicio se cobra en ambos lados, $${FEE * 2} por venta para la plataforma. El procesamiento de tarjeta es (regalía + $${FEE}) x 2,9% + $0,30 y lo absorbe solo el vendedor; nunca se le suma al comprador. El vendedor recibe precio − regalía − $${FEE} − procesamiento.`,
      pt: `Em uma venda o comprador paga o preço mais $${FEE}. Do vendedor também são descontados $${FEE} — a taxa de serviço é cobrada dos dois lados, $${FEE * 2} por venda para a plataforma. O processamento do cartão é (royalty + $${FEE}) x 2,9% + $0,30 e é absorvido só pelo vendedor; nunca é somado ao comprador. O vendedor recebe preço − royalty − $${FEE} − processamento.`,
      fr: `Lors d'une vente, l'acheteur paie le prix plus $${FEE}. Le vendeur se voit aussi déduire $${FEE} — les frais de service sont prélevés des deux côtés, $${FEE * 2} par vente pour la plateforme. Les frais de carte sont (redevance + $${FEE}) x 2,9 % + $0,30 et sont supportés uniquement par le vendeur ; ils ne sont jamais ajoutés à l'acheteur. Le vendeur reçoit prix − redevance − $${FEE} − frais.`,
    },
  },
  {
    id: 'royalties',
    terms: {
      en: ['royalty', 'royalties', 'percentage', 'fixed royalty', 'resale', 'minimum price', 'floor'],
      es: ['regalía', 'regalías', 'porcentaje', 'regalía fija', 'reventa', 'precio mínimo', 'piso'],
      pt: ['royalty', 'royalties', 'porcentagem', 'royalty fixo', 'revenda', 'preço mínimo', 'piso'],
      fr: ['redevance', 'redevances', 'pourcentage', 'redevance fixe', 'revente', 'prix minimum', 'plancher'],
    },
    body: {
      en: `A royalty is either a percentage of the value or a fixed amount. A fixed royalty is absolute: it is owed in full whatever the value, including a zero-value gift transfer. Because that could otherwise leave a seller paying to sell, a fixed royalty gives the work a minimum price of royalty + max(5%, $25), and that floor is enforced — a price or an offer below it is rejected. There is no shortfall payment and no prepaid royalty. The royalty locks permanently at the first sale, both its amount and its type. A fixed royalty never displays a percentage, because none applies.`,
      es: `Una regalía es un porcentaje del valor o un monto fijo. Una regalía fija es absoluta: se debe completa sea cual sea el valor, incluso en una donación de valor cero. Como eso podría dejar al vendedor pagando por vender, una regalía fija le da a la obra un precio mínimo de regalía + max(5%, $25), y ese piso se hace cumplir — un precio o una oferta por debajo se rechazan. No hay pago de faltante ni regalía prepagada. La regalía se congela para siempre en la primera venta, tanto el monto como el tipo. Una regalía fija nunca muestra un porcentaje, porque no aplica ninguno.`,
      pt: `Um royalty é uma porcentagem do valor ou um valor fixo. Um royalty fixo é absoluto: é devido integralmente qualquer que seja o valor, inclusive numa transferência de valor zero. Como isso poderia deixar o vendedor pagando para vender, um royalty fixo dá à obra um preço mínimo de royalty + max(5%, $25), e esse piso é obrigatório — preço ou oferta abaixo dele são recusados. Não há pagamento de diferença nem royalty pré-pago. O royalty é travado permanentemente na primeira venda, valor e tipo. Um royalty fixo nunca exibe porcentagem, porque nenhuma se aplica.`,
      fr: `Une redevance est soit un pourcentage de la valeur, soit un montant fixe. Une redevance fixe est absolue : elle est due en totalité quelle que soit la valeur, y compris pour un don de valeur nulle. Comme cela pourrait amener un vendeur à payer pour vendre, une redevance fixe donne à l'œuvre un prix minimum de redevance + max(5 %, $25), et ce plancher est appliqué — un prix ou une offre en dessous est refusé. Il n'existe ni paiement de complément ni redevance prépayée. La redevance est verrouillée définitivement à la première vente, son montant comme son type. Une redevance fixe n'affiche jamais de pourcentage, car aucun ne s'applique.`,
    },
  },
  {
    id: 'certificate_delivery',
    terms: {
      en: ['certificate', 'private key', 'mms', 'did not arrive', 'where is my certificate'],
      es: ['certificado', 'llave privada', 'clave privada', 'mms', 'no llegó', 'dónde está mi certificado'],
      pt: ['certificado', 'chave privada', 'mms', 'não chegou', 'onde está meu certificado'],
      fr: ['certificat', 'clé privée', 'mms', "n'est pas arrivé", 'où est mon certificat'],
    },
    body: {
      en: `The certificate and the private key are delivered by MMS only and are never shown on screen anywhere in the product. If a delivery fails, tbt.cafe opens a support request automatically and treats it as high priority, because it means someone paid and received nothing. Notifications otherwise never use SMS — they go to email and the in-app feed.`,
      es: `El certificado y la llave privada se entregan solo por MMS y no se muestran nunca en pantalla en ninguna parte del producto. Si una entrega falla, tbt.cafe abre una solicitud de soporte automáticamente y la trata como prioritaria, porque significa que alguien pagó y no recibió nada. Por lo demás, las notificaciones nunca usan SMS: van al correo y al feed dentro de la app.`,
      pt: `O certificado e a chave privada são entregues apenas por MMS e nunca são exibidos na tela em nenhuma parte do produto. Se uma entrega falha, o tbt.cafe abre uma solicitação de suporte automaticamente e a trata como prioritária, porque significa que alguém pagou e não recebeu nada. Fora isso, as notificações nunca usam SMS: vão para o e-mail e o feed no app.`,
      fr: `Le certificat et la clé privée sont livrés uniquement par MMS et ne sont jamais affichés à l'écran dans le produit. Si une livraison échoue, tbt.cafe ouvre automatiquement une demande d'assistance et la traite en priorité, car cela signifie que quelqu'un a payé sans rien recevoir. Sinon, les notifications n'utilisent jamais le SMS : elles vont à l'e-mail et au fil dans l'application.`,
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
      en: `On a transfer the sender pays; there is no buyer. The cost is the royalty plus $${FEE} plus processing of (royalty + $${FEE}) x 2.9% + $0.30. A transfer value may be zero — with a percentage royalty the royalty is then zero, but a fixed royalty is still owed in full. Transfers carry no minimum price floor, because the sender is the paying party and sees the full cost before committing.`,
      es: `En una transferencia paga el emisor; no hay comprador. El costo es la regalía más $${FEE} más el procesamiento de (regalía + $${FEE}) x 2,9% + $0,30. El valor de una transferencia puede ser cero: con regalía porcentual la regalía es entonces cero, pero una regalía fija se debe completa igual. Las transferencias no llevan piso de precio, porque quien paga es el emisor y ve el costo completo antes de confirmar.`,
      pt: `Numa transferência quem paga é o remetente; não há comprador. O custo é o royalty mais $${FEE} mais o processamento de (royalty + $${FEE}) x 2,9% + $0,30. O valor de uma transferência pode ser zero: com royalty percentual o royalty é então zero, mas um royalty fixo continua devido integralmente. Transferências não têm piso de preço, porque quem paga é o remetente e vê o custo completo antes de confirmar.`,
      fr: `Lors d'un transfert, c'est l'expéditeur qui paie ; il n'y a pas d'acheteur. Le coût est la redevance plus $${FEE} plus les frais de (redevance + $${FEE}) x 2,9 % + $0,30. La valeur d'un transfert peut être nulle : avec une redevance en pourcentage elle est alors nulle, mais une redevance fixe reste due en totalité. Les transferts n'ont pas de prix plancher, car l'expéditeur est la partie payante et voit le coût complet avant de confirmer.`,
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
      en: `Sealing a work freezes its price, royalties, context and originality scan at one moment, and all of that goes into a permanent certificate. Payment must happen inside the window that opens at sealing. If it lapses, nothing is lost: the draft stays and the creator seals again, which recaptures those anchors and opens a new window.`,
      es: `Sellar una obra congela su precio, sus regalías, su contexto y el escaneo de originalidad en un instante, y todo eso entra en un certificado permanente. El pago tiene que ocurrir dentro de la ventana que se abre al sellar. Si vence, no se pierde nada: el borrador sigue ahí y el creador vuelve a sellar, lo que recaptura esos anclajes y abre una ventana nueva.`,
      pt: `Selar uma obra congela preço, royalties, contexto e a verificação de originalidade num instante, e tudo isso entra num certificado permanente. O pagamento precisa acontecer dentro da janela que abre ao selar. Se vencer, nada se perde: o rascunho continua e o criador sela de novo, o que recaptura essas âncoras e abre uma janela nova.`,
      fr: `Sceller une œuvre fige son prix, ses redevances, son contexte et l'analyse d'originalité à un instant précis, et tout cela entre dans un certificat permanent. Le paiement doit avoir lieu dans la fenêtre qui s'ouvre au scellage. Si elle expire, rien n'est perdu : le brouillon reste et le créateur scelle à nouveau, ce qui recapture ces ancrages et ouvre une nouvelle fenêtre.`,
    },
  },
  {
    id: 'what_is_a_tbt',
    terms: {
      en: ['what is a tbt', 'nft', 'token', 'certificate of authorship', 'bitcoin'],
      es: ['qué es un tbt', 'nft', 'token', 'certificado de autoría', 'bitcoin'],
      pt: ['o que é um tbt', 'nft', 'token', 'certificado de autoria', 'bitcoin'],
      fr: ["qu'est-ce qu'un tbt", 'nft', 'jeton', "certificat d'authenticité", 'bitcoin'],
    },
    body: {
      en: `A TBT is a Transferable Billable Token: a token that holds a work's certificate of authorship, its ownership, its transfer history and its commercial terms including any royalty. The certificate is one of the things the token carries, not the definition of it. NFTs can be used as a familiar comparison, but a TBT is not simply "an NFT". Records are anchored to Bitcoin; that is not the same as being a Bitcoin NFT. Chain-written records cannot be altered — corrective records supersede, they never erase.`,
      es: `Un TBT es un Token Transferible Facturable: un token que contiene el certificado de autoría de una obra, su propiedad, su historial de transferencias y sus términos comerciales, incluida cualquier regalía. El certificado es una de las cosas que el token lleva, no su definición. Los NFT sirven como comparación conocida, pero un TBT no es simplemente "un NFT". Los registros están anclados a Bitcoin; eso no es lo mismo que ser un NFT de Bitcoin. Lo escrito en cadena no se puede alterar: los registros correctivos sustituyen, nunca borran.`,
      pt: `Um TBT é um Token Transferível Faturável: um token que contém o certificado de autoria de uma obra, sua propriedade, seu histórico de transferências e seus termos comerciais, incluindo qualquer royalty. O certificado é uma das coisas que o token carrega, não a definição dele. NFTs servem como comparação familiar, mas um TBT não é simplesmente "um NFT". Os registros são ancorados ao Bitcoin; isso não é o mesmo que ser um NFT de Bitcoin. O que é escrito na cadeia não pode ser alterado: registros corretivos substituem, nunca apagam.`,
      fr: `Un TBT est un Token Transférable Facturable : un jeton qui contient le certificat d'authenticité d'une œuvre, sa propriété, son historique de transferts et ses conditions commerciales, y compris toute redevance. Le certificat est l'une des choses que le jeton porte, non sa définition. Les NFT servent de comparaison familière, mais un TBT n'est pas simplement « un NFT ». Les registres sont ancrés à Bitcoin ; ce n'est pas la même chose qu'être un NFT Bitcoin. Ce qui est écrit sur la chaîne ne peut être modifié : les registres correctifs remplacent, ils n'effacent jamais.`,
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
      en: `tbt.cafe has authentication, not accounts. Access is by mobile number with an SMS one-time code, optionally with biometrics per device. The private code is a separate knowledge factor that gates money movement; it is stored hashed, so it can be reset through the recovery email but never recovered. An email address is optional in general, but genuinely required to acquire a TBT or to collect payouts.`,
      es: `tbt.cafe tiene autenticación, no cuentas. El acceso es por número de móvil con un código de un solo uso por SMS, y opcionalmente con biometría por dispositivo. El código privado es un factor aparte que protege el movimiento de dinero; se guarda cifrado, así que se puede restablecer por el correo de recuperación pero nunca recuperar. El correo es opcional en general, pero sí es obligatorio para adquirir un TBT o para cobrar.`,
      pt: `O tbt.cafe tem autenticação, não contas. O acesso é por número de celular com um código de uso único por SMS, e opcionalmente com biometria por dispositivo. O código privado é um fator separado que protege a movimentação de dinheiro; é armazenado com hash, então pode ser redefinido pelo e-mail de recuperação, nunca recuperado. O e-mail é opcional em geral, mas realmente necessário para adquirir um TBT ou para receber pagamentos.`,
      fr: `tbt.cafe dispose d'une authentification, pas de comptes. L'accès se fait par numéro de mobile avec un code à usage unique par SMS, et éventuellement par biométrie sur chaque appareil. Le code privé est un facteur distinct qui protège les mouvements d'argent ; il est stocké haché, donc réinitialisable via l'e-mail de récupération mais jamais récupérable. L'e-mail est facultatif en général, mais réellement requis pour acquérir un TBT ou pour percevoir des versements.`,
    },
  },
]

/**
 * Recuperación por idioma de la pregunta. Buscar en español contra contenido en
 * español da mejores respuestas que recuperar en inglés y traducir al generar.
 *
 * Devuelve vacío cuando nada casa, y eso importa: si no se recupera nada, el
 * asistente NO sabe y lo dice, en vez de inventar una estructura de tarifas
 * verosímil.
 */
export function retrieve(question: string, locale: Locale, limit = 3): KnowledgeDoc[] {
  const q = question.toLowerCase()
  const scored = KNOWLEDGE.map((doc) => {
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
