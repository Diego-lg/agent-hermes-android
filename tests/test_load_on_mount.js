// Simulate the AppProvider's load-on-mount effect and verify that
// after a save+restart cycle, the loaded config replaces the hardcoded
// default correctly. Catches the class of bug where the saved key
// is in storage but the UI keeps showing the empty default.

function makeFileKV(file) {
  const fs = require('fs');
  return {
    async getItem(k) {
      try {
        const all = JSON.parse(fs.readFileSync(file, 'utf8'));
        return all[k] ?? null;
      } catch { return null; }
    },
    async setItem(k, v) {
      let all = {};
      try { all = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
      all[k] = v;
      fs.writeFileSync(file, JSON.stringify(all));
    },
    async removeItem(k) {
      let all = {};
      try { all = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
      delete all[k];
      fs.writeFileSync(file, JSON.stringify(all));
    },
  };
}

const STORAGE_KEYS = { config: 'hermes.config' };
const DEFAULT_CONFIG = {
  host: '192.168.18.54', port: 9119, username: 'diego', password: 'Maggiemon',
  modelBaseUrl: 'https://api.minimax.io/v1', modelId: 'MiniMax-Text-01', engineMode: 'auto',
};
class StoredConfigStore {
  constructor(kv) { this.kv = kv; }
  async load() {
    const raw = await this.kv.getItem(STORAGE_KEYS.config);
    if (!raw) return { ...DEFAULT_CONFIG };
    try { return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }; } catch { return { ...DEFAULT_CONFIG }; }
  }
  async save(cfg) { await this.kv.setItem(STORAGE_KEYS.config, JSON.stringify(cfg)); }
}

// Re-implement the AppProvider's load logic (the useEffect).
async function appProviderOnMount(store) {
  const saved = await store.load();
  const hasUserData =
    (saved.modelApiKey && saved.modelApiKey.length > 0) ||
    (saved.modelGroupId && saved.modelGroupId.length > 0) ||
    saved.host !== '192.168.18.54' ||
    saved.port !== 9119 ||
    saved.username !== 'diego' ||
    saved.password !== 'Maggiemon' ||
    (saved.modelBaseUrl && saved.modelBaseUrl !== 'https://api.minimax.io/v1') ||
    (saved.modelId && saved.modelId !== 'MiniMax-Text-01') ||
    (saved.engineMode && saved.engineMode !== 'auto');
  return hasUserData ? saved : { ...DEFAULT_CONFIG };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}: ${detail}`); fail++; process.exitCode = 1; }
}

const path = require('path');
const fs = require('fs');
const tmpFile = path.join(require('os').tmpdir(), `hermes-load-test-${Date.now()}.json`);

(async () => {
  const kv = makeFileKV(tmpFile);
  const store = new StoredConfigStore(kv);

  console.log('Test A: first launch (no save) → defaults');
  {
    const cfg = await appProviderOnMount(store);
    check('host is default', cfg.host === '192.168.18.54');
    check('no API key', !cfg.modelApiKey);
  }

  console.log('Test B: save then "restart" → loaded');
  {
    await store.save({ ...DEFAULT_CONFIG, modelApiKey: 'sk-saved-key', modelGroupId: 'grp-xyz' });
    // Simulate cold start: new instance, same backing file
    const kv2 = makeFileKV(tmpFile);
    const store2 = new StoredConfigStore(kv2);
    const cfg = await appProviderOnMount(store2);
    check('API key is loaded from storage', cfg.modelApiKey === 'sk-saved-key', `got: ${cfg.modelApiKey}`);
    check('GroupId is loaded from storage', cfg.modelGroupId === 'grp-xyz');
  }

  console.log('Test C: only password changed → loaded');
  {
    await store.save({ ...DEFAULT_CONFIG, password: 'NewSecret99' });
    const kv2 = makeFileKV(tmpFile);
    const store2 = new StoredConfigStore(kv2);
    const cfg = await appProviderOnMount(store2);
    check('changed password survives', cfg.password === 'NewSecret99');
  }

  console.log('Test D: only model id changed → loaded');
  {
    await store.save({ ...DEFAULT_CONFIG, modelId: 'MiniMax-M3-pro' });
    const kv2 = makeFileKV(tmpFile);
    const store2 = new StoredConfigStore(kv2);
    const cfg = await appProviderOnMount(store2);
    check('changed model id survives', cfg.modelId === 'MiniMax-M3-pro');
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  try { fs.unlinkSync(tmpFile); } catch {}
  process.exit(fail ? 1 : 0);
})();
