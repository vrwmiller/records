import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { InventoryPage } from './InventoryPage'

// Mock fetchAuthSession to return an admin user so isAdmin=true in the component
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({
    tokens: {
      idToken: {
        payload: { 'cognito:groups': ['admin'] },
        toString: () => 'mock-token',
      },
    },
  }),
}))

// Mock the entire api/inventory module
vi.mock('../api/inventory', () => ({
  listItems: vi.fn(),
  getSummary: vi.fn(),
  acquireItems: vi.fn(),
  deleteItem: vi.fn(),
  updateItem: vi.fn(),
}))

// Mock the Discogs API module
vi.mock('../api/discogs', () => ({
  searchDiscogs: vi.fn(),
  getDiscogsRelease: vi.fn(),
}))

import * as inventoryApi from '../api/inventory'
import * as discogsApi from '../api/discogs'

const mockSearchDiscogs = vi.mocked(discogsApi.searchDiscogs)
const mockGetDiscogsRelease = vi.mocked(discogsApi.getDiscogsRelease)
const mockListItems = vi.mocked(inventoryApi.listItems)
const mockGetSummary = vi.mocked(inventoryApi.getSummary)
const mockAcquireItems = vi.mocked(inventoryApi.acquireItems)
const mockDeleteItem = vi.mocked(inventoryApi.deleteItem)
const mockUpdateItem = vi.mocked(inventoryApi.updateItem)

const mockUser = {
  userId: 'user-1',
  username: 'records@hostileadmin.com',
  signInDetails: { loginId: 'records@hostileadmin.com', authFlowType: 'USER_SRP_AUTH' as const },
}
const mockSignOut = vi.fn()

const emptySummary = { private: 0, public: 0, total: 0 }
const filledSummary = { private: 1, public: 2, total: 3 }

const sampleItem = {
  id: 'item-1',
  pressing_id: null,
  pressing: null,
  acquisition_batch_id: null,
  collection_type: 'PRIVATE' as const,
  condition_media: 'VG+',
  condition_sleeve: null,
  status: 'AVAILABLE',
  notes: null,
  is_sealed: null,
  created_at: '2026-04-01T00:00:00Z',
  deleted_at: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockListItems.mockResolvedValue([])
  mockGetSummary.mockResolvedValue(emptySummary)
  mockAcquireItems.mockResolvedValue([sampleItem])
  mockDeleteItem.mockResolvedValue(undefined)
  mockUpdateItem.mockResolvedValue(sampleItem)
  mockSearchDiscogs.mockResolvedValue({
    results: [],
    pagination: { page: 1, pages: 0, per_page: 50, items: 0, urls: {} },
  })
  // By default resolve with no matrix identifiers so existing tests are unaffected
  mockGetDiscogsRelease.mockResolvedValue({ id: 0, title: '', identifiers: [] })
})

function renderPage() {
  return render(
    <MemoryRouter>
      <InventoryPage user={mockUser} signOut={mockSignOut} />
    </MemoryRouter>,
  )
}

describe('InventoryPage — wordmark accessibility', () => {
  it('renders a level-1 heading with accessible name "Record Ranch"', () => {
    mockListItems.mockReturnValue(new Promise(() => {}))
    mockGetSummary.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Record Ranch' }),
    ).toBeInTheDocument()
  })
})

describe('InventoryPage — loading state', () => {
  it('shows loading indicator while fetching', () => {
    // Never resolve so loading stays true
    mockListItems.mockReturnValue(new Promise(() => {}))
    mockGetSummary.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })
})

describe('InventoryPage — empty state', () => {
  it('shows empty message when no items', async () => {
    renderPage()
    await waitFor(() =>
      expect(screen.getByText('No records yet. Use Add to add one.')).toBeInTheDocument(),
    )
  })

  it('renders summary counts', async () => {
    mockGetSummary.mockResolvedValue(filledSummary)
    renderPage()
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument()) // total
    expect(screen.getByText('1')).toBeInTheDocument() // private
    expect(screen.getByText('2')).toBeInTheDocument() // public
  })
})

