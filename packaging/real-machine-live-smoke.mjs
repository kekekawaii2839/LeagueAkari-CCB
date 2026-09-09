import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const port = Number(process.argv[2])
const configPath = resolve(process.argv[3] ?? '../.local/member-analysis.json')
const userData = resolve(process.argv[4] ?? '')
if (!Number.isInteger(port) || !existsSync(configPath) || !userData) {
  throw new Error('port, local config path and isolated userData are required')
}

const localConfig = JSON.parse(readFileSync(configPath, 'utf8'))
const riotId = localConfig.riotIds?.find((value) => typeof value === 'string' && value.includes('#'))
const serverId = localConfig.legacyCollector?.sgpServerId
if (!riotId || typeof serverId !== 'string') throw new Error('approved local member configuration is unavailable')
const separator = riotId.lastIndexOf('#')
const member = { serverId, gameName: riotId.slice(0, separator), tagLine: riotId.slice(separator + 1) }

let target
for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`)
    const targets = await response.json()
    target = targets.find((item) => item.type === 'page')
    if (target?.webSocketDebuggerUrl) break
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 250))
}
if (!target?.webSocketDebuggerUrl) throw new Error('packaged renderer did not become available')

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', () => reject(new Error('CDP connection failed')), { once: true })
})
let sequence = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (!message.id || !pending.has(message.id)) return
  const { resolve, reject } = pending.get(message.id)
  pending.delete(message.id)
  message.error ? reject(new Error(message.error.message)) : resolve(message.result)
})
function command(method, params = {}) {
  const id = ++sequence
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error('renderer evaluation failed')
  return result.result.value
}
async function ipc(method, ...args) {
  const expression = `(async()=>window.electron.ipcRenderer.invoke('akariCall','member-analysis-main',${JSON.stringify(method)},...${JSON.stringify(args)}))()`
  const envelope = await evaluate(expression)
  if (!envelope?.success) throw new Error('IPC transport failed')
  return envelope.data
}
async function waitForJob(jobId, timeoutMs = 600_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await ipc('getJob', { jobId })
    if (!result.ok) return { status: 'error', code: result.error?.code ?? 'UNKNOWN' }
    if (['completed', 'failed', 'cancelled'].includes(result.value.status)) return result.value
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return { status: 'timeout' }
}
function fileHash(path) {
  return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null
}

await command('Runtime.enable')
for (let attempt = 0; attempt < 100; attempt += 1) {
  if (await evaluate("Boolean(window.electron?.ipcRenderer)")) break
  await new Promise((resolve) => setTimeout(resolve, 200))
}

const capabilities = await ipc('getCapabilities')
if (!capabilities.ok || !capabilities.value.workerAvailable) throw new Error('packaged worker capability unavailable')
const settings = {
  enabled: true,
  members: [member],
  historyDepth: 50,
  queueIds: [400, 420, 430, 440, 490],
  storageLimitGiB: 10,
  opggEnabled: false
}
const settingsResult = await ipc('updateSettings', settings)
if (!settingsResult.ok) throw new Error(`settings rejected: ${settingsResult.error?.code ?? 'UNKNOWN'}`)

const firstStart = await ipc('startRefresh')
let firstJob
if (!firstStart.ok) firstJob = { status: 'not-started', code: firstStart.error?.code ?? 'UNKNOWN' }
else firstJob = await waitForJob(firstStart.value.jobId)

const overview = await ipc('getOverview', { pagination: { cursor: null, pageSize: 1 } })
const databasePath = resolve(userData, 'member-analysis/db/analysis.sqlite3')
const hashBeforeCancel = fileHash(databasePath)

let cancelJob = { status: 'not-run' }
let hashPreserved = null
if (firstJob.status === 'completed' && hashBeforeCancel) {
  await ipc('updateSettings', { historyDepth: 100 })
  const secondStart = await ipc('startRefresh')
  if (secondStart.ok) {
    await new Promise((resolve) => setTimeout(resolve, 750))
    await ipc('cancelJob', { jobId: secondStart.value.jobId })
    cancelJob = await waitForJob(secondStart.value.jobId, 60_000)
    hashPreserved = fileHash(databasePath) === hashBeforeCancel
  } else cancelJob = { status: 'not-started', code: secondStart.error?.code ?? 'UNKNOWN' }
}

const storage = await ipc('getStorageStatus')
const safeResult = {
  workerAvailable: capabilities.value.workerAvailable,
  featureEnabled: settingsResult.value.enabled,
  firstRefreshStatus: firstJob.status,
  firstRefreshCode: firstJob.code ?? firstJob.error?.code ?? null,
  published: Boolean(hashBeforeCancel),
  gameCount: overview.ok ? overview.value.gameCount : null,
  cancelStatus: cancelJob.status,
  cancelCode: cancelJob.code ?? cancelJob.error?.code ?? null,
  publishedHashPreservedAfterCancel: hashPreserved,
  storageUnderLimit: storage.ok ? !storage.value.overLimit : null,
  tokenExposed: JSON.stringify({ capabilities, settingsResult, firstJob, overview, cancelJob, storage })
    .toLowerCase()
    .includes('authorization')
}
console.log(JSON.stringify(safeResult))
socket.close()
