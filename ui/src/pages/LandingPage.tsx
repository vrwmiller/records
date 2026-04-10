import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AuthUser } from 'aws-amplify/auth'
import { WordMark } from '../components/WordMark'
import { getRecentItems } from '../api/inventory'
import type { InventoryItem } from '../api/inventory'

interface LandingPageProps {
  user: AuthUser
  signOut: () => void
}

export function LandingPage({ user, signOut }: LandingPageProps) {
  const [recentItems, setRecentItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    getRecentItems(5)
      .then((items) => { if (mounted) setRecentItems(items) })
      .catch((err: unknown) => {
        if (mounted) setError(err instanceof Error ? err.message : 'Failed to load')
      })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [])

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1 className="site-wordmark" aria-label="Record Ranch">
          <Link to="/" className="wordmark-link"><WordMark /></Link>
        </h1>
        <span className="user-id">
          {user?.signInDetails?.loginId ?? 'collector'}
        </span>
        <button onClick={signOut} className="sign-out">
          Sign out
        </button>
      </header>

      <section className="app-content">
        <div className="landing-hero">
          <h2 className="landing-title">Your Record Ranch</h2>
          <Link to="/inventory" className="landing-inventory-link">View full inventory →</Link>
        </div>

        <div className="landing-recent">
          <h3 className="landing-section-heading">Recently Added</h3>
          {loading && <p className="landing-loading">Loading…</p>}
          {error && <p className="landing-error">{error}</p>}
          {!loading && !error && recentItems.length === 0 && (
            <p className="landing-empty">No records yet — add some from the inventory.</p>
          )}
          {!loading && !error && recentItems.length > 0 && (
            <ul className="landing-recent-list">
              {recentItems.map((item) => (
                <li key={item.id} className="landing-recent-item">
                  <span className="landing-recent-title">
                    {item.pressing?.title ?? '—'}
                  </span>
                  {item.pressing?.artists_sort && (
                    <span className="landing-recent-artist">{item.pressing.artists_sort}</span>
                  )}
                  {item.pressing?.year && (
                    <span className="landing-recent-year">{item.pressing.year}</span>
                  )}
                  <span className={`collection-badge ${item.collection_type.toLowerCase()}`}>
                    {item.collection_type}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  )
}