describe('InventoryPage — error state', () => {
  it('shows error message when listItems rejects', async () => {
    mockListItems.mockRejectedValue(new Error('Failed to fetch inventory (500)'))
    renderPage()
    await waitFor(() =>
      expect(screen.getByText('Failed to fetch inventory (500)')).toBeInTheDocument(),
    )
  })

  it('shows error message when getSummary rejects', async () => {
    mockGetSummary.mockRejectedValue(new Error('Failed to fetch summary (500)'))
    renderPage()
    await waitFor(() =>
      expect(screen.getByText('Failed to fetch summary (500)')).toBeInTheDocument(),
    )
  })
})

describe('InventoryPage — item list', () => {
  it('renders items with collection color class and status badge', async () => {
    mockListItems.mockResolvedValue([sampleItem])
    mockGetSummary.mockResolvedValue(filledSummary)
    renderPage()
    // Collection type is communicated via CSS class on the tile, not a text label.
    await waitFor(() => {
      const tile = document.querySelector('.inventory-item.item-private')
      expect(tile).toBeInTheDocument()
    })
    expect(screen.getByText('AVAILABLE')).toBeInTheDocument()
    expect(screen.getByText('Media: VG+')).toBeInTheDocument()
  })
})

describe('InventoryPage — acquire flow', () => {
  it('toggles acquire form on button click', async () => {
    renderPage()
    await waitFor(() =>
      expect(screen.getByText('No records yet. Use Add to add one.')).toBeInTheDocument(),
    )
    const user = userEvent.setup()
    await user.click(screen.getByText('+ Add'))
    expect(screen.getByText('Confirm')).toBeInTheDocument()
    await user.click(screen.getByText('Cancel'))
    expect(screen.queryByText('Confirm')).not.toBeInTheDocument()
  })

  it('calls acquireItems and reloads on confirm', async () => {
    renderPage()
    await waitFor(() =>
      expect(screen.getByText('No records yet. Use Add to add one.')).toBeInTheDocument(),
    )
    const user = userEvent.setup()
    await user.click(screen.getByText('+ Add'))
    await user.click(screen.getByText('Confirm'))
    await waitFor(() => expect(mockAcquireItems).toHaveBeenCalledOnce())
    expect(mockListItems).toHaveBeenCalledTimes(2) // initial + reload
  })
})

describe('InventoryPage — filter buttons', () => {
  it('renders All, Private, Public filter buttons', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('All')).toBeInTheDocument())
    expect(screen.getByText('Private')).toBeInTheDocument()
    expect(screen.getByText('Public')).toBeInTheDocument()
  })

  it('calls listItems with filter param on filter change', async () => {
    renderPage()
    await waitFor(() => expect(mockListItems).toHaveBeenCalledWith(undefined))
    const user = userEvent.setup()
    await user.click(screen.getByText('Private'))
    await waitFor(() => expect(mockListItems).toHaveBeenCalledWith('PRIVATE'))
  })
})

describe('InventoryPage — delete flow', () => {
  it('calls deleteItem and reloads when confirm dialog is accepted', async () => {
    mockListItems.mockResolvedValue([sampleItem])
    mockGetSummary.mockResolvedValue(filledSummary)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete item' })).toBeInTheDocument())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Delete item' }))
    await waitFor(() => expect(mockDeleteItem).toHaveBeenCalledWith('item-1'))
    expect(mockListItems).toHaveBeenCalledTimes(2) // initial + reload
    vi.restoreAllMocks()
  })

  it('does not call deleteItem when confirm dialog is cancelled', async () => {
    mockListItems.mockResolvedValue([sampleItem])
    mockGetSummary.mockResolvedValue(filledSummary)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete item' })).toBeInTheDocument())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Delete item' }))
    expect(mockDeleteItem).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})

const sampleDiscogsResult = {
  id: 249504,
  title: 'Never Gonna Give You Up',
  year: '1987',
  country: 'UK',
  resource_url: 'https://api.discogs.com/releases/249504',
  catno: 'RCA PB 9693',
  label: ['RCA'],
}

