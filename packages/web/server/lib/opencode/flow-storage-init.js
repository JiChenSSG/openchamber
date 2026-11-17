import os from 'node:os';
import path from 'node:path';
import { assignInjectedEnv } from '../injected-env.js';
import { resolveFlowStorageEnv } from './flow-storage.js';

// Host file editors and the managed child must capture the same shared config
// root, independently of private Flow data or inherited shell config overrides.
const home = os.homedir();
const root = path.resolve(process.env.OPENCHAMBER_DATA_DIR?.trim() || path.join(home, '.config', 'openchamber-flow'));
export const flowStorageEnv = Object.freeze({
  ...resolveFlowStorageEnv(root),
  OPENCODE_CONFIG_DIR: path.join(home, '.config', 'opencode'),
});
assignInjectedEnv(process.env, { OPENCHAMBER_DATA_DIR: root, ...flowStorageEnv });
