import { refreshToken } from '../truelayer/truelayer'
import { syncAccount } from './account'
import { fetchAccountMap } from './accounts'
import { currentDate } from '../utils/date'
import { log, logError } from '../utils/logger'
import { getConnectionState, getAccountLastSyncDate } from '../config/state'
import type { AccountState, Connection, Config, ConnectionState } from '../config/schema'

export async function syncConnection(
  connection: Connection,
  config: Config,
  dryRun = false,
): Promise<ConnectionState | undefined> {
  const connectionState = getConnectionState(config.state, connection.name)
  if (!connectionState) {
    logError([connection.name], 'No state entry — skipping. Add this connection to state.json.')
    return undefined
  }

  const startedAt = Date.now()
  const prefix = [connection.name]

  // Group this connection's accounts by their refresh token. Each TrueLayer
  // authorization (distinct token) is exchanged once and its account list fetched
  // once; several accounts can share a token (same bank login), or a connection can
  // span several tokens (e.g. a card + a bank account in one Actual document).
  const groups = new Map<string, Connection['accounts']>()
  for (const configAccount of connection.accounts) {
    const accountState = connectionState.accounts[configAccount.trueLayerId]
    if (!accountState?.refreshToken) {
      logError(prefix, `No refresh token in state for "${configAccount.friendlyName}" — skipping this account.`)
      continue
    }
    const list = groups.get(accountState.refreshToken) ?? []
    list.push(configAccount)
    groups.set(accountState.refreshToken, list)
  }

  if (groups.size === 0) {
    logError(prefix, 'No usable refresh tokens in state — skipping connection.')
    return undefined
  }

  const updatedAccounts: Record<string, AccountState> = { ...connectionState.accounts }
  let anyTokenChanged = false
  let anyAuthenticated = false

  for (const [oldToken, groupAccounts] of groups) {
    const names = groupAccounts.map((a) => a.friendlyName).join(', ')

    let accessToken: string
    let newToken: string
    try {
      const res = await refreshToken(config.env.TRUELAYER_CLIENT_ID, config.env.TRUELAYER_CLIENT_SECRET, oldToken)
      accessToken = res.access_token
      newToken = res.refresh_token
    } catch (err) {
      logError(prefix, `Authentication failed for [${names}]:`, err)
      continue
    }
    anyAuthenticated = true

    const tokenChanged = newToken !== oldToken
    anyTokenChanged = anyTokenChanged || tokenChanged
    log(prefix, `└ Refresh token ${tokenChanged ? 'CHANGED' : 'unchanged'} for [${names}].`)

    // Metadata-only fetch (feeds flip inference + discovery log); fetchAccountMap never
    // throws, so a listing hiccup can't block the transaction sync below.
    const trueLayerAccountsById = await fetchAccountMap(connection, accessToken, groupAccounts)

    for (const configAccount of groupAccounts) {
      const lastSyncDate = getAccountLastSyncDate(config.state, connection.name, configAccount.trueLayerId)
      const hadTransactions = await syncAccount({
        configAccount,
        connection,
        accessToken,
        trueLayerAccountsById,
        includeCategoryInNotes: config.includeCategoryInNotes,
        lookbackDays: config.lookbackDays,
        lastSyncDate,
        dryRun,
      })

      // Always carry the (possibly rotated) token forward; record lastSyncDate only when we synced.
      updatedAccounts[configAccount.trueLayerId] = {
        ...updatedAccounts[configAccount.trueLayerId],
        refreshToken: newToken,
        ...(hadTransactions ? { lastSyncDate: currentDate() } : {}),
      }
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  log(prefix, `Done in ${elapsed}s.`)

  // If nothing was processed at all (every authorization failed to authenticate),
  // signal no state change so the on-disk state is left untouched.
  if (!anyAuthenticated) {
    return undefined
  }

  // In a dry run we only persist state if a token actually rotated; otherwise we
  // return undefined so the on-disk state is left untouched.
  if (dryRun) {
    if (anyTokenChanged) {
      return { accounts: updatedAccounts }
    } else {
      return undefined
    }
  }

  return { accounts: updatedAccounts }
}
