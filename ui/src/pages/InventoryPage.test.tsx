import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
}))

import * as inventoryApi from '../api/inventory'
import * as discogsApi from '../api/discogs'

const mockSearchDiscogs = vi.mocked(discogsApi.searchDiscogs)
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

const emptySummary = { personal: 0, distribution: 0, total: 0 }
const filledSummary = { personal: 1, distribution: 2, total: 3 }

const sampleItem = {
  id: 'item-1',
  pressing_id: null,
  pressing: null,
  acquisition_batch_id: null,
  collection_type: 'PERSONAL' as const,
  condition_media: 'VG+',
  condition_sleeve: null,
  status: 'AVAILABLE',
  notes: null,
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
})

function renderPage() {
  return render(<InventoryPage user={mockUser} signOut={mockSignOut} />)
}

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
      expect(screen.getByText('No records yet. Use Acquire to add one.')).toBeInTheDocument(),
    )
  })

  it('renders summary counts', async () => {
    mockGetSummary.mockResolvedValue(filledSummary)
    renderPage()
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument()) // total
    expect(screen.getByText('1')).toBeInTheDocument() // personal
    expect(screen.getByText('2')).toBeInTheDocument() // distribution
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
  it('renders items with collection and status badges', async () => {
    mockListItems.mockResolvedValue([sampleItem])
    mockGetSummary.mockResolvedValue(filledSummary)
    renderPage()
    await waitFor(() => expect(screen.getByText('PERSONAL')).toBeInTheDocument())
    expect(screen.getByText('AVAILABLE')).toBeInTheDocument()
    expect(screen.getByText('Media: VG+')).toBeInTheDocument()
  })
})

describe('InventoryPage — acquire flow', () => {
  it('toggles acquire form on button click', async () => {
    renderPage()
    await waitFor(() =>
      expect(screen.getByText('No records yet. Use Acquire to add one.')).toBeInTheDocument(),
    )
    const user = userEvent.setup()
    await user.click(screen.getByText('+ Acquire'))
    expect(screen.getByText('Confirm')).toBeInTheDocument()
    await user.click(screen.getByText('Cancel'))
    expect(screen.queryByText('Confirm')).not.toBeInTheDocument()
  })

  it('calls acquireItems and reloads on confirm', async () => {
    renderPage()
    await waitFor(() =>
      expect(screen.getByText('No records yet. Use Acquire to add one.')).toBeInTheDocument(),
    )
    const user = userEvent.setup()
    await user.click(screen.getByText('+ Acquire'))
    await user.click(screen.getByText('Confirm'))
    await waitFor(() => expect(mockAcquireItems).toHaveBeenCalledOnce())
    expect(mockListItems).toHaveBeenCalledTimes(2) // initial + reload
  })
})

describe('InventoryPage — filter buttons', () => {
  it('renders All, Personal, Distribution filter buttons', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('All')).toBeInTheDocument())
    expect(screen.getByText('Personal')).toBeInTheDocument()
    expect(screen.getByText('Distribution')).toBeInTheDocument()
  })

  it('calls listItems with filter param on filter change', async () => {
    renderPage()
    await waitFor(() => expect(mockListItems).toHaveBeenCalledWith(undefined))
    const user = userEvent.setup()
    await user.click(screen.getByText('Personal'))
    await waitFor(() => expect(mockListItems).toHaveBeenCalledWith('PERSONAL'))
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
}

async function openAcquireForm() {
  renderPage()
  await waitFor(() =>
    expect(screen.getByText('No records yet. Use Acquire to add one.')).toBeInTheDocument(),
  )
  await userEvent.setup().click(screen.getByText('+ Acquire'))
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

    await user.click(screen.getByText('Confirm'))
    await waitFor(() => expect(mockAcquireItems).toHaveBeenCalledOnce())
    const req = mockAcquireItems.mock.calls[0][0]
    expect(req.pressing?.discogs_release_id).toBe(249504)
    expect(req.pressing?.title).toBe('Never Gonna Give You Up')
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
})
