import { randomBytes } from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

// Claude'un HTTP hook'ları bu yerel sunucuya olay gönderir (istem gönderildi, araç çalıştı,
// izin istendi, bitti). Hangi pane'den geldiği SUPERAGENT_PANE ortam değişkeninden, başlıkla gelir.
// Durumu ekran metninden tahmin etmek yerine Claude'un kendisinden öğrenmemizi sağlar.

export interface HookEvent {
  key: string;
  event: string;
  sessionId?: string;
  notificationType?: string;
  toolName?: string;
}

let url: string | null = null;

/** Hook'ların gönderileceği adres; sunucu başlamadıysa null. */
export const hookUrl = () => url;

export function startHookServer(onEvent: (e: HookEvent) => void): Promise<void> {
  const path = `/hook/${randomBytes(16).toString('hex')}`;
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== path) {
      res.statusCode = 404;
      res.end();
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (d: string) => {
      body += d;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      // Boş nesne: hook hiçbir karar vermiyor, Claude normal akışına devam ediyor.
      res.setHeader('content-type', 'application/json');
      res.end('{}');
      try {
        const j = JSON.parse(body);
        onEvent({
          key: String(req.headers['x-superagent-pane'] ?? ''),
          event: String(j.hook_event_name ?? ''),
          sessionId: j.session_id,
          notificationType: j.notification_type,
          toolName: j.tool_name,
        });
      } catch {
        /* yoksay */
      }
    });
  });
  return new Promise((resolve) => {
    server.on('error', () => resolve());
    server.listen(0, '127.0.0.1', () => {
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`;
      resolve();
    });
  });
}
