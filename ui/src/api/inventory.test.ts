import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listItems, getSummary, acquireItems, deleteItem } from './inventory'

// Mock aws-amplify/auth
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({
    tokens: { idToken: { toString: () => 'mock-token' } },
  }),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('listItems', () => {
  it('calls /api/inventory with auth header', async () => {
    mockFetch.mockReturnValue(jsonResponse([]))
    const result = await listItems()
    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/^\/api\/inventory/)
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer mock-token')
    expect(result).toEqual([])
  })

  it('appends collection param when provided', async () => {
    mockFetch.mockReturnValue(jsonResponse([]))
    await listItems('PERSONAL')
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('collection=PERSONAL')
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockReturnValue(jsonResponse({}, 500))
    await expect(listItems()).rejects.toThrow('Failed to fetch inventory (500)')
  })
})

describe('getSummary', () => {
  it('returns summary data', async () => {
    const data = { personal: 2, distribution: 3, total: 5 }
    mockFetch.mockReturnValue(jsonResponse(data))
    const result = await getSummary()
    expect(result).toEqual(data)
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/inventory/summary')
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockReturnValue(jsonResponse({}, 500))
    await expect(getSummary()).rejects.toThrow('Failed to fetch summary (500)')
  })
})

describe('acquireItems', () => {
  it('POSTs with correct body', async () => {
    mockFetch.mockReturnValue(jsonResponse([]))
    await acquireItems({ collection_type: 'PERSONAL', quantity: 2 })
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/inventory/acquire')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body as string)).toEqual({ collection_type: 'PERSONAL', quantity: 2 })
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockReturnValue(jsonResponse({}, 422))
    await expect(acquireItems({ collection_type: 'DISTRIBUTION' })).rejects.toThrow('Acquire failed (422)')
  })
})

describe('deleteItem', () => {
  it('sends DELETE to correct URL', async () => {
    mockFetch.mockReturnValue(jsonResponse(null, 200))
    await deleteItem('abc-123')
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/inventory/abc-123')
    expect(opts.method).toBe('DELETE')
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockReturnValue(jsonResponse({}, 404))
    await expect(deleteItem('bad-id')).rejects.toThrow('Delete failed (404)')
  })
})
