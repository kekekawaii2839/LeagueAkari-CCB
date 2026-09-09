const port = Number(process.argv[2])
if (!Number.isInteger(port)) throw new Error('port required')

let version
for (let attempt = 0; attempt < 50; attempt += 1) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`)
    if (response.ok) {
      version = await response.json()
      break
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 200))
}
if (!version?.webSocketDebuggerUrl) throw new Error('packaged Electron CDP endpoint unavailable')

await new Promise((resolve, reject) => {
  const socket = new WebSocket(version.webSocketDebuggerUrl)
  const timeout = setTimeout(() => reject(new Error('Browser.close timed out')), 10_000)
  let closeSent = false
  socket.addEventListener('open', () => {
    closeSent = true
    socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.id === 1) {
      clearTimeout(timeout)
      socket.close()
      resolve()
    }
  })
  socket.addEventListener('close', () => {
    if (closeSent) {
      clearTimeout(timeout)
      resolve()
    }
  })
  socket.addEventListener('error', (event) => reject(event.error ?? new Error('CDP socket failed')))
})
