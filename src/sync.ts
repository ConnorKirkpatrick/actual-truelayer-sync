import cron from 'node-cron'
import { loadConfig, writeState } from './config/config'
import { downloadDocument, initActual, shutdownActual } from './actual/actual'
import { syncConnection } from './sync/connection'
import { log, logError } from './utils/logger'
import type { Config, Connection, ConnectionState } from './config/schema'

const dryRun = process.argv.includes('--dry-run')

// Group the configured connections by the Actual document they sync into. Connections
// sharing a documentId are handled together after that document is downloaded.
function connectionsByDocument(config: Config): Map<string, Connection[]> {
  const byDocument = new Map<string, Connection[]>()
  for (const connection of config.connections) {
    const list = byDocument.get(connection.documentId) ?? []
    list.push(connection)
    byDocument.set(connection.documentId, list)
  }
  return byDocument
}

async function mainTask(config: Config): Promise<void> {
  try {
    await initActual({
      serverURL: config.env.ACTUAL_SERVER_URL,
      password: config.env.ACTUAL_SERVER_PASSWORD,
      verbose: !!config.env.DEBUG,
    })

    const updatedConnections = new Map<string, ConnectionState>()
    const byDocument = connectionsByDocument(config)

    for (const [documentId, connections] of byDocument) {
      log(['Sync'], `── Document ${documentId} (${connections.length} connection${connections.length === 1 ? '' : 's'}) ──`)

      try {
        await downloadDocument(documentId)
      } catch (e: any) {
        logError(['Sync'], `Failed to download document ${documentId} — skipping its connections.`, e)
        continue
      }

      for (const connection of connections) {
        const result = await syncConnection(connection, config, dryRun)
        if (result) {
          updatedConnections.set(connection.name, result)
        }
      }
    }

    // Batch-write state once after all documents complete
    for (const [name, state] of updatedConnections) {
      config.state.connections[name] = state
    }
    if (updatedConnections.size > 0) {
      await writeState(config)
    }
  } catch (e: any) {
    logError(['Sync'], 'Global sync error:', e)
    logError(['Sync'], 'error stack:', e.stack)
  } finally {
    await shutdownActual()
    log(['Sync'], 'Sync cycle finished. Sleeping...')
  }
}

void (async () => {
  let config: Config
  try {
    config = await loadConfig()
  } catch (err) {
    logError(['Sync'], 'Failed to load config:', err)
    process.exit(1)
  }

  if (dryRun) {
    log(['DRY RUN'], 'No transactions will be imported and no runs will be scheduled.')
  }

  await mainTask(config)

  if (dryRun) {
    if (config.env.CRON_SCHEDULE) {
      log(['DRY RUN'], `Would have scheduled: ${config.env.CRON_SCHEDULE}`)
    }
    return
  }

  if (config.env.CRON_SCHEDULE) {
    const timezone = config.env.TZ
    log(
      ['Sync'],
      `Scheduler initialized with pattern: ${config.env.CRON_SCHEDULE}${timezone ? ` (timezone: ${timezone})` : ''}`,
    )
    cron.schedule(
      config.env.CRON_SCHEDULE,
      () => {
        mainTask(config).catch((err) => logError(['Sync'], 'Unhandled task error:', err))
      },
      {
        noOverlap: true,
        ...(timezone ? { timezone } : {}),
      },
    )
  }
})()

process.on('SIGTERM', () => {
  log(['Sync'], 'SIGTERM received, shutting down...')
  shutdownActual()
    .catch((err) => logError(['Sync'], 'Error during shutdown:', err))
    .finally(() => process.exit(0))
})
