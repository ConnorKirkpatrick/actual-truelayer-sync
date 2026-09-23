import { describe, it, expect, vi, beforeEach } from 'vitest'
import axios from 'axios'
import type { Connection, Config } from '../config/schema'
import * as truelayer from '../truelayer/truelayer'
import * as accounts from './accounts'
import * as account from './account'
import { syncConnection } from './connection'

vi.mock('axios')
vi.mock('../utils/logger')
vi.mock('../truelayer/truelayer')
vi.mock('./accounts')
vi.mock('./account')

const baseConnection: Connection = {
  name: 'My Bank',
  documentId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  accounts: [{ trueLayerId: 'acc-1', actualId: 'a-1', friendlyName: 'Current Account' }],
}

const baseConfig: Config = {
  version: 3,
  includeCategoryInNotes: false,
  lookbackDays: 14,
  connections: [baseConnection],
  env: {
    TRUELAYER_CLIENT_ID: 'client-id',
    TRUELAYER_CLIENT_SECRET: 'client-secret',
    ACTUAL_SERVER_URL: 'http://localhost:5006',
    ACTUAL_SERVER_PASSWORD: 'password',
    LOG_FORMAT: 'json',
  },
  state: {
    connections: {
      'My Bank': {
        accounts: {
          'acc-1': { refreshToken: 'old-refresh-token' },
        },
      },
    },
  },
}

