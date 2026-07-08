# Hermes Agent — Android client (v0.4.0)

LAN-only React Native mobile client for your desktop [Hermes Agent](https://github.com/just-every/hermes-mcp) `serve` instance. Industrial / terminal-style dark UI on true OLED black.

| Platform | Status |
|---|---|
| Android | ✅ Built, tested on Pixel 9 Pro, sideloaded APK works |
| iOS | 🚧 Not built (JS code is iOS-ready; needs `ios/` shell from `@react-native-community/cli init`) |

## What it does

- **Auth dance**: basic-auth login → single-use WS ticket → JSON-RPC over WebSocket against `hermes serve` (the full `password-login` → `ws-ticket` → `/api/ws?ticket=…` → `gateway.ready` flow).
- **Streaming chat**: subscribes to `message.delta` / `message.complete` events, renders the in-flight reply as a blinking terminal cursor.
- **Tool events**: surfaces `tool.start` notifications as a log-style line under the chat (`[hh:mm:ss] ⎔ terminal ls -la`).
- **Sessions**: lists recent sessions from `session.list`, resumes with `session.history`, opens a new one with `session.create`.
- **Agent catalog**: 6 pre-baked sub-agents (PC Controller, Coder, Researcher, Writer, Analyst, Home). Each launches a chat pre-loaded with its system prompt.
- **Dashboard**: live model stats from `session.usage`, active sub-agents from `delegation.status`.
- **Persistence**: server host/port/credentials and recent-sessions cache via AsyncStorage.

## Wire protocol

Documented in `references/wire-protocol.md` (from the `hermes-external-clients` skill). The relevant methods used by this client:

```
session.create / session.list / session.history / session.close
session.usage / session.title
prompt.submit
delegation.status
project.facts
```

Server events handled: `gateway.ready`, `session.info`, `message.start`, `message.delta`, `message.complete`, `reasoning.delta`, `tool.start`, `tool.stop`, `error`.

## Project layout

```
android-hermes/
├── App.tsx                          # Shell: AppProvider + 5-tab bottom nav
├── index.js                         # AppRegistry entry
├── app.json                         # { "name": "android-hermes" }
├── package.json                     # RN 0.76.5, AsyncStorage, react-native-svg
├── babel.config.js, metro.config.js, jest.config.js, tsconfig.json
│
├── src/
│   ├── api/
│   │   ├── hermesClient.ts          # Core client — auth + WS + JSON-RPC + streaming
│   │   ├── configStore.ts           # AsyncStorage-backed AppConfig
│   │   └── storage.ts               # AsyncStorage wrapper (memory shim for tests)
│   ├── agents/
│   │   └── catalog.ts               # 6 pre-baked sub-agent definitions
│   └── ui/
│       ├── theme.ts                 # Industrial design tokens (OLED black, mono, tabular)
│       ├── icons.tsx                # Hand-rolled Lucide-style SVG icons
│       ├── atoms.tsx                # Card, Field, Button primitives
│       ├── AppContext.tsx           # Single React context: client, auth, screen state
│       ├── BottomNav.tsx            # 5-tab industrial nav (▬ indicator + 00..04 numerals)
│       ├── HomeScreen.tsx           # Terminal-style dashboard
│       ├── ChatScreen.tsx           # Streaming chat, mono log layout
│       ├── AgentsScreen.tsx         # Agent list
│       ├── SettingsScreen.tsx       # Config-file aesthetic + slide-to-sign-out
│       ├── ProfileScreen.tsx        # Terminal status
│       └── LoginScreen.tsx          # Industrial login
│
├── __tests__/
│   ├── hermesClient.unit.test.ts    # 4 unit tests (offline)
│   └── hermesClient.e2e.test.ts     # 3 e2e tests (live server)
│
└── android/                         # Native Android shell (RN 0.76 template)
    ├── app/src/main/java/com/diego/androidhermes/  # MainActivity, MainApplication
    ├── app/src/main/AndroidManifest.xml              # cleartext + networkSecurityConfig
    ├── app/src/main/res/xml/network_security_config.xml
    ├── app/build.gradle                            # namespace com.diego.androidhermes
    └── ...
```

## Building

Requires Java 17 (`C:\Java\jdk-17` in this repo's known setup), Android SDK with `platforms;android-35` and `build-tools;35.0.0`, and `node` 18+.

```bash
# 1. Install JS deps
npm install

# 2. Run tests (7/7, includes e2e against a running hermes serve)
npx jest

# 3. Build the debug APK
cd android
JAVA_HOME="C:/Java/jdk-17" ANDROID_HOME="C:/Android/sdk" ./gradlew assembleDebug

# 4. Sideload
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.diego.androidhermes/.MainActivity
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk` (~141 MB, 4 ABIs).

## Configuration

Default `~/.hermes/config.yaml` for the host:

```yaml
dashboard:
  basic_auth:
    username: diego
    password_hash: "scrypt$16384$8$1$..."
    session_ttl_seconds: 43200
```

The `hermes serve` command must export the password as a shell env var (the basic-auth plugin has `requires_env: [HERMES_DASHBOARD_BASIC_AUTH_USERNAME]` in its `plugin.yaml`, which only checks the *shell* env, not `.env` or `config.yaml`):

```bash
HERMES_DASHBOARD_BASIC_AUTH_USERNAME=*** HERMES_DASHBOARD_BASIC_AUTH_PASSWORD='***' \
  hermes serve --host 0.0.0.0 --port 9119
```

## Cleartext traffic

The Android app's `network_security_config.xml` allows cleartext to **all** hosts (LAN-only dev convenience). For anything beyond your home network, put Hermes behind Tailscale or a Cloudflare Tunnel and tighten the network config.

## Tests

```bash
npx jest                        # 7/7 — 4 unit + 3 e2e (against live server)
```

The e2e suite skips itself if `http://<host>:9119/login` is unreachable, so it works in CI without a backend.

## License

MIT.
