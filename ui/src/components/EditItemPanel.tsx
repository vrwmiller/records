import { useEffect, useRef, useState } from 'react'
import { searchDiscogs, getDiscogsRelease, type DiscogsSearchResult } from '../api/discogs'
import { updateItem, type DiscogsPressingIn, type InventoryItem, type UpdateRequest } from '../api/inventory'

interface Props {
  item: InventoryItem
  onSave: (updated: InventoryItem) => void
  onCancel: () => void
}

export function EditItemPanel({ item, onSave, onCancel }: Props) {
  const [discogsQuery, setDiscogsQuery] = useState(item.pressing?.title ?? '')
  const [discogsResults, setDiscogsResults] = useState<DiscogsSearchResult[]>([])
  const [discogsSearching, setDiscogsSearching] = useState(false)
  const [discogsError, setDiscogsError] = useState<string | null>(null)
  const [selectedPressing, setSelectedPressing] = useState<DiscogsPressingIn | null>(null)
  const [conditionMedia, setConditionMedia] = useState(item.condition_media ?? '')
  const [conditionSleeve, setConditionSleeve] = useState(item.condition_sleeve ?? '')
  const [notes, setNotes] = useState(item.notes ?? '')
  const [isSealed, setIsSealed] = useState<boolean | null>(item.is_sealed ?? null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchSeq = useRef(0)
  const isMounted = useRef(true)
  const matrixFetch = useRef<Promise<DiscogsPressingIn | null> | null>(null)

  useEffect(() => {
    return () => {
      isMounted.current = false
      searchSeq.current += 1
      if (searchTimer.current) {
        clearTimeout(searchTimer.current)
        searchTimer.current = null
      }
    }
  }, [])

  function handleDiscogsQueryChange(q: string) {
    setDiscogsQuery(q)
    setSelectedPressing(null)
    setDiscogsError(null)
    if (searchTimer.current) clearTimeout(searchTimer.current)
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
      label: result.label?.[0] ?? null,
    }
    setSelectedPressing(pressing)
    setDiscogsResults([])
    setDiscogsQuery(result.title)

    // Best-effort: fetch full release to populate matrix.
    // Gate on releaseId so a stale promise cannot overwrite a newer selection.
    const releaseId = result.id
    matrixFetch.current = getDiscogsRelease(releaseId)
      .then(release => {
        const matrix = release.identifiers
          ?.filter(i => i.type === 'Matrix / Runout')
          .map(i => i.value)
          .join(' / ') || null
        const label = release.labels?.[0]?.name ?? null
        if ((matrix || label) && isMounted.current) {
          // Compute patched pressing synchronously from the known closure value
          // so the promise resolves to a reliable result regardless of when
          // React schedules the functional updater below.
          const patched: DiscogsPressingIn = {
            ...pressing,
            ...(matrix != null ? { matrix } : {}),
            ...(label != null ? { label } : {}),
          }
          setSelectedPressing(p =>
            p && p.discogs_release_id === releaseId ? patched : p
          )
          return patched
        }
        return null
      })
      .catch(() => null) // matrix/label stays null — non-critical
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      // Await any in-flight matrix fetch so the pressing payload includes matrix
      // and label if the user saves before the best-effort detail request resolves.
      // The promise resolves to the patched DiscogsPressingIn (or null), giving us
      // the settled value without relying on React setState having committed yet.
      let pressingForSave = selectedPressing
      if (matrixFetch.current) {
        const patched = await matrixFetch.current
        matrixFetch.current = null
        if (patched) pressingForSave = patched
      }
      const request: UpdateRequest = {
        ...(pressingForSave ? { pressing: pressingForSave } : {}),
        condition_media: conditionMedia || null,
        condition_sleeve: conditionSleeve || null,
        notes: notes || null,
        ...(isSealed !== null ? { is_sealed: isSealed } : {}),
      }
      const updated = await updateItem(item.id, request)
      if (isMounted.current) onSave(updated)
    } catch (e) {
      if (isMounted.current) setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      if (isMounted.current) setSaving(false)
    }
  }

  return (
    <div className="edit-item-panel">
      <label>
        Re-link pressing
        <input
          type="search"
          placeholder="Search Discogs to change pressing…"
          value={discogsQuery}
          onChange={e => handleDiscogsQueryChange(e.target.value)}
          autoComplete="off"
        />
      </label>

      {discogsSearching && <p className="status-msg">Searching Discogs…</p>}
      {discogsError && <p className="error-msg">{discogsError}</p>}

      {discogsResults.length > 0 && (
        <ul className="discogs-results">
          {discogsResults.map(r => (
            <li key={r.id}>
              <button
                type="button"
                className="discogs-result-btn"
                onClick={() => handleSelectResult(r)}
              >
                <span className="result-title">{r.title}</span>
                {r.year && <span className="result-meta">{r.year}</span>}
                {r.country && <span className="result-meta">{r.country}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {selectedPressing && (
        <div className="selected-pressing">
          <div className="selected-pressing-info">
            <span className="selected-pressing-title">
              <strong>New pressing:</strong> {selectedPressing.title}
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
              setDiscogsQuery(item.pressing?.title ?? '')
            }}
          >
            ✕
          </button>
        </div>
      )}

      <label>
        Media condition
        <input
          type="text"
          value={conditionMedia}
          onChange={e => setConditionMedia(e.target.value)}
        />
      </label>

      <label>
        Sleeve condition
        <input
          type="text"
          value={conditionSleeve}
          onChange={e => setConditionSleeve(e.target.value)}
        />
      </label>

      <label>
        Notes
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />
      </label>

      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={isSealed === true}
          onChange={e => setIsSealed(e.target.checked)}
        />
        Sealed
      </label>

      {saveError && <p className="error-msg">{saveError}</p>}

      <div className="edit-actions">
        <button
          className="confirm-btn"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          className="cancel-btn"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
