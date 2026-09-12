import { Link } from 'react-router-dom'
import { APPS } from '../apps'
import type { TeamMember } from '../lib/types'

export default function Home({ me, email }: { me: TeamMember | null; email: string }) {
  const isAdmin = me?.role === 'admin'
  const tiles = APPS.filter((a) => !a.adminOnly || isAdmin)
  const first = email.split('@')[0]

  return (
    <div className="home">
      <h1>Welcome, {first}</h1>
      <p className="muted">Pick a tool to get started.</p>
      <div className="tiles">
        {tiles.map((a) =>
          a.to.startsWith('http') ? (
            <a key={a.key} className="tile card" href={a.to} target="_blank" rel="noreferrer">
              <span className="tile-icon">{a.icon}</span>
              <span className="tile-title">{a.title}</span>
              <span className="muted small">{a.description}</span>
            </a>
          ) : (
            <Link key={a.key} className="tile card" to={a.to}>
              <span className="tile-icon">{a.icon}</span>
              <span className="tile-title">{a.title}</span>
              <span className="muted small">{a.description}</span>
            </Link>
          ),
        )}
      </div>
    </div>
  )
}
