/// <reference types="@cloudflare/workers-types" />

export interface Env {
  WEBSOCKET_SERVER: DurableObjectNamespace
  ASSETS: any
}

const firehoseToWebsocket = async (request: Request, stub: DurableObjectStub) => {
  const body = await request.json()
  return stub.fetch('https://internal/broadcast', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// Worker
export default {
  async fetch(request: Request, env: Env) {
    const id = env.WEBSOCKET_SERVER.idFromName('funky-firehose')
    const stub = env.WEBSOCKET_SERVER.get(id)
    // if we have an upgrade header, assume we're trying to connect to the websocket
    if (request.headers.get('Upgrade') === 'websocket') return stub.fetch(request)

    if (request.method === 'POST') return firehoseToWebsocket(request, stub)

    return env.ASSETS.fetch(request)
  },
}

// Durable Object
export class WebSocketServer implements DurableObject {
  private sessions = new Set<WebSocket>()

  constructor(private state: DurableObjectState) {
    this.state.getWebSockets().forEach((ws) => this.sessions.add(ws))
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
    this.sessions.forEach((webSocket) => {
      try {
        webSocket.send(JSON.stringify(message))
      } catch (err) {
        this.sessions.delete(webSocket)
      }
    })

    return new Response(null, { status: 204 })
  }
}
