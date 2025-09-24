import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

export interface WsHub {
  broadcastFetchedRoll(payload: {
    userId: string; roll: string; type: 'upgrade' | 'case'; data: any; processedAt: string;
  }): void;
  broadcastQueuedRoll(payload: {
    id: number; userId: string; roll: string; type: 'upgrade' | 'case'; createdAt: string;
  }): void;
}

export function createWsHub(server: HttpServer, { path = '/ws' } = {}): WsHub {
  const wss = new WebSocketServer({ server, path });

  wss.on('connection', (ws) => {
    try { ws.send(JSON.stringify({ event: 'hello', ts: Date.now() })); } catch {}
  });

  function safeBroadcast(obj: any) {
    const msg = JSON.stringify(obj);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(msg); } catch {}
      }
    }
  }

  return {
    broadcastFetchedRoll(payload) {
      safeBroadcast({ event: 'fetched_roll', payload });
    },
    broadcastQueuedRoll(payload) {
      safeBroadcast({ event: 'queued_roll', payload });
    }
  };
}
