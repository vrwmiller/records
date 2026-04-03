import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InventoryPage } from './InventoryPage'

// Mock the entire api/inventory module
vi.mock('../api/inventory', () => ({
  listItems: vi.fn(),
  getSummary: vi.fn(),
  acquireItems: vi.fn(),
  deleteItem: vi.fn(),
}))

import * as inventoryApi from '../api/inventory'

const mockListItems = vi.mocked(inventoryApi.listItems)
const mockGetSummary = vi.mocked(inventoryApi.getSummary)
const mockAcquireItems = vi.mocked(inventoryApi.acquireItems)
const mockDeleteItem = vi.mocked(inventoryApi.deleteItem)

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
