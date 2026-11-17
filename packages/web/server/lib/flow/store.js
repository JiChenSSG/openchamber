import crypto from 'node:crypto';
import { requirementSchema, templateSchema, defaultTemplate } from './contracts.js';

/** One atomic file per requirement. A failed write never publishes its draft. */
export const createFlowStore = ({ fsPromises: fs, path, dataDir }) => {
  const root = path.join(dataDir, 'flow');
  const records = new Map();
  let template;
  let errors = [];
  let loaded;
  let chain = Promise.resolve();
  const load = () => loaded ??= (async () => {
    let entries;
    try { entries = await fs.readdir(root); }
    catch (error) { if (error.code !== 'ENOENT') throw error; entries = []; }
    const found = new Map();
    const failures = [];
    let config = defaultTemplate();
    for (const name of entries.filter((name) => /^flw_[a-f0-9]{32}\.json$/.test(name) || name === 'template.json')) {
      try {
        const raw = JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));
        if (name === 'template.json') config = templateSchema.parse(raw);
        else {
          const value = requirementSchema.parse(raw);
          if (`${value.id}.json` !== name) throw new Error('Requirement identity differs from filename');
          found.set(value.id, value);
        }
      } catch (error) { failures.push(`${name}: ${error.message}`); }
    }
    for (const [id, record] of found) records.set(id, record);
    errors = failures;
    template = config;
  })().catch((error) => { loaded = undefined; throw error; });
  const serialize = (operation) => {
    const result = chain.then(async () => { await load(); return operation(); });
    chain = result.catch(() => {});
    return result;
  };
  const write = async (name, value) => {
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const target = path.join(root, name);
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
      await fs.rename(temporary, target);
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  };
  return {
    async list(directory) {
      await load();
      return { requirements: structuredClone([...records.values()].filter((record) => record.directory === directory).sort((a, b) => b.createdAt - a.createdAt)), errors: [...errors] };
    },
    async get(id) { await load(); return structuredClone(records.get(id) ?? null); },
    async template() { await load(); return structuredClone(template); },
    setTemplate(value) { return serialize(async () => {
      if (errors.some((error) => error.startsWith('template.json:'))) throw new Error('The saved template needs repair before replacement');
      const next = templateSchema.parse(value);
      await write('template.json', next);
      template = next;
      return structuredClone(next);
    }); },
    create(value) { return serialize(async () => {
      const next = requirementSchema.parse(value);
      if (records.has(next.id)) throw new Error('Requirement already exists');
      await write(`${next.id}.json`, next);
      records.set(next.id, next);
      return structuredClone(next);
    }); },
    update(id, change, revision) { return serialize(async () => {
      const previous = records.get(id);
      if (!previous) throw Object.assign(new Error('Requirement not found'), { statusCode: 404 });
      if (revision !== undefined && previous.revision !== revision) throw Object.assign(new Error('Requirement changed; refresh before trying again'), { statusCode: 409 });
      const draft = structuredClone(previous);
      change(draft);
      draft.revision += 1;
      draft.updatedAt = Date.now();
      const next = requirementSchema.parse(draft);
      await write(`${id}.json`, next);
      records.set(id, next);
      return structuredClone(next);
    }); },
    async all() { await load(); return structuredClone([...records.values()]); },
    flush: () => chain,
  };
};
