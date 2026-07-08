// Test the four response shapes parseAndEmit has to handle.
// This is a self-contained Node script that doesn't import the
// React-Native-bound ChatEngine.ts; instead it reproduces the parser
// logic and runs the test cases against it. If the parser is correct,
// all four cases should produce a delta callback with the right text
// and never silently succeed on empty input.

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
      const legacyContent = j?.choices?.[0]?.text;
      if (typeof legacyContent === 'string' && legacyContent.length > 0) {
        emit('message.delta', { session_id: sid, payload: { text: legacyContent } });
        append(legacyContent);
        return;
      }
      const finalDelta = j?.choices?.[0]?.delta?.content;
      if (typeof finalDelta === 'string' && finalDelta.length > 0) {
        emit('message.delta', { session_id: sid, payload: { text: finalDelta } });
        append(finalDelta);
        return;
      }
      if (j?.error) {
        const msg = j.error?.message ?? j.error?.code ?? JSON.stringify(j.error);
        emit('error', { session_id: sid, message: `Provider error: ${msg}` });
        return;
      }
    } catch {}
  }

  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const events = normalized.split(/\n\n+/);
  let emittedAny = false;
  for (const event of events) {
    if (!event.trim()) continue;
    const lines = event.split('\n');
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      if (data === '[DONE]') continue;
      let chunk = '';
      let parsed = null;
      try {
        parsed = JSON.parse(data);
        chunk =
          parsed?.choices?.[0]?.delta?.content ??
          parsed?.choices?.[0]?.message?.content ??
          parsed?.choices?.[0]?.text ??
          '';
      } catch { continue; }
      if (typeof chunk === 'string' && chunk.length > 0) {
        emit('message.delta', { session_id: sid, payload: { text: chunk } });
        append(chunk);
        emittedAny = true;
      } else if (parsed && parsed.error) {
        const msg = parsed.error?.message ?? parsed.error?.code ?? JSON.stringify(parsed.error);
        emit('error', { session_id: sid, message: `Provider error (mid-stream): ${msg}` });
        return;
      }
    }
  }
  if (!emittedAny) {
    const preview = trimmed.slice(0, 160).replace(/\n/g, ' ');
    emit('error', { session_id: sid, message: `Could not extract content from provider response. Body starts with: ${preview}` });
  }
}

// ---------- harness ----------
function makeHarness() {
  const events = [];
  let collected = '';
  return {
    events,
    append: (c) => { collected += c; },
    emit: (type, params) => { events.push({ type, params }); },
    text: () => collected,
  };
}

function assert(name, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    console.log(`  FAIL  ${name}: ${detail}`);
    process.exitCode = 1;
  }
}

console.log('Test 1: empty body');
{
  const h = makeHarness();
  parseAndEmit('', 's1', h.append, h.emit);
  assert('emits error event', h.events.length === 1 && h.events[0].type === 'error', JSON.stringify(h.events));
  assert('error mentions empty body', /empty response body/i.test(h.events[0]?.params?.message ?? ''), h.events[0]?.params?.message);
  assert('appends nothing', h.text() === '', `got: ${h.text()}`);
}

console.log('Test 2: non-streaming JSON');
{
  const h = makeHarness();
  const body = JSON.stringify({
    id: 'abc',
    choices: [{ index: 0, message: { role: 'assistant', content: 'Hello from a non-streaming response' }, finish_reason: 'stop' }],
  });
  parseAndEmit(body, 's2', h.append, h.emit);
  assert('emits exactly one delta', h.events.filter(e => e.type === 'message.delta').length === 1, JSON.stringify(h.events));
  assert('text matches', h.text() === 'Hello from a non-streaming response', h.text());
}

