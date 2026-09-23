import { describe, it, expect, vi, beforeEach } from 'vitest'
import axios from 'axios'
import type { Account, Connection } from '../config/schema'
import * as truelayer from '../truelayer/truelayer'
import type { TrueLayerAccount, TrueLayerCard } from '../truelayer/types'
import { fetchAccountMap } from './accounts'

vi.mock('axios')
vi.mock('../truelayer/truelayer')
vi.mock('../utils/logger')

const baseConnection: Connection = {
  name: 'My Bank',
  documentId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  accounts: [{ trueLayerId: 'acc-1', actualId: 'a-1', friendlyName: 'Current Account' }],
}

const cardAccount: Account = {
  trueLayerId: 'card-1',
  actualId: 'a-2',
  friendlyName: 'Credit Card',
  isCard: true,
}

const mockAccount: TrueLayerAccount = {
  account_id: 'acc-1',
  account_type: 'TRANSACTION',
  currency: 'GBP',
  display_name: 'Current Account',
  update_timestamp: '2026-04-24T00:00:00Z',
  account_number: {},
  provider: { provider_id: 'first-direct' },
}

const mockCard: TrueLayerCard = {
  account_id: 'card-1',
  card_network: 'VISA',
  card_type: 'CREDIT',
  currency: 'GBP',
  display_name: 'Credit Card',
  partial_card_number: '1234',
  name_on_card: 'Chris Sheppard',
  update_timestamp: '2026-04-24T00:00:00Z',
  provider: { provider_id: 'ms' },
}

describe('fetchAccountMap', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists accounts for a group of non-card accounts', async () => {
    vi.mocked(truelayer.listAccounts).mockResolvedValueOnce([mockAccount])
    const result = await fetchAccountMap(baseConnection, 'token', baseConnection.accounts)
    expect(result.get('acc-1')).toEqual(mockAccount)
    expect(truelayer.listAccounts).toHaveBeenCalledWith('token')
    expect(truelayer.listCards).not.toHaveBeenCalled()
  })

  it('lists cards for a group of card accounts (endpoint chosen per-account, not per-connection)', async () => {
    vi.mocked(truelayer.listCards).mockResolvedValueOnce([mockCard])
    const cardConnection: Connection = {
      name: 'CK',
      documentId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      accounts: [cardAccount],
    }
    const result = await fetchAccountMap(cardConnection, 'token', [cardAccount])
    expect(result.get('card-1')).toEqual(mockCard)
    expect(truelayer.listCards).toHaveBeenCalledWith('token')
    expect(truelayer.listAccounts).not.toHaveBeenCalled()
  })

  it('lists both accounts and cards when a group mixes card and non-card accounts', async () => {
    vi.mocked(truelayer.listAccounts).mockResolvedValueOnce([mockAccount])
    vi.mocked(truelayer.listCards).mockResolvedValueOnce([mockCard])
    const mixedConnection: Connection = {
      name: 'Mixed',
      documentId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      accounts: [baseConnection.accounts[0], cardAccount],
    }
    const result = await fetchAccountMap(mixedConnection, 'token', mixedConnection.accounts)
    expect(result.get('acc-1')).toEqual(mockAccount)
    expect(result.get('card-1')).toEqual(mockCard)
    expect(truelayer.listAccounts).toHaveBeenCalledWith('token')
    expect(truelayer.listCards).toHaveBeenCalledWith('token')
  })

  it('returns an empty map (non-fatal) when listing is endpoint_not_supported', async () => {
    const axiosError = Object.assign(new Error('Not supported'), {
      isAxiosError: true,
      response: { data: { error: 'endpoint_not_supported' } },
    })
    vi.mocked(truelayer.listAccounts).mockRejectedValueOnce(axiosError)
    vi.mocked(axios.isAxiosError).mockReturnValue(true)
    const result = await fetchAccountMap(baseConnection, 'token', baseConnection.accounts)
    expect(result.size).toBe(0)
  })

  it('returns an empty map (non-fatal) for other listing errors instead of throwing', async () => {
    const axiosError = Object.assign(new Error('Server error'), {
      isAxiosError: true,
      response: { data: { error: 'internal_server_error' } },
    })
    vi.mocked(truelayer.listAccounts).mockRejectedValueOnce(axiosError)
    vi.mocked(axios.isAxiosError).mockReturnValue(true)
    const result = await fetchAccountMap(baseConnection, 'token', baseConnection.accounts)
    expect(result.size).toBe(0)
  })

  it('still returns the accounts that were listed when the card listing fails', async () => {
    vi.mocked(truelayer.listAccounts).mockResolvedValueOnce([mockAccount])
    vi.mocked(truelayer.listCards).mockRejectedValueOnce(new Error('card listing blew up'))
    const mixedConnection: Connection = {
      name: 'Mixed',
      documentId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      accounts: [baseConnection.accounts[0], cardAccount],
    }
    const result = await fetchAccountMap(mixedConnection, 'token', mixedConnection.accounts)
    expect(result.get('acc-1')).toEqual(mockAccount)
    expect(result.has('card-1')).toBe(false)
  })

  it('includes unmatched accounts (not in config) in the map', async () => {
    const unmatchedAccount: TrueLayerAccount = { ...mockAccount, account_id: 'acc-unmatched', display_name: 'Savings' }
    vi.mocked(truelayer.listAccounts).mockResolvedValueOnce([mockAccount, unmatchedAccount])
    const result = await fetchAccountMap(baseConnection, 'token', baseConnection.accounts)
    expect(result.size).toBe(2)
    expect(result.get('acc-unmatched')).toEqual(unmatchedAccount)
  })
})
