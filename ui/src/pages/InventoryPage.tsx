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
import { searchDiscogs, getDiscogsRelease, type DiscogsSearchResult } from '../api/discogs'
import { EditItemPanel } from '../components/EditItemPanel'
import { ItemDetailPanel } from '../components/ItemDetailPanel'
import { Link } from 'react-router-dom'
import { WordMark } from '../components/WordMark'

interface InventoryPageProps {
  user: AuthUser
  signOut: () => void
}

type CollectionFilter = 'ALL' | 'PRIVATE' | 'PUBLIC'

export function InventoryPage({ user, signOut }: InventoryPageProps) {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [filter, setFilter] = useState<CollectionFilter>('ALL')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAcquire, setShowAcquire] = useState(false)
  const [acquireForm, setAcquireForm] = useState<AcquireRequest>({
    collection_type: 'PRIVATE',
    is_sealed: false,
  })
  const [acquiring, setAcquiring] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [viewingItemId, setViewingItemId] = useState<string | null>(null)

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

  // Clear any active edit or detail panel when the filter changes so a stale
  // id cannot re-open the panel if the item reappears.
  useEffect(() => {
    setEditingItemId(null)
    setViewingItemId(null)
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
      catalog_number: result.catno ?? null,
      matrix: null,
    }
    setSelectedPressing(pressing)
    setAcquireForm(f => ({ ...f, pressing }))
    setDiscogsResults([])
    setDiscogsQuery(result.title)

    // Best-effort: fetch full release to populate matrix.
    // Non-blocking — pressing is already set; we update state if the fetch resolves.
    // Gate on releaseId so a stale promise cannot overwrite a newer selection.
    const releaseId = result.id
    getDiscogsRelease(releaseId)
      .then(release => {
        const matrix = release.identifiers
          ?.filter(i => i.type === 'Matrix / Runout')
          .map(i => i.value)
          .join(' / ') || null
        if (matrix) {
          setSelectedPressing(p =>
            p && p.discogs_release_id === releaseId ? { ...p, matrix } : p
          )
          setAcquireForm(f =>
            f.pressing && f.pressing.discogs_release_id === releaseId
              ? { ...f, pressing: { ...f.pressing, matrix } }
              : f
          )
        }
      })
      .catch(() => { /* matrix stays null — non-critical */ })
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
    setAcquireForm({ collection_type: 'PRIVATE', is_sealed: false })
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

  async function handleTransferred(_updated: InventoryItem) {
    setError(null)
    try {
      await load()
      setViewingItemId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh after transfer failed')
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
        <div className="inventory-toolbar">
          <div className="toolbar-left">
            <h2>Inventory</h2>
            {summary && (
              <div className="summary-counts">
                <span>Private: <strong>{summary.private}</strong></span>
                <span>Public: <strong>{summary.public}</strong></span>
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
              + Add
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
                    <th scope="col">Catalog</th>
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
                      <td>{r.catno ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {selectedPressing && (
              <div className="selected-pressing">
                <div className="selected-pressing-info">
                  <span className="selected-pressing-title">
                    <strong>Selected:</strong> {selectedPressing.title}
                    {selectedPressing.year != null && ` (${selectedPressing.year})`}
                    {selectedPressing.country && ` · ${selectedPressing.country}`}
                    {selectedPressing.catalog_number && ` · ${selectedPressing.catalog_number}`}
                  </span>
                  {selectedPressing.matrix && (
                    <span className="selected-pressing-matrix">Matrix: {selectedPressing.matrix}</span>
                  )}
                </div>
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
                    collection_type: e.target.value as 'PRIVATE' | 'PUBLIC',
                  }))
                }
              >
                <option value="PRIVATE">Private</option>
                <option value="PUBLIC">Public</option>
              </select>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={acquireForm.is_sealed ?? false}
                onChange={e => setAcquireForm(f => ({ ...f, is_sealed: e.target.checked }))}
              />
              Sealed
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
                {acquiring ? 'Adding…' : 'Confirm'}
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
          {(['ALL', 'PRIVATE', 'PUBLIC'] as CollectionFilter[]).map(f => (
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
            {isAdmin ? 'No records yet. Use Add to add one.' : 'No records yet.'}
          </p>
        ) : (
          <ul className="inventory-list">
            {items.map(item => (
              <li key={item.id} className="inventory-item">
                <div
                  className={`item-row${viewingItemId === item.id ? ' item-row-active' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-expanded={viewingItemId === item.id}
                  onClick={() => {
                    setViewingItemId(id => (id === item.id ? null : item.id))
                    setEditingItemId(null)
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setViewingItemId(id => (id === item.id ? null : item.id))
                      setEditingItemId(null)
                    }
                  }}
                >
                  <div className="item-badges">
                    <span className={`collection-badge ${item.collection_type.toLowerCase()}`}>
                      {item.collection_type}
                    </span>
                    <span className="status-badge">{item.status}</span>
                    {item.is_sealed && <span className="sealed-badge">SEALED</span>}
                  </div>
                  <div className="item-detail">
                    {item.pressing && (
                      <span className="item-pressing">
                        {item.pressing.title ?? '—'}
                        {item.pressing.artists_sort && ` · ${item.pressing.artists_sort}`}
                        {item.pressing.year != null && ` (${item.pressing.year})`}
                        {item.pressing.country && ` · ${item.pressing.country}`}
                        {item.pressing.catalog_number && ` · ${item.pressing.catalog_number}`}
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
                      onClick={e => {
                        e.stopPropagation()
                        setEditingItemId(id => (id === item.id ? null : item.id))
                        setViewingItemId(null)
                      }}
                      aria-label="Edit item"
                    >
                      ✎
                    </button>
                  )}
                  <button
                    className="delete-btn"
                    onClick={e => { e.stopPropagation(); void handleDelete(item.id) }}
                    aria-label="Delete item"
                    hidden={!isAdmin}
                  >
                    ×
                  </button>
                </div>
                {viewingItemId === item.id && (
                  <ItemDetailPanel
                    item={item}
                    isAdmin={isAdmin}
                    onTransferred={handleTransferred}
                    onClose={() => setViewingItemId(null)}
                  />
                )}
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
