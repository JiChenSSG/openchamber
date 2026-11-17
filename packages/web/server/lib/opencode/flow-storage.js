import path from 'node:path';
import { asNonEmptyString } from '../shared/guards.js';

/** Private data paths; shared config selection belongs to early host initialization. */
export const resolveFlowStorageEnv = (dataDir) => {
  const directory = asNonEmptyString(dataDir);
  if (!directory) throw new TypeError('Flow data directory is required');
  const root = path.resolve(directory);
  return Object.freeze({
    XDG_DATA_HOME: root,
    XDG_STATE_HOME: path.join(root, 'state'),
    XDG_CACHE_HOME: path.join(root, 'cache'),
    OPENCODE_DB: path.join(root, 'opencode', 'opencode.db'),
  });
};
