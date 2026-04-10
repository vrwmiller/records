import { useEffect, useRef, useState } from 'react'
import { getDiscogsRelease, type DiscogsRelease } from '../api/discogs'
import { transferItem, type InventoryItem } from '../api/inventory'

interface Props {
  item: InventoryItem
  isAdmin: boolean
  onTransferred: (updated: InventoryItem) => void
  onClose: () => void
}

export function ItemDetailPanel({ item, isAdmin, onTransferred, onClose }: Props) {
  const [release, setRelease] = useState<DiscogsRelease | null>(null)
  const [releaseLoading, setReleaseLoading] = useState(false)
  const [releaseError, setReleaseError] = useState<string | null>(null)
  const [transferring, setTransferring] = useState(false)
  const [transferError, setTransferError] = useState<string | null>(null)
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true
    return () => { isMounted.current = false }
  }, [])

  // Auto-fetch Discogs release when panel opens, if pressing has a release ID.
  // Track the requested ID so a stale response from a prior item cannot
  // overwrite state for the currently displayed item.
  useEffect(() => {
    const releaseId = item.pressing?.discogs_release_id
    setRelease(null)
    setReleaseError(null)
    if (!releaseId) {
      setReleaseLoading(false)
      return
    }
    setReleaseLoading(true)
    const requestedId = releaseId
    getDiscogsRelease(releaseId)
      .then(r => { if (isMounted.current && item.pressing?.discogs_release_id === requestedId) setRelease(r) })
      .catch(e => { if (isMounted.current && item.pressing?.discogs_release_id === requestedId) setReleaseError(e instanceof Error ? e.message : 'Failed to load Discogs data') })
      .finally(() => { if (isMounted.current && item.pressing?.discogs_release_id === requestedId) setReleaseLoading(false) })
  }, [item.pressing?.discogs_release_id])

  async function handleTransfer() {
    const target = item.collection_type === 'PERSONAL' ? 'DISTRIBUTION' : 'PERSONAL'
    const targetLabel = item.collection_type === 'PERSONAL' ? 'Distribution' : 'Personal'
    if (!window.confirm(`Move this item to ${targetLabel}?`)) return
    setTransferring(true)
    setTransferError(null)
    try {
      const updated = await transferItem(item.id, target)
      onTransferred(updated)
    } catch (e) {
      if (isMounted.current) setTransferError(e instanceof Error ? e.message : 'Transfer failed')
    } finally {
      if (isMounted.current) setTransferring(false)
    }
  }

  const p = item.pressing
  const target = item.collection_type === 'PERSONAL' ? 'Distribution' : 'Personal'

  return (
    <div className="item-detail-panel">
      <div className="item-detail-panel-header">
        <h3>Item Detail</h3>
        <button className="panel-close-btn" onClick={onClose} aria-label="Close detail panel">✕</button>
      </div>

      <dl className="item-detail-fields">
        <dt>Collection</dt>
        <dd>{item.collection_type.charAt(0) + item.collection_type.slice(1).toLowerCase()}</dd>

        <dt>Status</dt>
        <dd>{item.status}</dd>

        <dt>Sealed</dt>
        <dd>{item.is_sealed === true ? 'Yes' : item.is_sealed === false ? 'No' : 'Unknown'}</dd>

        {item.condition_media && <><dt>Media condition</dt><dd>{item.condition_media}</dd></>}
        {item.condition_sleeve && <><dt>Sleeve condition</dt><dd>{item.condition_sleeve}</dd></>}
        {item.notes && <><dt>Notes</dt><dd>{item.notes}</dd></>}

        <dt>Added</dt>
        <dd>{new Date(item.created_at).toLocaleDateString()}</dd>
      </dl>

      {p && (
        <section className="item-detail-pressing">
          <h4>Pressing</h4>
          <dl className="item-detail-fields">
            {p.title && <><dt>Title</dt><dd>{p.title}</dd></>}
            {p.artists_sort && <><dt>Artist</dt><dd>{p.artists_sort}</dd></>}
            {p.year != null && <><dt>Year</dt><dd>{p.year}</dd></>}
            {p.country && <><dt>Country</dt><dd>{p.country}</dd></>}
            {p.catalog_number && <><dt>Catalog</dt><dd>{p.catalog_number}</dd></>}
            {p.matrix && <><dt>Matrix</dt><dd className="matrix-value">{p.matrix}</dd></>}
          </dl>
        </section>
      )}

      {p?.discogs_release_id && (
        <section className="item-detail-discogs">
          <h4>Discogs Data</h4>
          {releaseLoading && <p className="status-msg">Loading…</p>}
          {releaseError && <p className="error-msg">{releaseError}</p>}
          {release && (
            <dl className="item-detail-fields">
              {release.released && <><dt>Released</dt><dd>{release.released}</dd></>}
              {release.genres && release.genres.length > 0 && <><dt>Genre</dt><dd>{release.genres.join(', ')}</dd></>}
              {release.styles && release.styles.length > 0 && <><dt>Style</dt><dd>{release.styles.join(', ')}</dd></>}
              {release.formats && release.formats.length > 0 && (
                <><dt>Format</dt><dd>{release.formats.map(f => f.name).join(', ')}</dd></>
              )}
              {release.tracklist && release.tracklist.length > 0 && (
                <><dt>Tracks</dt><dd>{release.tracklist.length} tracks</dd></>
              )}
            </dl>
          )}
        </section>
      )}

      {isAdmin && (
        <div className="item-detail-actions">
          {transferError && <p className="error-msg">{transferError}</p>}
          <button
            className="transfer-btn"
            onClick={() => void handleTransfer()}
            disabled={transferring}
          >
            {transferring ? 'Transferring…' : `Transfer to ${target}`}
          </button>
        </div>
      )}
    </div>
  )
}
