import { fetchAuthSession } from 'aws-amplify/auth'

export interface InventoryItem {
  id: string
  pressing_id: string | null
  acquisition_batch_id: string | null
  collection_type: 'PERSONAL' | 'DISTRIBUTION'
  condition_media: string | null
  condition_sleeve: string | null
  status: string
  notes: string | null
  created_at: string
  deleted_at: string | null
}

export interface SummaryResponse {
  personal: number
  distribution: number
  total: number
}

export interface AcquireRequest {
  collection_type: 'PERSONAL' | 'DISTRIBUTION'
  quantity?: number
  condition_media?: string
  condition_sleeve?: string
  notes?: string
}

async function authHeaders(): Promise<HeadersInit> {
  const { tokens } = await fetchAuthSession()
  const token = tokens?.idToken?.toString()
  if (!token) throw new Error('No ID token available')
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

export async function listItems(collection?: string): Promise<InventoryItem[]> {
  const headers = await authHeaders()
  const PAGE_SIZE = 200
  const MAX_ITEMS = 5000
  const all: InventoryItem[] = []
  let offset = 0
  while (all.length < MAX_ITEMS) {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
    if (collection) params.set('collection', collection)
    const res = await fetch(`/api/inventory?${params}`, { headers })
    if (!res.ok) throw new Error(`Failed to fetch inventory (${res.status})`)
    const page = (await res.json()) as InventoryItem[]
    all.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return all
}

export async function getSummary(): Promise<SummaryResponse> {
  const headers = await authHeaders()
  const res = await fetch('/api/inventory/summary', { headers })
  if (!res.ok) throw new Error(`Failed to fetch summary (${res.status})`)
  return res.json() as Promise<SummaryResponse>
}

export async function acquireItems(request: AcquireRequest): Promise<InventoryItem[]> {
  const headers = await authHeaders()
  const res = await fetch('/api/inventory/acquire', {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
  })
  if (!res.ok) throw new Error(`Acquire failed (${res.status})`)
  return res.json() as Promise<InventoryItem[]>
}

export async function deleteItem(id: string): Promise<void> {
  const headers = await authHeaders()
  const res = await fetch(`/api/inventory/${id}`, {
    method: 'DELETE',
    headers,
  })
  if (!res.ok) throw new Error(`Delete failed (${res.status})`)
}
