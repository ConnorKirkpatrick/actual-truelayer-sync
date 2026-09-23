import axios from 'axios'
import { listAccounts, listCards } from '../truelayer/truelayer'
import { log, logError } from '../utils/logger'
import { resolveIsCard } from '../utils/account'
import type { Account, Connection } from '../config/schema'
import type { TrueLayerAccount, TrueLayerCard } from '../truelayer/types'

function isEndpointNotSupported(err: unknown): boolean {
  return axios.isAxiosError(err) && (err.response?.data as any)?.error === 'endpoint_not_supported'
}

/**
 * Build a map of the TrueLayer account/card objects for the accounts in `groupAccounts`,
 * keyed by trueLayerId. The result is metadata only — it lets `transformTransactions`
 * infer the credit-card flip from `card_type`, and it powers the "unmatched account"
 * discovery log. A failing listing is therefore non-fatal: we log and return whatever we
 * managed to collect, so the actual transaction sync can still proceed.
 */
export async function fetchAccountMap(
  connection: Connection,
  accessToken: string,
  groupAccounts: Account[],
): Promise<Map<string, TrueLayerAccount | TrueLayerCard>> {
  const prefix = [connection.name]
  const accountsById = new Map<string, TrueLayerAccount | TrueLayerCard>()

  // Decide which listing endpoint(s) to hit from each account's own isCard flag
  // (account-level overrides connection-level), rather than a single connection-level
  // flag — a connection may mix a bank account and a card, and each must be fetched
  // from its correct endpoint.
  const wantsAccounts = groupAccounts.some((a) => !resolveIsCard(a, connection))
  const wantsCards = groupAccounts.some((a) => resolveIsCard(a, connection))

  if (wantsAccounts) {
    try {
      log(prefix, `Fetching account details...`)
      const accounts = await listAccounts(accessToken)
      for (const a of accounts) accountsById.set(a.account_id, a)
      log(prefix, `└ Found ${accounts.length} account${accounts.length === 1 ? '' : 's'}.`)
    } catch (err) {
      if (isEndpointNotSupported(err)) {
        log(prefix, 'Provider does not support account listing — continuing without account metadata.')
      } else {
        logError(prefix, 'Could not list accounts — continuing without account metadata:', err)
      }
    }
  }

  if (wantsCards) {
    try {
      log(prefix, `Fetching card details...`)
      const cards = await listCards(accessToken)
      for (const c of cards) accountsById.set(c.account_id, c)
      log(prefix, `└ Found ${cards.length} card${cards.length === 1 ? '' : 's'}.`)
    } catch (err) {
      if (isEndpointNotSupported(err)) {
        log(prefix, 'Provider does not support card listing — continuing without card metadata.')
      } else {
        logError(prefix, 'Could not list cards — continuing without card metadata:', err)
      }
    }
  }

  // Discovery log: surface any listed accounts/cards that aren't in the config yet, so
  // their trueLayerIds can be copied into config.json.
  const configuredIds = new Set(groupAccounts.map((a) => a.trueLayerId))
  const unmatched = [...accountsById.values()].filter((a) => !configuredIds.has(a.account_id))
  if (unmatched.length > 0) {
    log(prefix, `Unmatched TrueLayer account/card (not in config):`)
    for (const a of unmatched) {
      const detail =
        'account_type' in a ? ` (${(a as TrueLayerAccount).account_type})` : ` (${(a as TrueLayerCard).card_type})`
      log(prefix, `  └ ${a.display_name}${detail} — trueLayerId: ${a.account_id}`)
    }
  }

  return accountsById
}
