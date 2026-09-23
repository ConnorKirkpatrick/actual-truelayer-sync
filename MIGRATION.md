# Migration Guide

## v2 → v3

Config format version 3 supports **multiple Actual Budget documents**. Previously the single target document was supplied
via the `ACTUAL_SYNC_ID` environment variable and was shared by every connection. Now each connection declares its own
document with a required `documentId` field, so one run can sync into any number of documents.

### What changed

- `ACTUAL_SYNC_ID` has been **removed** from the environment. It is no longer read.
- Each connection in `config.json` now requires a `documentId` field (the Actual Budget document's sync ID, found under
  **Settings → Show advanced settings → ID**).
- `config.json` now requires `"version": 3`.
- The sync service groups connections by `documentId`, downloading each document once and importing that document's
  connections into it.
- Refresh tokens moved from the **connection** to the **account** level in `state.json` (one token per TrueLayer
  account). A connection can now span several TrueLayer authorizations — e.g. a card and a bank account in the same
  Actual document, each with their own token. The app migrates the old one-token-per-connection format automatically on
  startup, so you don't need to hand-edit `state.json` unless a single connection now needs *different* tokens for
  different accounts.

### Steps

**1. Find your document ID(s)**

In Actual Budget, go to **Settings → Show advanced settings → ID**. This is the value that used to go in
`ACTUAL_SYNC_ID`. If you have several budgets, each has its own ID.

**2. Update `config.json`**

- Change `"version": 2` to `"version": 3`
- Add a `"documentId"` to every connection, set to the ID of the document that connection should sync into

Before:
```json
{
  "version": 2,
  "connections": [
    {
      "name": "My Bank",
      "accounts": [ { "trueLayerId": "acc-123", "actualId": "abc-456", "friendlyName": "Current Account" } ]
    }
  ]
}
```

After:
```json
{
  "version": 3,
  "connections": [
    {
      "name": "My Bank",
      "documentId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "accounts": [ { "trueLayerId": "acc-123", "actualId": "abc-456", "friendlyName": "Current Account" } ]
    }
  ]
}
```

**3. Remove `ACTUAL_SYNC_ID` from your `.env` / compose file** (optional, but it is ignored now).

**4. Verify**

Start the app. You should see one log line per connection naming its document, e.g.
`[My Bank] → document <name> (a1b2c3d4-…)`, followed by `State saved.` after the first successful sync.

---

## v1 → v2

Config format version 2 separates user configuration from runtime state. The app no longer writes to `config.json`.

### What changed

- `refreshToken` has moved out of `config.json` into `state.json`
- `lastSyncDate` has moved out of `config.json` into `state.json`
- `config.json` now requires a `"version": 2` field
- A new `state.json` file in your `data/` directory is now required on startup
- Connections now required to have unique names (enforced by schema) — this is necessary to key state by connection name

### Steps

**1. Create `state.json`**

Create `data/state.json` using your existing `config.json` values. For each connection, take the `refreshToken`. For
each account, take the `lastSyncDate` (if present).

```json
{
  "connections": {
    "My Bank": {
      "refreshToken": "<your existing refreshToken>",
      "accounts": {
        "<trueLayerId>": { "lastSyncDate": "<your existing lastSyncDate>" }
      }
    }
  }
}
```

Accounts with no `lastSyncDate` can be omitted or set to `"accounts": {}` — the app will fetch all available history on
the next sync.

See `state.example.json` for the full expected format.

**2. Update `config.json`**

- Add `"version": 2` at the top level
- Remove `refreshToken` from every connection
- Remove `lastSyncDate` from every account

Before:
```json
{
  "includeCategoryInNotes": false,
  "connections": [
    {
      "name": "My Bank",
      "refreshToken": "ey...",
      "accounts": [
        {
          "trueLayerId": "acc-123",
          "actualId": "abc-456",
          "friendlyName": "Current Account",
          "lastSyncDate": "2026-04-27"
        }
      ]
    }
  ]
}
```

After:
```json
{
  "version": 2,
  "includeCategoryInNotes": false,
  "connections": [
    {
      "name": "My Bank",
      "accounts": [
        {
          "trueLayerId": "acc-123",
          "actualId": "abc-456",
          "friendlyName": "Current Account"
        }
      ]
    }
  ]
}
```

**3. Verify**

Start the app. You should see `State saved.` in the logs after the first successful sync. If anything is wrong, the app
should log a clear error pointing to the relevant file.
