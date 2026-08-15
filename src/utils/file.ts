import fs from 'fs/promises'

export async function readJSON<T extends any>(file: string): Promise<T> {
  let rawFile: string
  try {
    rawFile = await fs.readFile(file, 'utf-8')
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      throw new Error(`File not found at ${file}.\nMake sure the directory is volume-mounted and the file exists.`)
    }
    throw new Error(`Failed to read file at ${file}: ${String(err)}`)
  }

  try {
    return JSON.parse(rawFile) as T
  } catch (err) {
    throw new Error(`Failed to parse JSON in file at ${file}: ${String(err)}`)
  }
}

export async function writeJSON<T extends any>(file: string, data: T, maxRetries = 5): Promise<void> {
  const tmpPath = `${file}.tmp`
  const initialBackoffMs = 5000
  const maxBackoffMs = 60000

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
      await fs.rename(tmpPath, file)
      return
    } catch (err: any) {
      // Clean up stale tmp file on failure
      try {
        await fs.rm(tmpPath, { force: true })
      } catch {
        // Ignore cleanup errors
      }

      if (err?.code === 'EBUSY' && attempt < maxRetries) {
        const backoffMs = Math.min(initialBackoffMs * Math.pow(2, attempt), maxBackoffMs)
        const jitterMs = Math.random() * 500
        const waitMs = backoffMs + jitterMs
        console.warn(
          `EBUSY writing ${file} (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${(waitMs / 1000).toFixed(1)}s...`,
        )
        await new Promise((resolve) => setTimeout(resolve, waitMs))
      } else {
        throw err
      }
    }
  }
}
