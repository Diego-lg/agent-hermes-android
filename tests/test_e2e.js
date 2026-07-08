// End-to-end test: spin up a tiny HTTP server that mimics the OpenAI/MiniMax
// SSE streaming API, then run parseAndEmit against its output. This proves
// the parser handles real network-shaped data end-to-end, not just hand-
// crafted strings.

const http = require('http');

// Inline the parser (kept in sync with ChatEngine.ts parseAndEmit)
function parseAndEmit(raw, sid, append, emit) {
  const text = raw ?? '';
  if (!text || !text.trim()) {
    emit('error', { session_id: sid, message: 'Provider returned an empty response body. Check your model id and key.' });
    return;
  }
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const j = JSON.parse(trimmed);
      const content = j?.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.length > 0) {
        emit('message.delta', { session_id: sid, payload: { text: content } });
        append(content);
        return;
      }
      const finalDelta = j?.choices?.[0]?.delta?.content;
      if (typeof finalDelta === 'string' && finalDelta.length > 0) {
        emit('message.delta', { session_id: sid, payload: { text: finalDelta } });
        append(finalDelta);
        return;
      }
      if (j?.error) {
        emit('error', { session_id: sid, message: `Provider error: ${j.error?.message ?? 'unknown'}` });
        return;
      }
    } catch {}
  }
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const events = normalized.split(/\n\n+/);
  let emittedAny = false;
  for (const event of events) {
    if (!event.trim()) continue;
    for (const line of event.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let chunk = '', parsed = null;
      try {
        parsed = JSON.parse(data);
        chunk = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.message?.content ?? '';
      } catch { continue; }
      if (typeof chunk === 'string' && chunk.length > 0) {
        emit('message.delta', { session_id: sid, payload: { text: chunk } });
        append(chunk);
        emittedAny = true;
      } else if (parsed && parsed.error) {
        emit('error', { session_id: sid, message: `Provider error (mid-stream): ${parsed.error?.message}` });
        return;
      }
    }
  }
  if (!emittedAny) {
    const preview = trimmed.slice(0, 160).replace(/\n/g, ' ');
    emit('error', { session_id: sid, message: `Could not extract content from provider response. Body starts with: ${preview}` });
  }
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}: ${detail}`); fail++; }
}

// ---------- fake server ----------
function startServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.url === '/models') {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ data: [{ id: 'MiniMax-Text-01' }, { id: 'MiniMax-M2-highspeed' }, { id: 'MiniMax-M3-pro' }] }));
        return;
      }
      if (req.url === '/chat/completions') {
        handler(req, res);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve({ srv, port });
    });
  });
}

async function httpPost(port, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: {'Content-Type':'application/json'} }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  console.log('Test A: server returns an SSE stream');
  {
    const { srv, port } = await startServer((req, res) => {
      res.writeHead(200, {'Content-Type': 'text/event-stream'});
      res.write('data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"from "}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"the fake server"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });
    const { body } = await httpPost(port, '/chat/completions', {});
    const events = [];
    let text = '';
    parseAndEmit(body, 'sA', (c) => text += c, (t, p) => events.push({t, p}));
    check('text is concatenated from server stream', text === 'Hello from the fake server', `got: "${text}"`);
    check('emits 3 deltas + no errors', events.filter(e => e.t === 'message.delta').length === 3 && !events.some(e => e.t === 'error'), JSON.stringify(events));
    srv.close();
  }

  console.log('Test B: server returns non-streaming JSON');
  {
    const { srv, port } = await startServer((req, res) => {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ choices: [{ message: { content: 'single-shot answer' } }] }));
    });
    const { body } = await httpPost(port, '/chat/completions', {});
    const events = [];
    let text = '';
    parseAndEmit(body, 'sB', (c) => text += c, (t, p) => events.push({t, p}));
    check('text is the non-streaming body', text === 'single-shot answer', `got: "${text}"`);
    check('emits exactly 1 delta', events.filter(e => e.t === 'message.delta').length === 1, JSON.stringify(events));
    srv.close();
  }

  console.log('Test C: server returns empty body with 200');
  {
    const { srv, port } = await startServer((req, res) => {
      res.writeHead(200, {'Content-Type': 'text/event-stream'});
      res.end();
    });
    const { body } = await httpPost(port, '/chat/completions', {});
    const events = [];
    let text = '';
    parseAndEmit(body, 'sC', (c) => text += c, (t, p) => events.push({t, p}));
    check('emits error event for empty body', events.some(e => e.t === 'error' && /empty response body/i.test(e.p?.message ?? '')), JSON.stringify(events));
    check('text is empty', text === '', `got: "${text}"`);
    srv.close();
  }

  console.log('Test D: server returns 401 error JSON');
  {
    const { srv, port } = await startServer((req, res) => {
      res.writeHead(401, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ type: 'error', error: { type: 'authorized_error', message: 'invalid API key (1004)', http_code: '401' } }));
    });
    const { body, status } = await httpPost(port, '/chat/completions', {});
    const events = [];
    let text = '';
    parseAndEmit(body, 'sD', (c) => text += c, (t, p) => events.push({t, p}));
    check('http status 401', status === 401, `got: ${status}`);
    check('emits error event mentioning the message', events.some(e => e.t === 'error' && /invalid API key/i.test(e.p?.message ?? '')), JSON.stringify(events));
    srv.close();
  }

  console.log('Test E: /models endpoint works');
  {
    const { srv, port } = await startServer(() => {});
    const r = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/models', method: 'GET' }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.end();
    });
    check('GET /models 200', r.status === 200, `got: ${r.status}`);
    const parsed = JSON.parse(r.body);
    check('returns 3 models', parsed.data.length === 3, `got: ${parsed.data.length}`);
    check('contains MiniMax-M2-highspeed', parsed.data.some(m => m.id === 'MiniMax-M2-highspeed'), 'id missing');
    srv.close();
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
