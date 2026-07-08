# tests/

Standalone Node regression tests for the parts of the Hermes Android
client that don't need a full RN environment to verify.

These are pure-Node scripts (no Jest, no `node_modules`) so they can run
during agent sessions or in CI without a full RN setup. They mirror
the relevant code paths from `src/api/ChatEngine.ts` and
`src/api/configStore.ts`.

## Running

```bash
node tests/test_persistence.js       # config save/load round-trip
node tests/test_load_on_mount.js     # load-on-mount restores saved values
node tests/test_parse.js             # parseAndEmit handles all response shapes
node tests/test_e2e.js               # parser + fake server end-to-end
```

## What each one covers

- **`test_persistence.js`** — verifies `StoredConfigStore` correctly
  round-trips `modelApiKey`, `modelGroupId`, `modelBaseUrl`, `modelId`,
  long keys, special characters, partial saves, and `clear()`. Catches
  regressions where the key is saved but not loaded back (the original
  "key disappears after restart" bug).

- **`test_load_on_mount.js`** — verifies the AppProvider's load-on-mount
  effect correctly distinguishes "first launch" (use defaults) from
  "user configured something" (load saved values). Covers single-field
  changes (only password, only model id) and the "save then cold start"
  round-trip.

- **`test_parse.js`** — unit tests for the SSE/JSON response parser.
  Handles: empty body, non-streaming JSON, SSE stream (LF), SSE with
  CRLF, mid-stream error, top-level error, unrecognized body shape,
  legacy `choices[0].text` format, streaming-format final chunk, and
  keepalive/comment lines. Catches the "empty body silently produces
  empty assistant bubble" class of bug.

- **`test_e2e.js`** — spins up a local HTTP server that mimics the
  MiniMax/OpenAI API surface and runs the parser against real
  network-shaped data. Covers SSE streams, non-streaming JSON, empty
  bodies, error JSON, and the `/models` endpoint that the cloud fetch
  uses.
