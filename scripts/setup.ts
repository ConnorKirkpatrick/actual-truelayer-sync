#!/usr/bin/env tsx
/**
 * Interactive setup script for adding a new TrueLayer connection.
 *
 * Local:  npm run setup
 * Docker: docker compose run --rm actual-truelayer-sync npm run setup
 */

import { input, select, checkbox, confirm } from '@inquirer/prompts'
import fs from 'fs'
import path from 'path'
import { z } from 'zod'
import { exchangeCode, getMe, listAccounts, listCards } from '../src/truelayer/truelayer'
import { initActual, listDocuments, downloadDocument, getAccounts, shutdownActual } from '../src/actual/actual'
import { readJSON, writeJSON } from '../src/utils/file'
import type { Connection, FileConfig, State } from '../src/config/schema'

// Paths
const DATA_DIR = path.resolve(__dirname, '..', 'data')
const CONFIG_PATH = path.join('config.json')
const STATE_PATH = path.join('state.json')

// TrueLayer OAuth constants
const TRUELAYER_AUTH_BASE = 'https://auth.truelayer.com'

const SCOPES = {
  // Most things use accounts
  accounts: 'accounts balance transactions offline_access',
  // My credit card needed cards instead
  cards: 'cards balance transactions offline_access',
} as const

type Scope = keyof typeof SCOPES

function buildAuthUrl(clientId: string, scope: string, redirectUri: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope,
    redirect_uri: redirectUri,
    providers: 'uk-ob-all uk-oauth-all',
  })
  return `${TRUELAYER_AUTH_BASE}/?${params}`
}

