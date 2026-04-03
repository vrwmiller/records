import { useCallback, useEffect, useState } from 'react'
import type { AuthUser } from 'aws-amplify/auth'
import { fetchAuthSession } from 'aws-amplify/auth'
import {
  acquireItems,
  deleteItem,
  getSummary,
  listItems,
  type AcquireRequest,
  type InventoryItem,
  type SummaryResponse,
} from '../api/inventory'

interface InventoryPageProps {
  user: AuthUser
  signOut: () => void
}

type CollectionFilter = 'ALL' | 'PERSONAL' | 'DISTRIBUTION'

export function InventoryPage({ user, signOut }: InventoryPageProps) {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [filter, setFilter] = useState<CollectionFilter>('ALL')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAcquire, setShowAcquire] = useState(false)
  const [acquireForm, setAcquireForm] = useState<AcquireRequest>({
    collection_type: 'PERSONAL',
  })
  const [acquiring, setAcquiring] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    fetchAuthSession().then(({ tokens }) => {
      const groups: unknown = tokens?.idToken?.payload?.['cognito:groups']
      setIsAdmin(Array.isArray(groups) && groups.includes('admin'))
    }).catch(() => setIsAdmin(false))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [itemData, summaryData] = await Promise.all([
        listItems(filter === 'ALL' ? undefined : filter),
        getSummary(),
      ])
      setItems(itemData)
      setSummary(summaryData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load inventory')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { void load() }, [load])

  async function handleAcquire() {
    setAcquiring(true)
    setError(null)
    try {
      await acquireItems(acquireForm)
      setShowAcquire(false)
      setAcquireForm({ collection_type: 'PERSONAL' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Acquire failed')
    } finally {
      setAcquiring(false)
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this item? This cannot be undone.')) return
    setError(null)
    try {
      await deleteItem(id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>Record Ranch</h1>
        <span className="user-id">
          {user?.signInDetails?.loginId ?? 'collector'}
        </span>
        <button onClick={signOut} className="sign-out">
          Sign out
        </button>
      </header>

      <section className="app-content">
        <div className="inventory-toolbar">
          <div className="toolbar-left">
            <h2>Inventory</h2>
            {summary && (
              <div className="summary-counts">
                <span>Personal: <strong>{summary.personal}</strong></span>
                <span>Distribution: <strong>{summary.distribution}</strong></span>
                <span className="summary-total">Total: <strong>{summary.total}</strong></span>
              </div>
            )}
          </div>
          {isAdmin && (
            <button
              className="acquire-btn"
              onClick={() => setShowAcquire(v => !v)}
            >
              + Acquire
            </button>
          )}
        </div>

        {showAcquire && isAdmin && (
          <div className="acquire-form">
            <label>
              Collection
              <select
                value={acquireForm.collection_type}
                onChange={e =>
                  setAcquireForm(f => ({
                    ...f,
                    collection_type: e.target.value as 'PERSONAL' | 'DISTRIBUTION',
                  }))
                }
              >
                <option value="PERSONAL">Personal</option>
                <option value="DISTRIBUTION">Distribution</option>
              </select>
            </label>
            <label>
              Quantity
              <input
                type="number"
                min={1}
                max={100}
                value={acquireForm.quantity ?? 1}
                onChange={e => {
                  const n = e.currentTarget.valueAsNumber
                  setAcquireForm(f => ({
                    ...f,
                    quantity: Number.isNaN(n) ? undefined : Math.min(100, Math.max(1, Math.trunc(n))),
                  }))
                }}
              />
            </label>
            <div className="acquire-actions">
              <button
                className="confirm-btn"
                onClick={() => void handleAcquire()}
                disabled={acquiring}
              >
                {acquiring ? 'Acquiring…' : 'Confirm'}
              </button>
              <button
                className="cancel-btn"
                onClick={() => setShowAcquire(false)}
                disabled={acquiring}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="filter-group">
          {(['ALL', 'PERSONAL', 'DISTRIBUTION'] as CollectionFilter[]).map(f => (
            <button
              key={f}
              className={`filter-btn${filter === f ? ' active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="status-msg">Loading…</p>
        ) : error ? (
          <p className="error-msg">{error}</p>
        ) : items.length === 0 ? (
          <p className="status-msg">
            {isAdmin ? 'No records yet. Use Acquire to add one.' : 'No records yet.'}
          </p>
        ) : (
          <ul className="inventory-list">
            {items.map(item => (
              <li key={item.id} className="inventory-item">
                <div className="item-badges">
                  <span className={`collection-badge ${item.collection_type.toLowerCase()}`}>
                    {item.collection_type}
                  </span>
                  <span className="status-badge">{item.status}</span>
                </div>
                <div className="item-detail">
                  {item.condition_media && (
                    <span>Media: {item.condition_media}</span>
                  )}
                  {item.condition_sleeve && (
                    <span>Sleeve: {item.condition_sleeve}</span>
                  )}
                  {item.notes && (
                    <span className="item-notes">{item.notes}</span>
                  )}
                  <span className="item-date">
                    Added {new Date(item.created_at).toLocaleDateString()}
                  </span>
                </div>
                <button
                  className="delete-btn"
                  onClick={() => void handleDelete(item.id)}
                  aria-label="Delete item"
                  hidden={!isAdmin}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