console.log('Test 3: SSE stream (OpenAI / MiniMax style)');
{
  const h = makeHarness();
  const body = [
    'data: {"id":"1","choices":[{"index":0,"delta":{"content":"Hello "}}]}',
    '',
    'data: {"id":"2","choices":[{"index":0,"delta":{"content":"world "}}]}',
    '',
    'data: {"id":"3","choices":[{"index":0,"delta":{"content":"!"}}]}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');
  parseAndEmit(body, 's3', h.append, h.emit);
  assert('emits three deltas', h.events.filter(e => e.type === 'message.delta').length === 3, JSON.stringify(h.events));
  assert('text is concatenated', h.text() === 'Hello world !', h.text());
  assert('does NOT emit error', h.events.filter(e => e.type === 'error').length === 0, JSON.stringify(h.events));
}

console.log('Test 4: SSE stream with CRLF line endings');
{
  const h = makeHarness();
  const body = 'data: {"choices":[{"delta":{"content":"a"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"b"}}]}\r\n\r\ndata: [DONE]\r\n\r\n';
  parseAndEmit(body, 's4', h.append, h.emit);
  assert('handles CRLF correctly', h.text() === 'ab', h.text());
}

console.log('Test 5: SSE with mid-stream error event');
{
  const h = makeHarness();
  const body = [
    'data: {"choices":[{"delta":{"content":"partial "}}]}',
    '',
    'data: {"error": {"message": "context length exceeded", "code": "ctx_len"}}',
    '',
  ].join('\n');
  parseAndEmit(body, 's5', h.append, h.emit);
  assert('emits error event', h.events.some(e => e.type === 'error'), JSON.stringify(h.events));
  assert('error mentions context length', /context length/i.test(h.events.find(e => e.type === 'error')?.params?.message ?? ''), 'msg');
}

console.log('Test 6: non-streaming JSON with error object');
{
  const h = makeHarness();
  const body = JSON.stringify({ error: { message: 'invalid API key', code: 'unauthorized' } });
  parseAndEmit(body, 's6', h.append, h.emit);
  assert('emits error event', h.events.some(e => e.type === 'error'), JSON.stringify(h.events));
  assert('error mentions invalid key', /invalid API key/i.test(h.events.find(e => e.type === 'error')?.params?.message ?? ''), 'msg');
}

console.log('Test 7: unrecognized body shape');
{
  const h = makeHarness();
  const body = '<html><body>oops not json</body></html>';
  parseAndEmit(body, 's7', h.append, h.emit);
  assert('emits error event', h.events.some(e => e.type === 'error'), JSON.stringify(h.events));
  assert('error shows body preview', /Body starts with/i.test(h.events.find(e => e.type === 'error')?.params?.message ?? ''), 'msg');
}

console.log('Test 8: legacy text-shape (choices[0].text)');
{
  const h = makeHarness();
  const body = JSON.stringify({ choices: [{ text: 'legacy text response' }] });
  parseAndEmit(body, 's8', h.append, h.emit);
  assert('emits delta', h.events.filter(e => e.type === 'message.delta').length === 1, JSON.stringify(h.events));
  assert('text matches', h.text() === 'legacy text response', h.text());
}

console.log('Test 9: streaming-format final chunk only (no [DONE])');
{
  const h = makeHarness();
  const body = JSON.stringify({ choices: [{ delta: { content: 'just a final chunk' } }] });
  parseAndEmit(body, 's9', h.append, h.emit);
  assert('emits delta', h.events.filter(e => e.type === 'message.delta').length === 1, JSON.stringify(h.events));
  assert('text matches', h.text() === 'just a final chunk', h.text());
}

console.log('Test 10: SSE with non-data lines (heartbeats, comments)');
{
  const h = makeHarness();
  const body = [
    ': OPEN keepalive',
    '',
    'event: ping',
    'data: {"choices":[{"delta":{"content":"after keepalive"}}]}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');
  parseAndEmit(body, 's10', h.append, h.emit);
  assert('ignores non-data lines', h.text() === 'after keepalive', h.text());
}

if (process.exitCode) {
  console.log('\nFAILED');
  process.exit(1);
} else {
  console.log('\nALL PASS');
}
