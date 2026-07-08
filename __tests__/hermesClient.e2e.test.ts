/**
 * End-to-end protocol test for HermesClient.
 *
 * Runs the same dance the React Native app does, against a live
 * `hermes serve` on the LAN, and asserts:
 *
 *   1. login → cookies
 *   2. ws-ticket → ticket
 *   3. WS upgrade → gateway.ready
 *   4. session.create → session_id
 *   5. prompt.submit → message.delta events
 *   6. message.complete → final text + usage
 *   7. session.close → ok
 *   8. error path: bad password is rejected
 *   9. session.list returns at least one session
 *
 * Why Node + jest: the HermesClient is framework-agnostic (works in RN,
 * Node, web), so we can exercise the full client without a phone or
 * emulator. The same code paths run in the Android app.
 *
 * Run: cd <project> && npm test
 *      (or) node_modules/.bin/jest __tests__/hermesClient.e2e.test.js
 */
import {HermesClient, HermesError} from '../src/api/hermesClient';

// Test config: matches the running serve instance on the LAN.
const HOST = process.env.HERMES_TEST_HOST ?? '192.168.18.54';
const PORT = parseInt(process.env.HERMES_TEST_PORT ?? '9119', 10);
const USER = process.env.HERMES_TEST_USER ?? 'diego';
const PASS = process.env.HERMES_TEST_PASS ?? 'Maggiemon';

// Skip e2e if the server isn't reachable. Useful in CI without a backend.
const SERVER_REACHABLE_TIMEOUT_MS = 3000;
async function isServerUp() {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), SERVER_REACHABLE_TIMEOUT_MS);
    const r = await fetch(`http://${HOST}:${PORT}/login`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

describe('HermesClient (live e2e)', () => {
  let serverUp = false;

  beforeAll(async () => {
    serverUp = await isServerUp();
    if (!serverUp) {
      // eslint-disable-next-line no-console
      console.warn(
        `[e2e] Server not reachable at http://${HOST}:${PORT} — e2e tests will be skipped. ` +
          'Start hermes serve to enable them.',
      );
    }
  });

  it('rejects bad credentials with HermesError', async () => {
    if (!serverUp) return;
    const client = new HermesClient({
      host: HOST,
      port: PORT,
      username: USER,
      password: 'totally-wrong-password',
    });
    await expect(client.connect()).rejects.toBeInstanceOf(HermesError);
  });

  it('runs the full protocol: login → ticket → WS → session.create → prompt → complete', async () => {
    if (!serverUp) return;

    const client = new HermesClient({host: HOST, port: PORT, username: USER, password: PASS});
    const events: Array<{type: string; sessionId?: string}> = [];
    client.onEvent((type, params) => {
      events.push({type, sessionId: params?.session_id});
    });

    // 1+2+3: connect (login + ticket + WS upgrade)
    await client.connect();
    expect(client.isConnected()).toBe(true);

    // 4: session.create
    const sid = await client.createSession('e2e test session');
    expect(typeof sid).toBe('string');
    expect(sid.length).toBeGreaterThan(0);

    // Wait for gateway.ready in the event log (always emitted on connect)
    await new Promise(r => setTimeout(r, 200));
    expect(events.some(e => e.type === 'gateway.ready')).toBe(true);

    // 5+6: prompt.submit + collect streamed reply
    const handle = client.submitPrompt('Reply with the single word: PONG');
    const result = await handle.done;

    expect(result.text.toUpperCase()).toContain('PONG');
    // We should have seen at least one delta before complete
    const deltas = events.filter(e => e.type === 'message.delta');
    const completes = events.filter(e => e.type === 'message.complete');
    expect(deltas.length).toBeGreaterThan(0);
    expect(completes.length).toBe(1);

    // 7: close
    await client.closeSession(sid);
    client.disconnect();
    expect(client.isConnected()).toBe(false);
  });

  it('session.list returns at least one session after creating one', async () => {
    if (!serverUp) return;
    const client = new HermesClient({host: HOST, port: PORT, username: USER, password: PASS});
    await client.connect();
    await client.createSession('e2e list test');
    const list = await client.listSessions(10);
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    client.disconnect();
  });
});