async function openAcquireForm() {
  renderPage()
  await waitFor(() =>
    expect(screen.getByText('No records yet. Use Add to add one.')).toBeInTheDocument(),
  )
  await userEvent.setup().click(screen.getByText('+ Add'))
}

describe('InventoryPage — Discogs search-and-select', () => {
  it('triggers a Discogs search after the debounce interval elapses', async () => {
    mockSearchDiscogs.mockResolvedValue({
      results: [sampleDiscogsResult],
      pagination: { page: 1, pages: 1, per_page: 50, items: 1, urls: {} },
    })
    await openAcquireForm()
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('Artist, title, label…'), 'Rick')

    // Before debounce fires, no search should have been issued
    expect(mockSearchDiscogs).not.toHaveBeenCalled()

    // After debounce elapses, searchDiscogs is called with the typed query
    await waitFor(() => expect(mockSearchDiscogs).toHaveBeenCalledWith('Rick'), { timeout: 1500 })
  })

  it('selecting a result shows the Selected chip and sends pressing to acquireItems', async () => {
    mockSearchDiscogs.mockResolvedValue({
      results: [sampleDiscogsResult],
      pagination: { page: 1, pages: 1, per_page: 50, items: 1, urls: {} },
    })
    await openAcquireForm()
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('Artist, title, label…'), 'Rick')

    await waitFor(() =>
      expect(screen.getByText('Never Gonna Give You Up')).toBeInTheDocument(),
      { timeout: 1500 },
    )
    await user.click(screen.getByText('Never Gonna Give You Up'))

    expect(screen.getByText(/Selected:/)).toBeInTheDocument()
    expect(screen.getByText(/RCA PB 9693/)).toBeInTheDocument()

    await user.click(screen.getByText('Confirm'))
    await waitFor(() => expect(mockAcquireItems).toHaveBeenCalledOnce())
    const req = mockAcquireItems.mock.calls[0][0]
    expect(req.pressing?.discogs_release_id).toBe(249504)
    expect(req.pressing?.title).toBe('Never Gonna Give You Up')
    expect(req.pressing?.catalog_number).toBe('RCA PB 9693')
    expect(req.pressing?.label).toBe('RCA')
  })

  it('editing the search query after selection removes pressing from the acquire request', async () => {
    mockSearchDiscogs.mockResolvedValue({
      results: [sampleDiscogsResult],
      pagination: { page: 1, pages: 1, per_page: 50, items: 1, urls: {} },
    })
    await openAcquireForm()
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('Artist, title, label…'), 'Rick')

    await waitFor(() =>
      expect(screen.getByText('Never Gonna Give You Up')).toBeInTheDocument(),
      { timeout: 1500 },
    )
    await user.click(screen.getByText('Never Gonna Give You Up'))
    expect(screen.getByText(/Selected:/)).toBeInTheDocument()

    // Clearing the search query should remove the selected pressing
    await user.clear(screen.getByPlaceholderText('Artist, title, label…'))
    expect(screen.queryByText(/Selected:/)).not.toBeInTheDocument()

    await user.click(screen.getByText('Confirm'))
    await waitFor(() => expect(mockAcquireItems).toHaveBeenCalledOnce())
    expect(mockAcquireItems.mock.calls[0][0].pressing).toBeUndefined()
  })

  it('cancelling the acquire form stops any pending debounced search', async () => {
    // searchDiscogs resolves, but since Cancel is clicked before the debounce
    // fires, the search should be cancelled and results should never appear.
    let resolveSearch!: (v: Awaited<ReturnType<typeof discogsApi.searchDiscogs>>) => void
    mockSearchDiscogs.mockReturnValue(
      new Promise(res => { resolveSearch = res })
    )
    await openAcquireForm()
    const user = userEvent.setup()
    // Type into the search box to schedule a debounced search
    await user.type(screen.getByPlaceholderText('Artist, title, label…'), 'Rick')
    // Cancel the form before the debounce fires (debounce is 400ms; act is immediate)
    await user.click(screen.getByText('Cancel'))
    // Resolve the deferred search after the form is closed
    resolveSearch({
      results: [sampleDiscogsResult],
      pagination: { page: 1, pages: 1, per_page: 50, items: 1, urls: {} },
    })
    // The search results list should never appear because reset invalidated the request
    expect(screen.queryByText('Never Gonna Give You Up')).not.toBeInTheDocument()
  })

  it('populates matrix on the acquire request when getDiscogsRelease resolves with identifiers', async () => {
    mockSearchDiscogs.mockResolvedValue({
      results: [sampleDiscogsResult],
      pagination: { page: 1, pages: 1, per_page: 50, items: 1, urls: {} },
    })
    // Use a deferred promise so we control exactly when the release fetch resolves.
    let resolveRelease!: (v: Awaited<ReturnType<typeof discogsApi.getDiscogsRelease>>) => void
    mockGetDiscogsRelease.mockReturnValue(
      new Promise(res => { resolveRelease = res }),
    )
    await openAcquireForm()
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('Artist, title, label…'), 'Rick')
    await waitFor(() =>
      expect(screen.getByText('Never Gonna Give You Up')).toBeInTheDocument(),
      { timeout: 1500 },
    )
    await user.click(screen.getByText('Never Gonna Give You Up'))

    // Resolve the fetch inside act() so React flushes the setAcquireForm state
    // update before the Confirm click — prevents a race where matrix is still null.
    await act(async () => {
      resolveRelease({
        id: 249504,
        title: 'Never Gonna Give You Up',
        identifiers: [
          { type: 'Matrix / Runout', value: 'YEX 773-1 HAGG', description: 'Side A' },
          { type: 'Matrix / Runout', value: 'YEX 774-1 HAGG', description: 'Side B' },
          { type: 'Barcode', value: '5 099746 350529' },
        ],
      })
    })

    await user.click(screen.getByText('Confirm'))
    await waitFor(() => expect(mockAcquireItems).toHaveBeenCalledOnce())
    const req = mockAcquireItems.mock.calls[0][0]
    expect(req.pressing?.matrix).toBe('YEX 773-1 HAGG / YEX 774-1 HAGG')
  })

  it('populates label on the acquire request when getDiscogsRelease resolves with labels', async () => {
    mockSearchDiscogs.mockResolvedValue({
      results: [{ ...sampleDiscogsResult, label: undefined }],
      pagination: { page: 1, pages: 1, per_page: 50, items: 1, urls: {} },
    })
    let resolveRelease!: (v: Awaited<ReturnType<typeof discogsApi.getDiscogsRelease>>) => void
    mockGetDiscogsRelease.mockReturnValue(
      new Promise(res => { resolveRelease = res }),
    )
    await openAcquireForm()
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('Artist, title, label\u2026'), 'Rick')
    await waitFor(() =>
      expect(screen.getByText('Never Gonna Give You Up')).toBeInTheDocument(),
      { timeout: 1500 },
    )
    await user.click(screen.getByText('Never Gonna Give You Up'))
    await act(async () => {
      resolveRelease({
        id: 249504,
        title: 'Never Gonna Give You Up',
        identifiers: [],
        labels: [{ name: 'Parlophone' }],
      })
    })
    await user.click(screen.getByText('Confirm'))
    await waitFor(() => expect(mockAcquireItems).toHaveBeenCalledOnce())
    const req = mockAcquireItems.mock.calls[0][0]
    expect(req.pressing?.label).toBe('Parlophone')
  })

  it('acquire proceeds with matrix null when getDiscogsRelease rejects', async () => {
    mockSearchDiscogs.mockResolvedValue({
      results: [sampleDiscogsResult],
      pagination: { page: 1, pages: 1, per_page: 50, items: 1, urls: {} },
    })
    mockGetDiscogsRelease.mockRejectedValue(new Error('network error'))
    await openAcquireForm()
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('Artist, title, label…'), 'Rick')
    await waitFor(() =>
      expect(screen.getByText('Never Gonna Give You Up')).toBeInTheDocument(),
      { timeout: 1500 },
    )
    await user.click(screen.getByText('Never Gonna Give You Up'))

    await user.click(screen.getByText('Confirm'))
    await waitFor(() => expect(mockAcquireItems).toHaveBeenCalledOnce())
    const req = mockAcquireItems.mock.calls[0][0]
    expect(req.pressing?.matrix).toBeNull()
  })
})

