import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { resolveFlowStorageEnv } from './flow-storage.js';

describe('Flow storage ownership', () => {
  it('keeps database, state and cache under the host data directory', () => {
    const root = path.resolve('flow-fixture');
    const env = resolveFlowStorageEnv(root);
    expect(env.XDG_DATA_HOME).toBe(root);
    expect(path.relative(root, env.OPENCODE_DB).split(path.sep).join('/')).toBe('opencode/opencode.db');
    expect(path.relative(root, env.XDG_STATE_HOME)).toBe('state');
    expect(path.relative(root, env.XDG_CACHE_HOME)).toBe('cache');
    expect(env).not.toHaveProperty('XDG_CONFIG_HOME');
  });

  it.each(['', '   ', null])('rejects a missing storage owner: %s', (root) => {
    expect(() => resolveFlowStorageEnv(root)).toThrow('Flow data directory is required');
  });

  it('pins the shared OpenCode config before host readers while preserving XDG config for other tools', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-storage-'));
    try {
      const data = path.join(root, 'flow');
      const config = path.join(root, 'shared-config');
      const home = path.join(root, 'home');
      const sharedConfig = path.join(home, '.config', 'opencode');
      const inheritedConfig = path.join(root, 'wrong-config');
      fs.mkdirSync(sharedConfig, { recursive: true });
      fs.mkdirSync(inheritedConfig, { recursive: true });
      const original = JSON.stringify({ model: 'shared/config-fixture' });
      fs.writeFileSync(path.join(sharedConfig, 'opencode.json'), original);
      fs.writeFileSync(path.join(inheritedConfig, 'opencode.json'), JSON.stringify({ model: 'private/wrong-root' }));
      const init = new URL('./flow-storage-init.js', import.meta.url).href;
      const shared = new URL('./shared.js', import.meta.url).href;
      const source = `import ${JSON.stringify(init)}; import fs from 'node:fs'; import {getOpenCodeDataDir,OPENCODE_CONFIG_DIR,CONFIG_FILE} from ${JSON.stringify(shared)}; console.log(JSON.stringify({data:process.env.XDG_DATA_HOME,db:process.env.OPENCODE_DB,config:process.env.XDG_CONFIG_HOME,projected:getOpenCodeDataDir(),configDir:OPENCODE_CONFIG_DIR,childConfigDir:process.env.OPENCODE_CONFIG_DIR,model:JSON.parse(fs.readFileSync(CONFIG_FILE,'utf8')).model}));`;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
        encoding: 'utf8', windowsHide: true,
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: home, USERPROFILE: home, OPENCHAMBER_DATA_DIR: data, XDG_DATA_HOME: path.join(root, 'original-data'), XDG_CONFIG_HOME: config, OPENCODE_CONFIG_DIR: inheritedConfig, OPENCODE_DB: path.join(root, 'original.db') },
      });
      expect(child.status, child.stderr).toBe(0);
      expect(JSON.parse(child.stdout.trim())).toEqual({ data, db: path.join(data, 'opencode', 'opencode.db'), config, projected: path.join(data, 'opencode'), configDir: sharedConfig, childConfigDir: sharedConfig, model: 'shared/config-fixture' });
      expect(fs.readFileSync(path.join(sharedConfig, 'opencode.json'), 'utf8')).toBe(original);
      expect(fs.existsSync(path.join(root, 'original.db'))).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
