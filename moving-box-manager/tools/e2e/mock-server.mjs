/**
 * mock-server.mjs — שרת דמה שמחקה את חוזה ה-Apps Script.
 *
 * מאפשר להריץ את בדיקות הדפדפן (app-test.mjs, sync-test.mjs) בלי לפרוס
 * סקריפט אמיתי ובלי לגעת בגיליון של המשפחה. הלוגיקה כאן חייבת להישאר
 * זהה בהתנהגותה ל-backend/Code.gs — במיוחד ביישוב התנגשויות ובחישוב הסמן.
 *
 * הרצה: node tools/e2e/mock-server.mjs   (מאזין ב-http://127.0.0.1:8124)
 */

import http from 'node:http';

const PORT = Number(process.env.PORT || 8124);

let seq = 0;
let nextNumber = 1;
const rows = new Map();

const send = (response, payload) => {
  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  response.end(JSON.stringify(payload));
};

const formatBoxNumber = (number) => 'BOX-' + String(number).padStart(3, '0');

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    let payload = Object.fromEntries(url.searchParams);
    if (body) {
      try {
        payload = JSON.parse(body);
      } catch {
        return send(response, { ok: false, error: 'bad json', code: 'BAD_JSON' });
      }
    }

    switch (payload.action) {
      case 'reset':
        rows.clear();
        seq = 0;
        nextNumber = 1;
        return send(response, { ok: true });

      case 'ping':
        return send(response, { ok: true, rows: rows.size, cursor: seq, nextNumber });

      case 'pull': {
        const since = Number(payload.since) || 0;
        const all = [...rows.values()];
        // הסמן הוא ה-seq הגבוה שנקרא בפועל — כמו בשרת האמיתי
        const cursor = all.reduce((max, row) => Math.max(max, row.seq), since);
        return send(response, { ok: true, boxes: all.filter((row) => row.seq > since), cursor });
      }

      case 'reserve': {
        const count = Math.min(Math.max(Number(payload.count) || 20, 1), 500);
        const from = nextNumber;
        nextNumber += count;
        return send(response, { ok: true, from, to: nextNumber - 1 });
      }

      case 'push': {
        const resolved = [];
        for (const incoming of payload.boxes || []) {
          const existing = rows.get(incoming.id);

          if (!existing) {
            const box = { ...incoming };
            if (!box.number) {
              box.number = nextNumber++;
              box.boxNumber = formatBoxNumber(box.number);
            }
            box.seq = ++seq;
            rows.set(box.id, box);
            resolved.push(box);
          } else if (String(incoming.updatedAt) > String(existing.updatedAt)) {
            const box = {
              ...incoming,
              number: incoming.number || existing.number,
              boxNumber: incoming.boxNumber || existing.boxNumber,
              createdAt: existing.createdAt || incoming.createdAt,
              seq: ++seq,
            };
            rows.set(box.id, box);
            resolved.push(box);
          } else {
            // הגיליון מחזיק בגרסה החדשה יותר
            resolved.push(existing);
          }
        }
        return send(response, { ok: true, boxes: resolved, cursor: seq });
      }

      default:
        return send(response, { ok: false, error: 'unknown action: ' + payload.action, code: 'BAD_ACTION' });
    }
  });
});

server.listen(PORT, () => console.log(`שרת הדמה מאזין ב-http://127.0.0.1:${PORT}`));