describe('InventoryPage — edit flow', () => {
  it('renders an Edit button per item for admin users', async () => {
    mockListItems.mockResolvedValue([sampleItem])
    mockGetSummary.mockResolvedValue(filledSummary)
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit item' })).toBeInTheDocument())
  })

  it('clicking Edit opens the edit panel', async () => {
    mockListItems.mockResolvedValue([sampleItem])
    mockGetSummary.mockResolvedValue(filledSummary)
    renderPage()
    await waitFor(() => screen.getByRole('button', { name: 'Edit item' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Edit item' }))
    expect(screen.getByPlaceholderText('Search Discogs to change pressing…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('edit panel pre-populates condition fields from the item', async () => {
    mockListItems.mockResolvedValue([sampleItem])
    mockGetSummary.mockResolvedValue(filledSummary)
    renderPage()
    await waitFor(() => screen.getByRole('button', { name: 'Edit item' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Edit item' }))
    const mediaInput = screen.getByDisplayValue('VG+')
    expect(mediaInput).toBeInTheDocument()
  })

  it('Cancel in edit panel closes the panel', async () => {
    mockListItems.mockResolvedValue([sampleItem])
    mockGetSummary.mockResolvedValue(filledSummary)
    renderPage()
    await waitFor(() => screen.getByRole('button', { name: 'Edit item' }))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit item' }))
    expect(screen.getByPlaceholderText('Search Discogs to change pressing…')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByPlaceholderText('Search Discogs to change pressing…')).not.toBeInTheDocument()
  })

  it('Save calls updateItem and updates the item in the list', async () => {
    const updatedItem = { ...sampleItem, condition_media: 'NM' }
    mockUpdateItem.mockResolvedValue(updatedItem)
    mockListItems.mockResolvedValue([sampleItem])
    mockGetSummary.mockResolvedValue(filledSummary)
    renderPage()
    await waitFor(() => screen.getByRole('button', { name: 'Edit item' }))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit item' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockUpdateItem).toHaveBeenCalledWith('item-1', expect.any(Object)))
    // Panel closes after save
    expect(screen.queryByPlaceholderText('Search Discogs to change pressing…')).not.toBeInTheDocument()
    // Updated value is rendered in the list without a full reload
    expect(screen.getByText('Media: NM')).toBeInTheDocument()
    expect(mockListItems).toHaveBeenCalledTimes(1) // no reload — in-place update only
  })

  it('changing the filter clears the active edit panel', async () => {
    mockListItems.mockResolvedValue([sampleItem])
    mockGetSummary.mockResolvedValue(filledSummary)
    renderPage()
    await waitFor(() => screen.getByRole('button', { name: 'Edit item' }))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit item' }))
    expect(screen.getByPlaceholderText('Search Discogs to change pressing…')).toBeInTheDocument()
    // Switch to Public filter — panel should close
    await user.click(screen.getByText('Public'))
    expect(screen.queryByPlaceholderText('Search Discogs to change pressing…')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Fixtures for search tests
// ---------------------------------------------------------------------------
const pressingRick = {
  id: 'pressing-rick',
  discogs_release_id: 249504,
  discogs_resource_url: null,
  title: 'Never Gonna Give You Up',
  artists_sort: 'Astley, Rick',
  year: 1987,
  country: 'UK',
  catalog_number: 'RCA PB 9693',
  matrix: null,
  label: 'RCA',
}

const pressingNew = {
  id: 'pressing-new',
  discogs_release_id: 12345,
  discogs_resource_url: null,
  title: 'Blue Monday',
  artists_sort: 'New Order',
  year: 1983,
  country: 'UK',
  catalog_number: 'FAC 73',
  matrix: null,
  label: null,
}

const itemRick = { ...sampleItem, id: 'item-rick', pressing_id: 'pressing-rick', pressing: pressingRick }
const itemNew = { ...sampleItem, id: 'item-new', pressing_id: 'pressing-new', pressing: pressingNew, collection_type: 'PUBLIC' as const }

describe('InventoryPage — text search', () => {
  it('renders the search input', async () => {
    renderPage()
    await waitFor(() => screen.getByRole('searchbox', { name: 'Search inventory' }))
    const input = screen.getByRole('searchbox', { name: 'Search inventory' })
    expect(input).toHaveAttribute('placeholder', 'Search title, artist, catalog…')
  })

  it('filters items by pressing title', async () => {
    mockListItems.mockResolvedValue([itemRick, itemNew])
    mockGetSummary.mockResolvedValue(filledSummary)
    renderPage()
    await waitFor(() => screen.getByText(/Never Gonna Give You Up/))
    const user = userEvent.setup()
    await user.type(screen.getByRole('searchbox', { name: 'Search inventory' }), 'Never')
    // Wait for Blue Monday to be filtered out (proves debounce fired)
    await waitFor(() => expect(screen.queryByText(/Blue Monday/)).not.toBeInTheDocument(), { timeout: 2000 })
    expect(screen.getByText(/Never Gonna Give You Up/)).toBeInTheDocument()
  })

  it('filters items by artists_sort', async () => {
    mockListItems.mockResolvedValue([itemRick, itemNew])
    mockGetSummary.mockResolvedValue(filledSummary)
    renderPage()
    await waitFor(() => screen.getByText(/Astley, Rick/))
    const user = userEvent.setup()
    await user.type(screen.getByRole('searchbox', { name: 'Search inventory' }), 'Astley')
    // Wait for New Order to be filtered out (proves debounce fired)
    await waitFor(() => expect(screen.queryByText(/New Order/)).not.toBeInTheDocument(), { timeout: 2000 })
    expect(screen.getByText(/Astley, Rick/)).toBeInTheDocument()
  })

  it('shows no-results message when query matches nothing', async () => {
    mockListItems.mockResolvedValue([itemRick])
    mockGetSummary.mockResolvedValue(filledSummary)
    renderPage()
    await waitFor(() => screen.getByText(/Never Gonna Give You Up/))
    const user = userEvent.setup()
    await user.type(screen.getByRole('searchbox', { name: 'Search inventory' }), 'zzz')
    await waitFor(() => expect(screen.getByText('No results for "zzz".')).toBeInTheDocument(), { timeout: 2000 })
  })

  it('composes search filter with collection filter', async () => {
    // ALL (no arg) returns both items; PRIVATE returns only itemRick.
    // This verifies composition: collection filter narrows the server-side list,
    // then text search further filters the client-side result.
    mockListItems.mockImplementation((collection?: string) =>
      Promise.resolve(collection === 'PRIVATE' ? [itemRick] : [itemRick, itemNew]),
    )
    mockGetSummary.mockResolvedValue(filledSummary)
    renderPage()
    // Initial ALL load — both items visible
    await waitFor(() => {
      expect(screen.getByText(/Never Gonna Give You Up/)).toBeInTheDocument()
      expect(screen.getByText(/Blue Monday/)).toBeInTheDocument()
    })
    const user = userEvent.setup()
    // Switch to Private — server returns only PRIVATE items; itemNew disappears
    await user.click(screen.getByText('Private'))
    await waitFor(() => expect(screen.queryByText(/Blue Monday/)).not.toBeInTheDocument())
    await waitFor(() => screen.getByText(/Never Gonna Give You Up/))
    // Text search within the already-filtered list
    await user.type(screen.getByRole('searchbox', { name: 'Search inventory' }), 'Never')
    await waitFor(() => expect(screen.getByText(/Never Gonna Give You Up/)).toBeInTheDocument(), { timeout: 2000 })
    // itemNew must still be absent — it was excluded by the collection filter, not just the text filter
    expect(screen.queryByText(/Blue Monday/)).not.toBeInTheDocument()
  })

  it('clearing search restores full list', async () => {
    mockListItems.mockResolvedValue([itemRick, itemNew])
    mockGetSummary.mockResolvedValue(filledSummary)
    renderPage()
    await waitFor(() => screen.getByText(/Never Gonna Give You Up/))
    const user = userEvent.setup()
    const input = screen.getByRole('searchbox', { name: 'Search inventory' })
    await user.type(input, 'Never')
    await waitFor(() => expect(screen.queryByText(/Blue Monday/)).not.toBeInTheDocument(), { timeout: 2000 })
    await user.clear(input)
    await waitFor(() => expect(screen.getByText(/Blue Monday/)).toBeInTheDocument(), { timeout: 2000 })
    expect(screen.getByText(/Never Gonna Give You Up/)).toBeInTheDocument()
  })

  it('closes an open detail panel when its item is filtered out and does not re-open on clear', async () => {
    mockListItems.mockResolvedValue([itemRick, itemNew])
    mockGetSummary.mockResolvedValue(filledSummary)
    renderPage()
    await waitFor(() => screen.getByText(/Never Gonna Give You Up/))
    const user = userEvent.setup()
    // Open the detail panel for Rick by clicking his row
    const rickRow = screen.getAllByRole('button', { name: /PRIVATE|AVAILABLE/ }).find(el =>
      el.closest('li')?.textContent?.includes('Never Gonna Give You Up'),
    ) ?? screen.getByText(/Never Gonna Give You Up/).closest('[role="button"]')!
    await user.click(rickRow as HTMLElement)
    // Panel should be open — ItemDetailPanel renders a close button
    await waitFor(() => expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument(), { timeout: 2000 })
    // Type a query that excludes Rick
    await user.type(screen.getByRole('searchbox', { name: 'Search inventory' }), 'Blue')
    // Rick's row and panel disappear; close button gone
    await waitFor(() => expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument(), { timeout: 2000 })
    // Clearing the search restores Rick but the panel must NOT re-open
    await user.clear(screen.getByRole('searchbox', { name: 'Search inventory' }))
    await waitFor(() => screen.getByText(/Never Gonna Give You Up/), { timeout: 2000 })
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument()
  })
})

describe('InventoryPage — item detail panel Discogs data', () => {
  it('renders record label from Discogs release payload', async () => {
    const itemWithPressing = {
      ...sampleItem,
      id: 'item-label-test',
      pressing_id: 'pressing-rick',
      pressing: {
        ...pressingRick,
        id: 'pressing-rick',
        discogs_resource_url: null,
        matrix: null,
      },
    }
    mockListItems.mockResolvedValue([itemWithPressing])
    mockGetSummary.mockResolvedValue(filledSummary)
    mockGetDiscogsRelease.mockResolvedValue({
      id: 249504,
      title: 'Never Gonna Give You Up',
      identifiers: [],
      labels: [{ name: 'RCA' }],
    })
    renderPage()
    await waitFor(() => screen.getByText(/Never Gonna Give You Up/))
    const user = userEvent.setup()
    // Open detail panel by clicking the item row
    await user.click(screen.getByText(/Never Gonna Give You Up/).closest('[role="button"]')!)
    // Wait for the Discogs data section and assert label is rendered
    await waitFor(() => expect(screen.getByText('RCA')).toBeInTheDocument())
    expect(screen.getByText('Label')).toBeInTheDocument()
  })

  it('renders pressing label in the inventory list row when label is set', async () => {
    const itemWithLabel = {
      ...sampleItem,
      id: 'item-label-row',
      pressing_id: 'pressing-rick',
      pressing: { ...pressingRick, label: 'RCA' },
    }
    mockListItems.mockResolvedValue([itemWithLabel])
    mockGetSummary.mockResolvedValue(filledSummary)
    renderPage()
    await waitFor(() => screen.getByText(/Never Gonna Give You Up/))
    expect(screen.getByText(/RCA/)).toBeInTheDocument()
  })
})