describe('syncConnection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stores the new refresh token on the account', async () => {
    vi.mocked(truelayer.refreshToken).mockResolvedValueOnce({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
    })
    vi.mocked(accounts.fetchAccountMap).mockResolvedValueOnce(new Map())
    vi.mocked(account.syncAccount).mockResolvedValueOnce(false)

    const result = await syncConnection(baseConnection, baseConfig)

    expect(result?.accounts['acc-1']?.refreshToken).toBe('new-refresh')
  })

  it('calls fetchAccountMap with the connection and access token', async () => {
    vi.mocked(truelayer.refreshToken).mockResolvedValueOnce({
      access_token: 'new-access',
      refresh_token: 'old-refresh-token',
    })
    vi.mocked(accounts.fetchAccountMap).mockResolvedValueOnce(new Map())
    vi.mocked(account.syncAccount).mockResolvedValueOnce(false)

    await syncConnection(baseConnection, baseConfig)

    expect(accounts.fetchAccountMap).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Bank' }),
      'new-access',
      expect.arrayContaining([expect.objectContaining({ trueLayerId: 'acc-1' })]),
    )
  })

  it('calls syncAccount for each account in the connection', async () => {
    vi.mocked(truelayer.refreshToken).mockResolvedValueOnce({
      access_token: 'new-access',
      refresh_token: 'old-refresh-token',
    })
    vi.mocked(accounts.fetchAccountMap).mockResolvedValueOnce(new Map())
    vi.mocked(account.syncAccount).mockResolvedValueOnce(false)

    await syncConnection(baseConnection, baseConfig)

    expect(account.syncAccount).toHaveBeenCalledTimes(1)
    expect(account.syncAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        configAccount: expect.objectContaining({ trueLayerId: 'acc-1' }),
        accessToken: 'new-access',
        includeCategoryInNotes: false,
        lookbackDays: 14,
        lastSyncDate: undefined,
        dryRun: false,
      }),
    )
  })

  it('passes lastSyncDate from state to syncAccount', async () => {
    const configWithState: Config = {
      ...baseConfig,
      state: {
        connections: {
          'My Bank': {
            accounts: { 'acc-1': { refreshToken: 'old-refresh-token', lastSyncDate: '2026-04-24' } },
          },
        },
      },
    }
    vi.mocked(truelayer.refreshToken).mockResolvedValueOnce({
      access_token: 'new-access',
      refresh_token: 'old-refresh-token',
    })
    vi.mocked(accounts.fetchAccountMap).mockResolvedValueOnce(new Map())
    vi.mocked(account.syncAccount).mockResolvedValueOnce(false)

    await syncConnection(baseConnection, configWithState)

    expect(account.syncAccount).toHaveBeenCalledWith(
      expect.objectContaining({ lastSyncDate: '2026-04-24' }),
    )
  })

  it('returns updated accounts with lastSyncDate when syncAccount returns true', async () => {
    vi.mocked(truelayer.refreshToken).mockResolvedValueOnce({
      access_token: 'new-access',
      refresh_token: 'old-refresh-token',
    })
    vi.mocked(accounts.fetchAccountMap).mockResolvedValueOnce(new Map())
    vi.mocked(account.syncAccount).mockResolvedValueOnce(true)

    const result = await syncConnection(baseConnection, baseConfig)

    expect(result?.accounts['acc-1']?.lastSyncDate).toBe(new Date().toISOString().slice(0, 10))
  })

  it('keeps the account (with its token) but no lastSyncDate when syncAccount returns false', async () => {
    vi.mocked(truelayer.refreshToken).mockResolvedValueOnce({
      access_token: 'new-access',
      refresh_token: 'old-refresh-token',
    })
    vi.mocked(accounts.fetchAccountMap).mockResolvedValueOnce(new Map())
    vi.mocked(account.syncAccount).mockResolvedValueOnce(false)

    const result = await syncConnection(baseConnection, baseConfig)

    expect(result?.accounts['acc-1']).toEqual({ refreshToken: 'old-refresh-token' })
  })

  it('returns undefined when authentication fails', async () => {
    const axiosError = Object.assign(new Error('Unauthorized'), {
      isAxiosError: true,
      response: { data: { error: 'invalid_client' } },
    })
    vi.mocked(truelayer.refreshToken).mockRejectedValueOnce(axiosError)
    vi.mocked(axios.isAxiosError).mockReturnValueOnce(true)

    const result = await syncConnection(baseConnection, baseConfig)

    expect(result).toBeUndefined()
    expect(accounts.fetchAccountMap).not.toHaveBeenCalled()
  })

  it('returns undefined when authentication fails with a generic error', async () => {
    vi.mocked(truelayer.refreshToken).mockRejectedValueOnce(new Error('Network failure'))
    vi.mocked(axios.isAxiosError).mockReturnValueOnce(false)

    const result = await syncConnection(baseConnection, baseConfig)

    expect(result).toBeUndefined()
  })

  it('still syncs accounts (and preserves the rotated token) when the metadata map is empty', async () => {
    vi.mocked(truelayer.refreshToken).mockResolvedValueOnce({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
    })
    vi.mocked(accounts.fetchAccountMap).mockResolvedValueOnce(new Map())
    vi.mocked(account.syncAccount).mockResolvedValueOnce(false)

    const result = await syncConnection(baseConnection, baseConfig)

    expect(account.syncAccount).toHaveBeenCalledTimes(1)
    expect(result?.accounts['acc-1']?.refreshToken).toBe('new-refresh')
    expect(result?.accounts['acc-1']?.lastSyncDate).toBeUndefined()
  })

  it('returns undefined when no state entry exists for the connection', async () => {
    const configWithNoState: Config = { ...baseConfig, state: { connections: {} } }

    const result = await syncConnection(baseConnection, configWithNoState)

    expect(result).toBeUndefined()
    expect(truelayer.refreshToken).not.toHaveBeenCalled()
  })

  it('passes dryRun flag through to syncAccount', async () => {
    vi.mocked(truelayer.refreshToken).mockResolvedValueOnce({
      access_token: 'new-access',
      refresh_token: 'old-refresh-token',
    })
    vi.mocked(accounts.fetchAccountMap).mockResolvedValueOnce(new Map())
    vi.mocked(account.syncAccount).mockResolvedValueOnce(false)

    await syncConnection(baseConnection, baseConfig, true)

    expect(account.syncAccount).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }))
  })

  describe('per-account refresh tokens (multiple authorizations in one connection)', () => {
    const multiConnection: Connection = {
      name: 'CK',
      documentId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      accounts: [
        { trueLayerId: 'gen-1', actualId: 'a-1', friendlyName: 'GEN' },
        { trueLayerId: 'card-1', actualId: 'a-2', friendlyName: 'MC Card', isCard: true },
      ],
    }

    const multiConfig: Config = {
      ...baseConfig,
      connections: [multiConnection],
      state: {
        connections: {
          CK: {
            accounts: {
              'gen-1': { refreshToken: 'token-A' },
              'card-1': { refreshToken: 'token-B' },
            },
          },
        },
      },
    }

    it('exchanges each distinct token exactly once', async () => {
      vi.mocked(truelayer.refreshToken)
        .mockResolvedValueOnce({ access_token: 'access-A', refresh_token: 'token-A' })
        .mockResolvedValueOnce({ access_token: 'access-B', refresh_token: 'token-B' })
      vi.mocked(accounts.fetchAccountMap).mockResolvedValue(new Map())
      vi.mocked(account.syncAccount).mockResolvedValue(false)

      await syncConnection(multiConnection, multiConfig)

      // One exchange per distinct token, even though there are two accounts.
      expect(truelayer.refreshToken).toHaveBeenCalledTimes(2)
      expect(truelayer.refreshToken).toHaveBeenCalledWith('client-id', 'client-secret', 'token-A')
      expect(truelayer.refreshToken).toHaveBeenCalledWith('client-id', 'client-secret', 'token-B')
    })

    it('syncs each account under its own access token', async () => {
      vi.mocked(truelayer.refreshToken)
        .mockResolvedValueOnce({ access_token: 'access-A', refresh_token: 'token-A' })
        .mockResolvedValueOnce({ access_token: 'access-B', refresh_token: 'token-B' })
      vi.mocked(accounts.fetchAccountMap).mockResolvedValue(new Map())
      vi.mocked(account.syncAccount).mockResolvedValue(false)

      await syncConnection(multiConnection, multiConfig)

      const calls = vi.mocked(account.syncAccount).mock.calls
      const forGen = calls.find((c) => c[0].configAccount.trueLayerId === 'gen-1')
      const forCard = calls.find((c) => c[0].configAccount.trueLayerId === 'card-1')
      expect(forGen?.[0].accessToken).toBe('access-A')
      expect(forCard?.[0].accessToken).toBe('access-B')
    })

    it('still syncs the other group when one authorization fails', async () => {
      vi.mocked(truelayer.refreshToken)
        .mockRejectedValueOnce(new Error('bad token A'))
        .mockResolvedValueOnce({ access_token: 'access-B', refresh_token: 'token-B' })
      vi.mocked(accounts.fetchAccountMap).mockResolvedValue(new Map())
      vi.mocked(account.syncAccount).mockResolvedValue(false)

      const result = await syncConnection(multiConnection, multiConfig)

      // group A failed; group B still synced and kept its token
      expect(result?.accounts['card-1']?.refreshToken).toBe('token-B')
      // group A keeps its (unrotated) token
      expect(result?.accounts['gen-1']?.refreshToken).toBe('token-A')
    })
  })
})