async function tryReadJSON<T>(filePath: string): Promise<T | null> {
  try {
    return await readJSON<T>(filePath)
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  console.log('\nactual-truelayer-sync — connection setup\n')

  // 1. Validate environment
  const SetupEnvSchema = z.object({
    TRUELAYER_CLIENT_ID: z.string().min(1),
    TRUELAYER_CLIENT_SECRET: z.string().min(1),
    ACTUAL_SERVER_URL: z.url(),
    ACTUAL_SERVER_PASSWORD: z.string().min(1),
  })

  const envResult = SetupEnvSchema.safeParse(process.env)
  if (!envResult.success) {
    const missing = envResult.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    console.error(`Missing or invalid environment variables:\n${missing}`)
    process.exit(1)
  }
  const env = envResult.data

  // 2. Load existing config / state (may not exist on first run)
  const existingConfig = await tryReadJSON<FileConfig>(CONFIG_PATH)
  const existingState = await tryReadJSON<State>(STATE_PATH)

  const existingConnectionNames = new Set(existingConfig?.connections.map((c) => c.name) ?? [])
  const mappedActualIds = new Set(existingConfig?.connections.flatMap((c) => c.accounts.map((a) => a.actualId)) ?? [])

  // 3. Connection type — determines OAuth scope
  const connectionType = await select<Scope>({
    message: 'What type of connection is this?',
    choices: [
      { name: 'Bank accounts (current, savings, etc.) - use this if unsure', value: 'accounts' },
      { name: 'Credit / charge cards', value: 'cards' },
    ],
  })
  const scope = SCOPES[connectionType]

  // 4. Redirect URI
  const redirectUri = (
    await input({
      message: 'Redirect URI registered with TrueLayer:',
      validate: (v) => (v.trim().length > 0 ? true : 'Required'),
      default: 'https://console.truelayer.com/redirect-page',
    })
  ).trim()

  // 5. Display auth URL
  const authUrl = buildAuthUrl(env.TRUELAYER_CLIENT_ID, scope, redirectUri)
  console.log('\nOpen this URL in your browser to authenticate:\n')
  console.log(`  ${authUrl}\n`)

  const pastedUrl = await input({
    message: 'Paste the full redirect URL after completing auth:',
    validate: (v) => {
      try {
        new URL(v)
        return true
      } catch {
        return 'Enter a valid URL'
      }
    },
  })

  // 6. Parse auth code
  const code = new URL(pastedUrl).searchParams.get('code')
  if (!code) {
    console.error('No "code" parameter found in the URL. Make sure you pasted the full redirect URL.')
    process.exit(1)
  }

  // 7. Exchange code for tokens
  console.log('\nExchanging code for tokens...')
  let accessToken: string
  let newRefreshToken: string
  try {
    const tokens = await exchangeCode(env.TRUELAYER_CLIENT_ID, env.TRUELAYER_CLIENT_SECRET, code, redirectUri)
    accessToken = tokens.access_token
    newRefreshToken = tokens.refresh_token
  } catch (err) {
    console.error(`Token exchange failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
  console.log('Authenticated successfully.\n')

  // 8. Fetch provider name for connection name default
  let providerDisplayName: string | undefined
  try {
    const me = await getMe(accessToken)
    providerDisplayName = me.provider.display_name
  } catch {
    // Non-fatal — user can type the name manually
  }

  // 9. Connection name
  const connectionName = await input({
    message: 'Name for this connection:',
    default: providerDisplayName,
    validate: (v) => {
      if (!v.trim()) {
        return 'Required'
      }
      if (existingConnectionNames.has(v.trim())) {
        return `"${v.trim()}" is already in use`
      }
      return true
    },
  })

  // 10. Fetch TrueLayer accounts / cards
  console.log('\nFetching accounts from TrueLayer...')
  type TLAccount = { id: string; label: string; friendlyName?: string }
  let trueLayerAccounts: TLAccount[] = []

  try {
    if (connectionType === 'cards') {
      const cards = await listCards(accessToken)
      trueLayerAccounts = cards.map((c) => ({
        id: c.account_id,
        label: `${c.display_name}${c.partial_card_number ? ` (•••• ${c.partial_card_number.slice(-4)})` : ''}`,
      }))
    } else {
      const accounts = await listAccounts(accessToken)
      trueLayerAccounts = accounts.map((a) => ({
        id: a.account_id,
        label: `${a.display_name}${a.account_number.number ? ` (•••• ${a.account_number.number.slice(-4)})` : ''}`,
      }))
    }
  } catch (err) {
    console.error(`Failed to fetch accounts: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  if (trueLayerAccounts.length === 0) {
    console.log('No accounts found for this connection. Tokens will still be saved.\n')
  }

  // 10. Checkbox — select accounts to map
  const selectedIds: string[] =
    trueLayerAccounts.length > 0
      ? await checkbox({
          message: 'Which accounts do you want to add? (space to select, enter to confirm)',
          choices: trueLayerAccounts.map((a) => ({ name: a.label, value: a.id })),
        })
      : []

  // 11. Map each selected account to an Actual Budget account
  type MappedAccount = {
    trueLayerId: string
    actualId: string
    friendlyName: string
    isCard?: boolean
  }

  const mappedAccounts: MappedAccount[] = []
  const skippedAccounts: TLAccount[] = []
  let chosenDocument: { id: string; name: string } | null = null

  if (selectedIds.length > 0) {
    console.log('\nConnecting to Actual Budget...')
    let actualAccounts: Array<{ id: string; name: string }> = []

    try {
      await initActual({
        serverURL: env.ACTUAL_SERVER_URL,
        password: env.ACTUAL_SERVER_PASSWORD,
        verbose: false,
      })

      // 11a. Choose which Actual Budget document to sync into
      const documents = await listDocuments()
      if (documents.length === 0) {
        throw new Error('No documents found on the Actual server.')
      }
      console.log('\nDocuments on your Actual server:')
      for (const d of documents) {
        console.log(`  • ${d.name}  —  documentId: ${d.id}`)
      }

      const existingDocIds = new Set(existingConfig?.connections.map((c) => (c as any).documentId).filter(Boolean))
      const defaultDoc = existingDocIds.size === 1 ? [...existingDocIds][0] : undefined

      const chosenId = await select({
        message: 'Which document should this connection sync into?',
        choices: documents.map((d) => ({ name: `${d.name} (${d.id})`, value: d.id })),
        default: defaultDoc,
      })
      const chosen = documents.find((d) => d.id === chosenId)!
      chosenDocument = chosen
      console.log(`\nSelected document: ${chosen.name} (${chosen.id})\n`)

      // 11b. Load that document, then list its open accounts (with their IDs)
      await downloadDocument(chosen.id)
      const all = await getAccounts()
      actualAccounts = all.filter((a) => !a.closed && !mappedActualIds.has(a.id))
      console.log(`Accounts in "${chosen.name}":`)
      if (actualAccounts.length === 0) {
        console.log('  (no open accounts)')
      }
      for (const a of actualAccounts) {
        console.log(`  • ${a.name}  —  actualId: ${a.id}`)
      }
      console.log('')
    } catch (err) {
      console.error(`Could not connect to Actual Budget: ${err instanceof Error ? err.message : String(err)}`)
      console.log('Skipping account mapping — add documentId and actualId values to config.json manually.\n')
    } finally {
      try {
        await shutdownActual()
      } catch {
        // ignore shutdown errors
      }
    }

    for (const trueLayerId of selectedIds) {
      const tlAccount = trueLayerAccounts.find((a) => a.id === trueLayerId)!
      console.log('')

      if (actualAccounts.length === 0) {
        const friendlyName = await input({
          message: `No Actual Budget accounts available. Enter a name for "${tlAccount.label}" to use later:`,
          default: tlAccount.label,
        })
        skippedAccounts.push({ ...tlAccount, friendlyName: friendlyName.trim() || tlAccount.label })
        continue
      }

      const SKIP = '__skip__'
      const actualId = await select({
        message: `Map "${tlAccount.label}" to which Actual Budget account?`,
        choices: [
          ...actualAccounts.map((a) => ({ name: a.name, value: a.id })),
          { name: "I haven't created it yet — skip for now", value: SKIP },
        ],
      })

      if (actualId === SKIP) {
        const friendlyName = await input({
          message: `Enter a name for "${tlAccount.label}" to use when you add it later:`,
          default: tlAccount.label,
        })
        skippedAccounts.push({ ...tlAccount, friendlyName: friendlyName.trim() || tlAccount.label })
        console.log(`  Skipped. Add this manually to config.json: trueLayerId = "${trueLayerId}"`)
        continue
      }

      const abAccount = actualAccounts.find((a) => a.id === actualId)!
      const account: MappedAccount = {
        trueLayerId,
        actualId,
        friendlyName: abAccount.name,
      }
      if (connectionType === 'cards') account.isCard = true
      mappedAccounts.push(account)

      // Remove from available list so it can't be double-mapped
      const idx = actualAccounts.findIndex((a) => a.id === actualId)
      if (idx !== -1) actualAccounts.splice(idx, 1)
    }
  }

  // 12. Summary & confirmation
  console.log('\n--- Summary ---')
  console.log(`Connection name : ${connectionName.trim()}`)
  console.log(`Type            : ${connectionType}`)
  console.log(`Accounts to add : ${mappedAccounts.length}`)
  for (const a of mappedAccounts) {
    console.log(`  • ${a.friendlyName} (${a.trueLayerId} → ${a.actualId})`)
  }
  if (skippedAccounts.length > 0) {
    console.log(`Skipped         : ${skippedAccounts.map((a) => a.friendlyName ?? a.label).join(', ')}`)
  }
  if (chosenDocument) {
    console.log(`Document        : ${chosenDocument.name} (${chosenDocument.id})`)
  } else {
    console.log(`Document        : <none selected — set "documentId" on this connection manually>`)
  }
  console.log('---------------\n')

  const ok = await confirm({ message: 'Write to config.json and state.json?', default: true })
  if (!ok) {
    console.log('Aborted — no files written.')
    process.exit(0)
  }

  // 13. Ensure data directory exists
  fs.mkdirSync("./data", { recursive: true })

  // 14. Build updated config
  // documentId is required by the config schema. In the normal path it is always set (the
  // user picked a document above). In the degraded path (Actual connection failed, or no
  // accounts selected) we write the connection anyway so it can be completed by hand; the
  // sync service will report it as invalid until a valid "documentId" is added.
  const newConnection: Connection = {
    name: connectionName.trim(),
    documentId: chosenDocument?.id ?? '',
    ...(connectionType === 'cards' ? { isCard: true } : {}),
    accounts: mappedAccounts,
  }

  const updatedConfig: FileConfig = {
    version: 3,
    includeCategoryInNotes: existingConfig?.includeCategoryInNotes ?? false,
    lookbackDays: existingConfig?.lookbackDays ?? 14,
    connections: [...(existingConfig?.connections ?? []), newConnection],
  }

  // 15. Build updated state
  // One refresh token per TrueLayer account. We record the token for every account
  // the user selected (not just the ones mapped to Actual), so the authorization is
  // preserved even in the degraded path where accounts still need to be added by hand.
  const newAccountState: State['connections'][string]['accounts'] = {}
  for (const trueLayerId of selectedIds) {
    newAccountState[trueLayerId] = { refreshToken: newRefreshToken }
  }

  const updatedState: State = {
    connections: {
      ...(existingState?.connections ?? {}),
      [connectionName.trim()]: {
        accounts: newAccountState,
      },
    },
  }

  await writeJSON(CONFIG_PATH, updatedConfig)
  await writeJSON(STATE_PATH, updatedState)

  console.log('\nDone! config.json and state.json have been updated.')

  if (skippedAccounts.length > 0) {
    console.log('\nRemember to add these accounts to config.json once created in Actual Budget:')
    for (const a of skippedAccounts) {
      console.log(`  • ${a.friendlyName ?? a.label}  —  trueLayerId: "${a.id}"`)
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
