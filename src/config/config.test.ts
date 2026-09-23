import { describe, it, expect } from 'vitest'
import { AccountSchema, ConnectionSchema, EnvSchema, FileConfigSchema, StateSchema } from './schema'
import { migrateState } from './config'

const DOC_A = '06d9e6ab-aa07-4359-9a68-a7a41068bd56'
const DOC_B = '11111111-2222-4333-8444-555555555555'

describe('AccountSchema', () => {
  const validAccount = {
    trueLayerId: 'tl-acc-1',
    actualId: 'actual-acc-1',
    friendlyName: 'My Account',
  }

  it('accepts a minimal valid account', () => {
    expect(AccountSchema.safeParse(validAccount).success).toBe(true)
  })

  it('accepts optional isCard and flip', () => {
    const result = AccountSchema.safeParse({ ...validAccount, isCard: true, flip: false })
    expect(result.success).toBe(true)
  })

  it('rejects missing trueLayerId', () => {
    const { trueLayerId: _, ...rest } = validAccount
    expect(AccountSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects empty trueLayerId', () => {
    expect(AccountSchema.safeParse({ ...validAccount, trueLayerId: '' }).success).toBe(false)
  })

  it('rejects missing actualId', () => {
    const { actualId: _, ...rest } = validAccount
    expect(AccountSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects missing friendlyName', () => {
    const { friendlyName: _, ...rest } = validAccount
    expect(AccountSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects a non-boolean flip', () => {
    expect(AccountSchema.safeParse({ ...validAccount, flip: 'yes' }).success).toBe(false)
  })
})

describe('ConnectionSchema', () => {
  const validConnection = {
    name: 'My Bank',
    documentId: DOC_A,
    accounts: [],
  }

  it('accepts a valid connection with empty accounts', () => {
    expect(ConnectionSchema.safeParse(validConnection).success).toBe(true)
  })

  it('accepts isCard at connection level', () => {
    expect(ConnectionSchema.safeParse({ ...validConnection, isCard: true }).success).toBe(true)
  })

  it('accepts a connection with accounts', () => {
    const result = ConnectionSchema.safeParse({
      ...validConnection,
      accounts: [{ trueLayerId: 'tl-1', actualId: 'a-1', friendlyName: 'Acc' }],
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing name', () => {
    const { name: _, ...rest } = validConnection
    expect(ConnectionSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects missing documentId', () => {
    const { documentId: _, ...rest } = validConnection
    expect(ConnectionSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects a non-UUID documentId', () => {
    expect(ConnectionSchema.safeParse({ ...validConnection, documentId: 'not-a-uuid' }).success).toBe(false)
  })
})

describe('FileConfigSchema', () => {
  const validFileConfig = {
    version: 3,
    connections: [{ name: 'My Bank', documentId: DOC_A, accounts: [] }],
  }

  it('accepts a valid file config', () => {
    expect(FileConfigSchema.safeParse(validFileConfig).success).toBe(true)
  })

  it('defaults includeCategoryInNotes to false', () => {
    const result = FileConfigSchema.safeParse(validFileConfig)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.includeCategoryInNotes).toBe(false)
  })

  it('accepts includeCategoryInNotes: true', () => {
    const result = FileConfigSchema.safeParse({ ...validFileConfig, includeCategoryInNotes: true })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.includeCategoryInNotes).toBe(true)
  })

  it('rejects empty connections array', () => {
    expect(FileConfigSchema.safeParse({ ...validFileConfig, connections: [] }).success).toBe(false)
  })

  it('rejects missing connections', () => {
    expect(FileConfigSchema.safeParse({}).success).toBe(false)
  })

  it('rejects a connection without documentId', () => {
    const result = FileConfigSchema.safeParse({
      ...validFileConfig,
      connections: [{ name: 'My Bank', accounts: [] }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects duplicate connection names', () => {
    const result = FileConfigSchema.safeParse({
      ...validFileConfig,
      connections: [
        { name: 'My Bank', documentId: DOC_A, accounts: [] },
        { name: 'My Bank', documentId: DOC_B, accounts: [] },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('accepts connections with unique names', () => {
    const result = FileConfigSchema.safeParse({
      ...validFileConfig,
      connections: [
        { name: 'My Bank', documentId: DOC_A, accounts: [] },
        { name: 'My Credit Card', documentId: DOC_A, accounts: [] },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('accepts connections grouped across multiple documents', () => {
    const result = FileConfigSchema.safeParse({
      ...validFileConfig,
      connections: [
        { name: 'My Bank', documentId: DOC_A, accounts: [] },
        { name: 'Other Bank', documentId: DOC_B, accounts: [] },
      ],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(new Set(result.data.connections.map((c) => c.documentId)).size).toBe(2)
    }
  })
})

describe('StateSchema', () => {
  it('defaults to empty connections when not provided', () => {
    const result = StateSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.connections).toEqual({})
  })

  it('accepts a valid state with per-account refresh tokens', () => {
    const result = StateSchema.safeParse({
      connections: {
        'My Bank': {
          accounts: {
            'tl-acc-1': { refreshToken: 'token-1', lastSyncDate: '2026-04-27' },
            'tl-acc-2': { refreshToken: 'token-2' },
          },
        },
      },
    })
    expect(result.success).toBe(true)
  })

  it('defaults accounts to empty object when not provided', () => {
    const result = StateSchema.safeParse({
      connections: { 'My Bank': {} },
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.connections['My Bank']?.accounts).toEqual({})
  })

  it('rejects an account with a missing refreshToken', () => {
    const result = StateSchema.safeParse({
      connections: { 'My Bank': { accounts: { 'tl-acc-1': {} } } },
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid lastSyncDate format', () => {
    const result = StateSchema.safeParse({
      connections: {
        'My Bank': {
          accounts: { 'tl-acc-1': { refreshToken: 'token', lastSyncDate: '24-04-2026' } },
        },
      },
    })
    expect(result.success).toBe(false)
  })
})

describe('migrateState', () => {
  it('fans out a legacy connection-level token to each account', () => {
    const migrated = migrateState({
      connections: {
        'My Bank': {
          refreshToken: 'legacy-token',
          accounts: { 'tl-acc-1': { lastSyncDate: '2026-04-27' } },
        },
      },
    })
    expect(migrated.connections['My Bank']?.accounts['tl-acc-1']).toEqual({
      refreshToken: 'legacy-token',
      lastSyncDate: '2026-04-27',
    })
    expect(StateSchema.safeParse(migrated).success).toBe(true)
  })

  it('preserves per-account tokens and ignores a stray connection-level token', () => {
    const migrated = migrateState({
      connections: {
        'My Bank': {
          refreshToken: 'legacy-token',
          accounts: { 'tl-acc-1': { refreshToken: 'account-token' } },
        },
      },
    })
    expect(migrated.connections['My Bank']?.accounts['tl-acc-1']?.refreshToken).toBe('account-token')
  })

  it('handles an empty or missing connections object', () => {
    expect(migrateState({}).connections).toEqual({})
    expect(migrateState({ connections: {} }).connections).toEqual({})
  })
})

describe('EnvSchema', () => {
  const validEnv = {
    TRUELAYER_CLIENT_ID: 'client-id',
    TRUELAYER_CLIENT_SECRET: 'client-secret',
    ACTUAL_SERVER_URL: 'http://localhost:5006',
    ACTUAL_SERVER_PASSWORD: 'password',
  }

  it('accepts valid minimal env', () => {
    expect(EnvSchema.safeParse(validEnv).success).toBe(true)
  })

  it('accepts optional CRON_SCHEDULE, DEBUG, and TZ', () => {
    const result = EnvSchema.safeParse({
      ...validEnv,
      CRON_SCHEDULE: '0 */4 * * *',
      DEBUG: 'true',
      TZ: 'Europe/London',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid ACTUAL_SERVER_URL', () => {
    expect(EnvSchema.safeParse({ ...validEnv, ACTUAL_SERVER_URL: 'not-a-url' }).success).toBe(false)
  })

  it('rejects an invalid CRON_SCHEDULE', () => {
    expect(EnvSchema.safeParse({ ...validEnv, CRON_SCHEDULE: 'not-a-cron' }).success).toBe(false)
  })

  it('rejects missing TRUELAYER_CLIENT_ID', () => {
    const { TRUELAYER_CLIENT_ID: _, ...rest } = validEnv
    expect(EnvSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects missing TRUELAYER_CLIENT_SECRET', () => {
    const { TRUELAYER_CLIENT_SECRET: _, ...rest } = validEnv
    expect(EnvSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects missing ACTUAL_SERVER_PASSWORD', () => {
    const { ACTUAL_SERVER_PASSWORD: _, ...rest } = validEnv
    expect(EnvSchema.safeParse(rest).success).toBe(false)
  })

  it('does not require ACTUAL_SYNC_ID (documents now come from config)', () => {
    // ACTUAL_SYNC_ID is intentionally absent and still parses fine.
    expect(EnvSchema.safeParse(validEnv).success).toBe(true)
  })
})
