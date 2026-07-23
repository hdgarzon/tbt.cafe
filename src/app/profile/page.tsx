/**
 * /profile — selector entre perfil de Creador y de Coleccionista
 * (Master Handoff §11). Se puede tener uno, otro, o ambos.
 */
export default function ProfilePage() {
  const cards = [
    { key: 'creator', title: 'Creator profile', sub: 'Quien certifica la obra' },
    { key: 'collector', title: 'Collector profile', sub: 'Quien la adquiere' },
  ]

  return (
    <div className="flex-1 px-5 py-8">
      <div className="label-caps">Profile</div>
      <div className="mt-5 flex flex-col">
        {cards.map((c) => (
          <a
            key={c.key}
            href={`/profile/${c.key}`}
            className="py-5 border-b border-hairline hover:bg-paper-warm transition-colors -mx-5 px-5"
          >
            <div className="font-display text-[24px] leading-none">{c.title}</div>
            <div className="label-caps mt-2">{c.sub}</div>
          </a>
        ))}
      </div>
    </div>
  )
}
