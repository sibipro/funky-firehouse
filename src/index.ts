/// <reference types="@cloudflare/workers-types" />
import { checkAuth } from './auth'
export interface Env {
  WEBSOCKET_SERVER: DurableObjectNamespace
  ASSETS: any
  QUEUE: Queue<any>
  PRE_SHARED_KEY: string
}

const decodeBase64 = (b64: string) => new Uint8Array([...atob(b64)].map((c) => c.charCodeAt(0)))

const decrypt = async (body: string, preSharedKey: string, iv: string, authTag: string) => {
  const keyBinary = decodeBase64(preSharedKey)
  const key = await crypto.subtle.importKey('raw', keyBinary, { name: 'AES-GCM' }, false, ['decrypt'])

  const ivBinary = decodeBase64(iv)
  const bodyBinary = decodeBase64(body)
  const authTagBinary = decodeBase64(authTag)

  if (ivBinary.length !== 12 || authTagBinary.length !== 16) {
    console.error('Invalid IV or authTag length')
    return null
  }

  try {
    const fullCiphertext = new Uint8Array([...bodyBinary, ...authTagBinary])

    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBinary }, key, fullCiphertext)
    const message = new TextDecoder().decode(decrypted)
    return JSON.parse(message)
  } catch (error) {
    console.error('Error decrypting message', error)
    return null
  }
}

const emit = async (request: Request, env: Env, stub: DurableObjectStub) => {
  const body = await request.text()
  const iv = request.headers.get('encryption-iv')
  const authTag = request.headers.get('encryption-auth-tag')

  if (!iv || !authTag) return new Response('Missing encryption headers', { status: 403 })

  const firehoseMessage = await decrypt(body, env.PRE_SHARED_KEY, iv, authTag)
  if (!firehoseMessage) return new Response('Invalid encryption', { status: 403 })

  await Promise.all([/*emitToQueue(firehoseMessage, env),*/ emitToWebSocket(firehoseMessage, stub)])
  return new Response(null, { status: 204 })
}

const emitToQueue = async (body: string, env: Env) => {
  await env.QUEUE.send(body)
}

const emitToWebSocket = async (body: string, stub: DurableObjectStub) => {
  return stub.fetch('https://internal/broadcast', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// Worker
export default {
  async fetch(request: Request, env: Env) {
    if (!checkAuth(request, env)) return new Response('Unauthorized', { status: 401 })

    const id = env.WEBSOCKET_SERVER.idFromName('funky-firehose')
    const stub = env.WEBSOCKET_SERVER.get(id)
    // if we have an upgrade header, assume we're trying to connect to the websocket
    if (request.headers.get('Upgrade') === 'websocket') return stub.fetch(request)

    if (request.method === 'POST') return emit(request, env, stub)

    return env.ASSETS.fetch(request)
  },
}

// Durable Object
export class WebSocketServer implements DurableObject {
  private sessions = new Set<WebSocket>()

  constructor(private state: DurableObjectState) {
    this.state.getWebSockets().forEach(this.sessions.add)
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/broadcast') {
      return this.broadcast({
        data: await request.json(),
        metadata: {
          ...Object.fromEntries(request.headers.entries()),
        },
      })
    }
    return this.connect()
  }

  connect() {
    // WebSocket connection handling
    const [client, server] = Object.values(new WebSocketPair())

    server.accept()
    this.sessions.add(server)

    server.addEventListener('close', () => {
      server.close()
      this.sessions.delete(server)
    })

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  broadcast(message: any): Response {
    this.sessions.forEach((webSocket, index) => {
      try {
        webSocket.send(JSON.stringify(message))
      } catch (err) {
        this.sessions.delete(webSocket)
      }
    })

    return new Response(null, { status: 204 })
  }
}
