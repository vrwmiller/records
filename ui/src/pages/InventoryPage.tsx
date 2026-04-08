import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuthUser } from 'aws-amplify/auth'
import { fetchAuthSession } from 'aws-amplify/auth'
import {
  acquireItems,
  deleteItem,
  getSummary,
  listItems,
  type AcquireRequest,
  type DiscogsPressingIn,
  type InventoryItem,
  type SummaryResponse,
} from '../api/inventory'
import { searchDiscogs, type DiscogsSearchResult } from '../api/discogs'
import { EditItemPanel } from '../components/EditItemPanel'

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
  const [editingItemId, setEditingItemId] = useState<string | null>(null)

  // Discogs search state
  const [discogsQuery, setDiscogsQuery] = useState('')
  const [discogsResults, setDiscogsResults] = useState<DiscogsSearchResult[]>([])
  const [discogsSearching, setDiscogsSearching] = useState(false)
  const [discogsError, setDiscogsError] = useState<string | null>(null)
  const [selectedPressing, setSelectedPressing] = useState<DiscogsPressingIn | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Monotonically increasing request ID to discard stale search responses.
  const searchSeq = useRef(0)

  useEffect(() => {
    fetchAuthSession().then(({ tokens }) => {
      const groups: unknown = tokens?.idToken?.payload?.['cognito:groups']
      setIsAdmin(Array.isArray(groups) && groups.includes('admin'))
    }).catch(() => setIsAdmin(false))
  }, [])

  // Clear pending search timer on unmount to avoid setState-after-unmount.
  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
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

  // Clear any active edit panel when the filter changes so a stale
  // editingItemId cannot re-open the panel if the item reappears.
  useEffect(() => {
    setEditingItemId(null)
  }, [filter])

  function handleDiscogsQueryChange(q: string) {
    setDiscogsQuery(q)
    setSelectedPressing(null)
    // Clear pressing from the form immediately so a stale selection is never
    // submitted if the user edits the query without explicitly clicking ✕.
    setAcquireForm(f => { const { pressing: _, ...rest } = f; return rest })
    setDiscogsError(null)

    if (searchTimer.current) clearTimeout(searchTimer.current)

    // Increment seq before the early-return so any in-flight request from a
    // prior non-empty query is invalidated even when the user clears the input.
    const seq = ++searchSeq.current

    if (!q.trim()) {
      setDiscogsResults([])
      setDiscogsSearching(false)
      return
    }
    searchTimer.current = setTimeout(() => {
      setDiscogsSearching(true)
      searchDiscogs(q)
        .then(data => {
          // Ignore responses that arrived after a newer request was issued.
          if (seq !== searchSeq.current) return
          setDiscogsResults(data.results)
        })
        .catch(e => {
          if (seq !== searchSeq.current) return
          setDiscogsError(e instanceof Error ? e.message : 'Search failed')
        })
        .finally(() => {
          if (seq === searchSeq.current) setDiscogsSearching(false)
        })
    }, 400)
  }

  function handleSelectResult(result: DiscogsSearchResult) {
    // Cancel any pending debounce and invalidate in-flight requests so that
    // selecting a pressing is a terminal action for the current search cycle.
    if (searchTimer.current) clearTimeout(searchTimer.current)
    ++searchSeq.current
    setDiscogsSearching(false)
    const pressing: DiscogsPressingIn = {
      discogs_release_id: result.id,
      discogs_resource_url: result.resource_url,
      title: result.title,
      artists_sort: null,
      year: result.year != null ? Number(result.year) : null,
      country: result.country ?? null,
    }
    setSelectedPressing(pressing)
    setAcquireForm(f => ({ ...f, pressing }))
    setDiscogsResults([])
    setDiscogsQuery(result.title)
  }

  function resetAcquireForm() {
    // Cancel any pending debounce and invalidate in-flight search promises so
    // that stale results cannot repopulate state after the form is closed.
    if (searchTimer.current) {
      clearTimeout(searchTimer.current)
      searchTimer.current = null
    }
    ++searchSeq.current
    setDiscogsSearching(false)
    setAcquireForm({ collection_type: 'PERSONAL' })
    setDiscogsQuery('')
    setDiscogsResults([])
    setSelectedPressing(null)
    setDiscogsError(null)
  }

  async function handleAcquire() {
    setAcquiring(true)
    setError(null)
    try {
      await acquireItems(acquireForm)
      setShowAcquire(false)
      resetAcquireForm()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Acquire failed')
    } finally {
      setAcquiring(false)
    }
  }

  function handleUpdateSaved(updated: InventoryItem) {
    setItems(prev => prev.map(i => (i.id === updated.id ? updated : i)))
    setEditingItemId(null)
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
              onClick={() => {
                setShowAcquire(v => !v)
                if (showAcquire) resetAcquireForm()
              }}
            >
              + Acquire
            </button>
          )}
        </div>

        {showAcquire && isAdmin && (
          <div className="acquire-form">
            <label>
              Search Discogs
              <input
                type="search"
                placeholder="Artist, title, label…"
                value={discogsQuery}
                onChange={e => handleDiscogsQueryChange(e.target.value)}
                autoComplete="off"
              />
            </label>

            {discogsSearching && <p className="status-msg">Searching Discogs…</p>}
            {discogsError && <p className="error-msg">{discogsError}</p>}

            {discogsResults.length > 0 && (
              <table className="discogs-results" aria-label="Discogs search results">
                <thead>
                  <tr>
                    <th scope="col">Title</th>
                    <th scope="col">Year</th>
                    <th scope="col">Country</th>
                    <th scope="col">Label</th>
                  </tr>
                </thead>
                <tbody>
                  {discogsResults.map(r => (
                    <tr
                      key={r.id}
                      className="discogs-result-row"
                      tabIndex={0}
                      onClick={() => handleSelectResult(r)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleSelectResult(r)
                        }
                      }}
                    >
                      <td>{r.title}</td>
                      <td>{r.year ?? '—'}</td>
                      <td>{r.country ?? '—'}</td>
                      <td>{r.label?.[0] ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {selectedPressing && (
              <div className="selected-pressing">
                <strong>Selected:</strong> {selectedPressing.title}
                {selectedPressing.year != null && ` (${selectedPressing.year})`}
                {selectedPressing.country && ` · ${selectedPressing.country}`}
                <button
                  type="button"
                  className="clear-pressing-btn"
                  aria-label="Clear selected pressing"
                  onClick={() => {
                    setSelectedPressing(null)
                    setAcquireForm(f => { const { pressing: _, ...rest } = f; return rest })
                    setDiscogsQuery('')
                  }}
                >
                  ✕
                </button>
              </div>
            )}

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
                onClick={() => { setShowAcquire(false); resetAcquireForm() }}
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
                <div className="item-row">
                  <div className="item-badges">
                    <span className={`collection-badge ${item.collection_type.toLowerCase()}`}>
                      {item.collection_type}
                    </span>
                    <span className="status-badge">{item.status}</span>
                  </div>
                  <div className="item-detail">
                    {item.pressing && (
                      <span className="item-pressing">
                        {item.pressing.title ?? '—'}
                        {item.pressing.artists_sort && ` · ${item.pressing.artists_sort}`}
                        {item.pressing.year != null && ` (${item.pressing.year})`}
                        {item.pressing.country && ` · ${item.pressing.country}`}
                      </span>
                    )}
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
                  {isAdmin && (
                    <button
                      className="edit-btn"
                      onClick={() =>
                        setEditingItemId(id => (id === item.id ? null : item.id))
                      }
                      aria-label="Edit item"
                    >
                      ✎
                    </button>
                  )}
                  <button
                    className="delete-btn"
                    onClick={() => void handleDelete(item.id)}
                    aria-label="Delete item"
                    hidden={!isAdmin}
                  >
                    ×
                  </button>
                </div>
                {editingItemId === item.id && (
                  <EditItemPanel
                    item={item}
                    onSave={handleUpdateSaved}
                    onCancel={() => setEditingItemId(null)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
