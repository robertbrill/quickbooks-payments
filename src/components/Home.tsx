import { Link } from 'react-router-dom'
import type { AppTile } from '../apps'

export default function Home({ apps, email }: { apps: AppTile[]; email: string }) {
  const first = email.split('@')[0]

  return (
    <div className="home">
      <h1>Welcome, {first}</h1>
      {apps.length === 0 ? (
        <div className="empty card">
          <h2>No apps yet</h2>
          <p className="muted">An admin hasn't given you access to anything yet. Ask them to add you to an app.</p>
        </div>
      ) : (
        <>
          <p className="muted">Pick a tool to get started.</p>
          <div className="tiles">
            {apps.map((a) =>
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
        </>
      )}
    </div>
  )
}
