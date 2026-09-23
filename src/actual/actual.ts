import actual from '@actual-app/api'

interface InitOptions {
  serverURL: string
  password: string
  verbose: boolean
}

// The @actual-app/api works on a single "active" budget at a time. We authenticate once
// with initActual(), then switch the active budget per document with downloadDocument().
let activePassword: string | undefined

export async function initActual(options: InitOptions): Promise<void> {
  activePassword = options.password
  await actual.init({
    serverURL: options.serverURL,
    password: options.password,
    verbose: options.verbose,
    dataDir: './data',
  })
}

export interface ActualDocument {
  // The document's sync ID — this is the value used to target it (and for config.json documentId).
  id: string
  name: string
}

// The shape of a budget/document entry as returned by getBudgets(). The sync ID (used to
// target a document) lives in groupId for server files and id for local budgets.
interface BudgetFile {
  id?: string
  groupId?: string
  name: string
}

// List all documents (budgets) available from the Actual server. Each entry carries the
// document's sync ID and its display name so the caller can present both.
export async function listDocuments(): Promise<ActualDocument[]> {
  const budgets = (await actual.getBudgets()) as BudgetFile[]
  return budgets
    .map((b) => ({ id: b.groupId ?? b.id ?? '', name: b.name }))
    .filter((b): b is ActualDocument => b.id !== '')
}

// Download (if necessary) and activate a single document so that subsequent
// importTransactions()/getAccounts() calls operate against it.
export async function downloadDocument(documentId: string): Promise<void> {
  await actual.downloadBudget(documentId, { password: activePassword })
}

export async function importTransactions(
  accountId: string,
  transactions: Parameters<typeof actual.importTransactions>[1],
): Promise<{ added: string[]; updated: string[] }> {
  const result = await actual.importTransactions(accountId, transactions)
  if (result.errors.length > 0) {
    throw new Error(`Import errors for account ${accountId}: ${JSON.stringify(result.errors)}`)
  }
  return { added: result.added, updated: result.updated }
}

export async function getAccounts(): Promise<Array<{ id: string; name: string; closed: boolean }>> {
  return actual.getAccounts()
}

export async function shutdownActual(): Promise<void> {
  await actual.shutdown()
}
