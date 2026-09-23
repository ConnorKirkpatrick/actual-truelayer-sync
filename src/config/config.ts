import fs from 'fs/promises'
import path from 'path'
import { log, logError } from '../utils/logger'
import { Config, EnvSchema, FileConfig, FileConfigSchema, State, StateSchema } from './schema'
import { readJSON, writeJSON } from '../utils/file'

type RawStateConnection = {
  // Present only in the legacy (pre-per-account-token) state format.
  refreshToken?: string
  accounts?: Record<string, { refreshToken?: string; lastSyncDate?: string }>
}
type RawState = { connections?: Record<string, RawStateConnection> }

/**
 * Migrate legacy state (one refresh token per connection) to the current format
 * (one refresh token per account). In the legacy format a connection held a single
 * refresh token shared by all of its accounts; we fan that token out to each account
 * that doesn't already have its own. Accounts that already carry a per-account token
 * are left untouched.
 */
export function migrateState(raw: RawState): State {
  const connections: State['connections'] = {}
  for (const [name, conn] of Object.entries(raw.connections ?? {})) {
    const legacyToken = conn.refreshToken
    const accounts: State['connections'][string]['accounts'] = {}
    for (const [trueLayerId, acc] of Object.entries(conn.accounts ?? {})) {
      accounts[trueLayerId] = {
        refreshToken: acc.refreshToken ?? legacyToken ?? '',
        ...(acc.lastSyncDate ? { lastSyncDate: acc.lastSyncDate } : {}),
      }
    }
    connections[name] = { accounts }
  }
  return { connections }
}

const CONFIG_PATH = path.resolve(__dirname, '..', '..', 'data', 'config.json')
const STATE_PATH = path.resolve(__dirname, '..', '..', 'data', 'state.json')
const CURRENT_CONFIG_VERSION = 3

export async function loadConfig(): Promise<Config> {
  log(['Config'], `Loading config from ${CONFIG_PATH}`)
  log(['Config'], `Loading state from ${STATE_PATH}`)
  log(['Config'], `Runtime env: ACTUAL_SERVER_URL=${process.env.ACTUAL_SERVER_URL ?? '<missing>'}`)
  log(['Config'], `Runtime env: TRUELAYER_CLIENT_ID=${process.env.TRUELAYER_CLIENT_ID ?? '<missing>'}`)

  // Validate environment variables
  const envResult = EnvSchema.safeParse(process.env)
  if (!envResult.success) {
    const issues = envResult.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Missing or invalid environment variables:\n${issues}`)
  }

  // Load and validate config file
  const rawConfig = await readJSON<FileConfig>(CONFIG_PATH)
  const fileResult = FileConfigSchema.safeParse(rawConfig)
  if (!fileResult.success) {
    const issues = fileResult.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid config file:\n${issues}\n\nSee config.example.json for the expected format.`)
  }

  // Verify versions
  if (fileResult.data.version !== CURRENT_CONFIG_VERSION) {
    throw new Error(
      `Config version mismatch: found v${fileResult.data.version}, expected v${CURRENT_CONFIG_VERSION}.\n` +
        `See MIGRATION.md for upgrade instructions.`,
    )
  }

  // Log which documents the connections target, so multi-document setups are easy to reason about.
  const documentIds = [...new Set(fileResult.data.connections.map((c) => c.documentId))]
  log(['Config'], `Syncing into ${documentIds.length} document(s): ${documentIds.join(', ')}`)
  for (const connection of fileResult.data.connections) {
    log(['Config'], `  • ${connection.name} → document ${connection.documentId}`)
  }

  // Load state, migrating the legacy per-connection token format to per-account tokens
  const rawState = await readJSON<RawState>(STATE_PATH)
  const stateResult = StateSchema.safeParse(migrateState(rawState))
  if (!stateResult.success) {
    const issues = stateResult.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid state file:\n${issues}\n\nSee state.example.json for the expected format.`)
  }

  // Warn about connections with no state entry
  for (const connection of fileResult.data.connections) {
    if (!stateResult.data.connections[connection.name]) {
      logError(['Config'], `No state entry for connection "${connection.name}" — it will be skipped during sync.`)
    }
  }

  return { ...fileResult.data, env: envResult.data, state: stateResult.data }
}

export async function writeState(config: Config): Promise<void> {
  await writeJSON(STATE_PATH, config.state)
  log(['Config'], 'State saved.')
}
