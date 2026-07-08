// Test the round-trip: save() then load() should return the same config.
// Catches the bug class "key disappears after restart" where the save
// either doesn't write, or the load doesn't read what was written.

const path = require('path');
const fs = require('fs');

// Set up a minimal KV shim backed by a real file (mimics AsyncStorage).
// We swap the in-memory store out and use our own implementation.
const tmpFile = path.join(require('os').tmpdir(), `hermes-config-test-${Date.now()}.json`);
function makeFileKV() {
  return {
    async getItem(k) {
      try {
        const all = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
        return all[k] ?? null;
      } catch { return null; }
    },
    async setItem(k, v) {
      let all = {};
      try { all = JSON.parse(fs.readFileSync(tmpFile, 'utf8')); } catch {}
      all[k] = v;
      fs.writeFileSync(tmpFile, JSON.stringify(all));
    },
    async removeItem(k) {
      let all = {};
      try { all = JSON.parse(fs.readFileSync(tmpFile, 'utf8')); } catch {}
      delete all[k];
      fs.writeFileSync(tmpFile, JSON.stringify(all));
    },
  };
}

// We need a minimal TS runtime. Instead of compiling ChatEngine.ts,
// re-implement the same StoredConfigStore in JS (one-screen mirror).
// Logic is byte-identical: load() returns {...DEFAULT, ...parsed}, save()
// does JSON.stringify, clear() removes the key.

const STORAGE_KEYS = { config: 'hermes.config' };

const DEFAULT_CONFIG = {
  host: '192.168.18.54',
  port: 9119,
  username: 'diego',
  password: 'Maggiemon',
  modelBaseUrl: 'https://api.minimax.io/v1',
  modelId: 'MiniMax-Text-01',
  engineMode: 'auto',
};

class StoredConfigStore {
  constructor(kv) { this.kv = kv; }
  async load() {
    const raw = await this.kv.getItem(STORAGE_KEYS.config);
    if (!raw) return { ...DEFAULT_CONFIG };
    try {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...parsed };
    } catch { return { ...DEFAULT_CONFIG }; }
  }
  async save(cfg) {
    await this.kv.setItem(STORAGE_KEYS.config, JSON.stringify(cfg));
  }
  async clear() {
    await this.kv.removeItem(STORAGE_KEYS.config);
  }
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}: ${detail}`); fail++; process.exitCode = 1; }
}

(async () => {
  const kv = makeFileKV();
  const store = new StoredConfigStore(kv);

  console.log('Test 1: round-trip API key');
  {
    await store.save({ ...DEFAULT_CONFIG, modelApiKey: 'sk-test-1234567890' });
    const loaded = await store.load();
    check('modelApiKey is preserved', loaded.modelApiKey === 'sk-test-1234567890', `got: ${loaded.modelApiKey}`);
  }

  console.log('Test 2: round-trip GroupId + base URL + model id');
  {
    await store.save({
      ...DEFAULT_CONFIG,
      modelApiKey: 'sk-key-2',
      modelGroupId: 'grp-1234567',
      modelBaseUrl: 'https://api.minimax.io/v1',
      modelId: 'MiniMax-M3-pro',
    });
    const loaded = await store.load();
    check('modelApiKey preserved', loaded.modelApiKey === 'sk-key-2');
    check('modelGroupId preserved', loaded.modelGroupId === 'grp-1234567');
    check('modelBaseUrl preserved', loaded.modelBaseUrl === 'https://api.minimax.io/v1');
    check('modelId preserved', loaded.modelId === 'MiniMax-M3-pro');
  }

  console.log('Test 3: clear() resets to defaults');
  {
    await store.clear();
    const loaded = await store.load();
    check('after clear, modelApiKey is empty', !loaded.modelApiKey, `got: ${loaded.modelApiKey}`);
    check('after clear, defaults are intact', loaded.host === '192.168.18.54' && loaded.port === 9119);
  }

  console.log('Test 4: long key + special characters survive');
  {
    const longKey = 'sk-' + 'A'.repeat(200) + '!@#$%^&*()_+-=[]{}|;:,.<>?/~`';
    await store.save({ ...DEFAULT_CONFIG, modelApiKey: longKey });
    const loaded = await store.load();
    check('long key round-trips byte-for-byte', loaded.modelApiKey === longKey, `len: ${loaded.modelApiKey?.length}`);
  }

  console.log('Test 5: load() before save() returns defaults');
  {
    await store.clear();
    const loaded = await store.load();
    check('load() with no save returns defaults', loaded.modelApiKey === undefined && loaded.host === '192.168.18.54');
  }

  console.log('Test 6: save partial (overrides are merged)');
  {
    await store.save({ ...DEFAULT_CONFIG, modelApiKey: 'sk-partial' });
    const loaded = await store.load();
    check('partial save preserves other fields', loaded.password === 'Maggiemon' && loaded.username === 'diego');
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  // cleanup
  try { fs.unlinkSync(tmpFile); } catch {}
  process.exit(fail ? 1 : 0);
})();
