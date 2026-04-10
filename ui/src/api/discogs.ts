import { fetchAuthSession } from 'aws-amplify/auth'

export interface DiscogsSearchResult {
  id: number
  title: string
  year?: string
  country?: string
  resource_url: string
  thumb?: string
  label?: string[]
  format?: string[]
  catno?: string
}

export interface DiscogsSearchResponse {
  results: DiscogsSearchResult[]
  pagination: {
    page: number
    pages: number
    per_page: number
    items: number
    urls: Record<string, string>
  }
}

export interface DiscogsRelease {
  id: number
  title: string
  artists_sort?: string
  year?: number
  country?: string
  released?: string
  genres?: string[]
  styles?: string[]
  formats?: { name: string; qty?: string; descriptions?: string[] }[]
  tracklist?: { position: string; title: string; duration: string }[]
  resource_url?: string
  images?: unknown[]
  identifiers?: { type: string; value: string; description?: string }[]
  [key: string]: unknown
}

async function authHeaders(): Promise<HeadersInit> {
  const { tokens } = await fetchAuthSession()
  const token = tokens?.idToken?.toString()
  if (!token) throw new Error('No ID token available')
  return { Authorization: `Bearer ${token}` }
}

export async function searchDiscogs(q: string, page = 1, perPage = 50): Promise<DiscogsSearchResponse> {
  const headers = await authHeaders()
  const params = new URLSearchParams({ q, page: String(page), per_page: String(perPage) })
  const res = await fetch(`/api/discogs/releases?${params}`, { headers })
  if (!res.ok) throw new Error(`Discogs search failed (${res.status})`)
  return res.json() as Promise<DiscogsSearchResponse>
}

export async function getDiscogsRelease(id: number): Promise<DiscogsRelease> {
  const headers = await authHeaders()
  const res = await fetch(`/api/discogs/releases/${id}`, { headers })
  if (!res.ok) throw new Error(`Discogs release fetch failed (${res.status})`)
  return res.json() as Promise<DiscogsRelease>
}
