// @actual-app/api is a CJS module that references @actual-app/core's raw TypeScript
// source, which doesn't compile cleanly under strict mode. This ambient declaration
// overrides the module's types with just the surface area we actually use.
declare module '@actual-app/api' {
  interface BudgetFile {
    // Local budget id (present only for budgets already downloaded to the data dir).
    id?: string
    // The sync ID of the document (Settings → Show advanced settings → ID). This is the
    // value that downloadBudget() expects. Present on both local and remote (server) files.
    groupId?: string
    name: string
    cloudFileId?: string
    state?: 'local' | 'remote'
  }

  const actual: {
    init(options: { serverURL: string; password: string; verbose?: boolean; dataDir?: string }): Promise<void>
    downloadBudget(syncId: string, opts?: { password?: string }): Promise<void>
    getBudgets(): Promise<BudgetFile[]>
    importTransactions(
      accountId: string,
      transactions: {
        date: string
        amount: number
        payee_name?: string
        notes?: string
        imported_id?: string
        cleared?: boolean
        account?: string
      }[],
    ): Promise<{ errors: unknown[]; added: string[]; updated: string[] }>
    getAccounts(): Promise<Array<{ id: string; name: string; closed?: boolean }>>
    shutdown(): Promise<void>
  }
  export default actual
}
