import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFlowStore } from './store.js';
import { createFlowRuntime } from './runtime.js';
import { defaultTemplate } from './contracts.js';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
const notes = { summary: 'Verified result', evidence: ['fixture validation passed'] };
const spec = { ...notes, content: 'Deliver the requested behavior', acceptance: ['Requested behavior works'] };
const ticket = (id, blockedBy = []) => ({ id, title: id, description: `Deliver ${id}`, acceptance: ['Behavior works'], blockedBy });
const cleanReview = { ...notes, complete: true, findings: [], suggestions: ['Optional improvement'] };
const issue = { file: 'module.js:5', scenario: 'Normal input', cause: 'Incorrect output', fix: 'Correct the output' };

const harness = async ({ results = {}, resultFactories = {}, limit = 3, decisions, fsImpl = fs, isEnabled = async () => true, runStep, generate, worktrees, duringNode } = {}) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-runtime-'));
  roots.push(root);
  const store = createFlowStore({ fsPromises: fsImpl, path, dataDir: root });
  const calls = [];
  const sessions = [];
  const completed = new Map();
  const routerInputs = [];
  const liveSessions = new Map();
  const workflows = { isAgentRunning: (runId, sessionId) => liveSessions.get(runId) === sessionId, async runStep(input) {
    if (input.runId && completed.has(input.runId)) return completed.get(input.runId);
    calls.push({ node: input.options.label.split(':')[0], model: input.options.model, skills: input.options.skills });
    await input.onRun(`wf_fixture${calls.length}`);
    await input.onStart();
    const node = calls.at(-1).node;
    const runId = `wf_fixture${calls.length}`;
    const sessionId = `child-${calls.length}`;
    liveSessions.set(runId, sessionId);
    try { await duringNode?.({ ...input, node, sessionId }); }
    finally { liveSessions.delete(runId); }
    const result = resultFactories[node]?.(calls.filter((entry) => entry.node === node).length) ?? results[node];
    const output = { runId: `wf_fixture${calls.length}`, result: result ?? ({ spec, tickets: { ...notes, tickets: [ticket('T1')] }, review: cleanReview, verify: cleanReview }[node] ?? notes) };
    completed.set(output.runId, output);
    return output;
  } };
  const dependencies = {
    store, workflows: runStep ? { runStep } : workflows, isEnabled,
    agentSessions: { createSession: async ({ directory }) => { sessions.push(directory); return 'owner-fixture'; } },
    worktrees: worktrees ?? { isGitRepository: async () => true, create: async () => ({ directory: '/fixture-worktree' }) },
    generate: generate ?? (async (input) => {
      routerInputs.push(input);
      const snapshot = JSON.parse(input.prompt);
      const action = decisions?.(snapshot) ?? snapshot.allowedActions.find((entry) => entry.node === 'spec') ?? snapshot.allowedActions[0];
      return { text: JSON.stringify({ ...action, reason: 'Choose the legal next action' }) };
    }),
  };
  const runtime = createFlowRuntime(dependencies);
  const config = defaultTemplate();
  config.maxReviewRounds = limit;
  config.clarification = 'skip';
  config.nodes.review.model = 'fixture/reviewer';
  config.nodes.review.variant = 'fast';
  const requirement = await runtime.create({ directory: '/fixture', title: 'Feature', task: 'Deliver a feature', config });
  return { runtime, store, requirement, calls, routerInputs, root, completed, sessions,
    reopen: () => createFlowRuntime({ ...dependencies, store: createFlowStore({ fsPromises: fs, path, dataDir: root }) }),
  };
};

describe('Flow task delivery', () => {
  it('uses built-in planning for saved skill selections while retaining custom additions', async () => {
    const { runtime } = await harness();
    const config = defaultTemplate();
    config.nodes.spec.skills = ['to-spec', 'project-rules'];
    config.nodes.tickets.skills = ['to-tickets'];
    config.nodes.spec.prompt = 'Include the project accessibility requirements';
    const record = await runtime.create({ directory: '/fixture', title: 'Planning', task: 'Add a greeting', config });
    expect(record.config.nodes.spec).toMatchObject({ skills: ['project-rules'], prompt: 'Include the project accessibility requirements' });
    expect(record.config.nodes.tickets.skills).toEqual([]);
    expect((await runtime.template()).nodes.spec.skills).toEqual([]);
  });

  it('shares confirmed handoffs across Tickets and restores every version without board document bodies', async () => {
    let runtime;
    let requirementId;
    let consumed;
    const fixture = await harness({
      results: { tickets: { ...notes, tickets: [ticket('T1'), ticket('T2', ['T1'])] } },
      duringNode: async ({ node, options, sessionId }) => {
        if (node !== 'develop') return;
        if (options.label === 'develop: T2') {
          consumed = await runtime.executeAction('flow.document.read', { requirementId, documentId: 'implementation-notes' }, { sessionId });
          return;
        }
        const write = (version, content) => runtime.executeAction('flow.document.write', {
          requirementId, documentId: 'implementation-notes', version, title: 'Implementation notes', kind: 'handoff', content,
        }, { sessionId });
        await write(0, '\nFirst implementation findings\n');
        await write(1, 'Confirmed API behavior for the dependent Ticket');
        await expect(write(1, 'A stale overwrite')).rejects.toMatchObject({ statusCode: 409 });
      },
    });
    ({ runtime } = fixture);
    requirementId = fixture.requirement.id;
    await runtime.start(requirementId);
    let record = await runtime.waitForIdle(requirementId);
    await runtime.accept(requirementId, 'T1', record.revision);
    await runtime.start(requirementId);
    record = await runtime.waitForIdle(requirementId);
    expect(consumed).toMatchObject({ version: 2, status: 'confirmed', ticketId: 'T1', node: 'develop', content: 'Confirmed API behavior for the dependent Ticket' });
    expect(record.tickets.find((entry) => entry.id === 'T2').state).toBe('acceptance');
    const reopened = fixture.reopen();
    const metadata = (await reopened.documents(requirementId)).documents;
    expect(metadata.filter((entry) => entry.id === 'implementation-notes')).toMatchObject([{ version: 1 }, { version: 2 }]);
    expect(metadata.every((entry) => !('content' in entry))).toBe(true);
    expect(await reopened.document(requirementId, { documentId: 'implementation-notes', version: 1 })).toMatchObject({ content: '\nFirst implementation findings\n' });
    expect(metadata.filter((entry) => entry.id === 'result-develop-T1')).toHaveLength(1);
    expect((await reopened.list('/fixture')).requirements[0].documents.every((entry) => !('content' in entry))).toBe(true);
  });

  it('loads a legacy requirement without documents and resolves its shipped planning default locally', async () => {
    const { requirement, root, reopen } = await harness();
    const legacy = structuredClone(requirement);
    delete legacy.documents;
    legacy.config.nodes.spec.skills = ['to-spec'];
    legacy.config.nodes.tickets.skills = ['to-tickets'];
    legacy.config.nodes.spec.prompt = 'Use the selected to-spec skill to produce a specification from the task, research and confirmed decisions. Include scope, non-goals, user behavior and verifiable acceptance. Return the specification as content. Flow uses its local board as tracker: do not publish externally or modify project files.';
    await fs.writeFile(path.join(root, 'flow', `${legacy.id}.json`), JSON.stringify(legacy));
    const board = await reopen().list('/fixture');
    expect(board.errors).toEqual([]);
    expect(board.requirements[0].documents).toEqual([]);
    expect(board.requirements[0].config.nodes.spec.skills).toEqual([]);
    expect(board.requirements[0].config.nodes.tickets.skills).toEqual([]);
    expect(board.requirements[0].config.nodes.spec.prompt).not.toContain('selected to-spec skill');
  });

  it('replays a completed node after an archive write failure without duplicating its report', async () => {
    let failWrite = false;
    const fixture = await harness({
      fsImpl: { ...fs, rename: async (...args) => { if (failWrite) throw new Error('disk unavailable'); return fs.rename(...args); } },
      duringNode: async ({ node }) => { if (node === 'spec') failWrite = true; },
    });
    const id = fixture.requirement.id;
    await fixture.runtime.start(id);
    await fixture.runtime.waitForIdle(id);
    expect((await fixture.store.get(id)).documents).toEqual([]);
    failWrite = false;
    const restored = fixture.reopen();
    await restored.start(id);
    await restored.waitForIdle(id);
    const reports = (await restored.documents(id)).documents.filter((entry) => entry.id === 'result-spec-requirement');
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ version: 1, status: 'confirmed' });
    expect(fixture.calls.filter((entry) => entry.node === 'spec')).toHaveLength(1);
  });

  it('rejects unrelated sessions, expired stages, owner writes and reserved document names', async () => {
    let runtime;
    let id;
    let otherId;
    let endedSession;
    const fixture = await harness({ duringNode: async ({ node, sessionId }) => {
      if (node !== 'spec') return;
      endedSession = sessionId;
      await expect(runtime.executeAction('flow.document.list', { requirementId: otherId }, { sessionId })).rejects.toMatchObject({ statusCode: 403 });
      await expect(runtime.executeAction('flow.document.write', { requirementId: id, documentId: 'result-spec-requirement', version: 0, title: 'Forged report', kind: 'spec', content: 'Forged' }, { sessionId })).rejects.toMatchObject({ statusCode: 400 });
      await expect(runtime.executeAction('flow.document.read', { requirementId: id, documentId: '../escape' }, { sessionId })).rejects.toMatchObject({ statusCode: 400 });
      await expect(runtime.executeAction('flow.document.write', { requirementId: id, documentId: 'oversize', version: 0, title: 'Oversize', kind: 'note', content: 'x'.repeat(64_001) }, { sessionId })).rejects.toMatchObject({ statusCode: 400 });
    } });
    ({ runtime } = fixture);
    id = fixture.requirement.id;
    otherId = (await runtime.create({ directory: '/other', title: 'Other', task: 'Other requirement' })).id;
    await expect(runtime.executeAction('flow.document.list', { requirementId: id }, { sessionId: 'unrelated' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(runtime.executeAction('flow.document.write', { requirementId: id }, { sessionId: fixture.requirement.sessionId })).rejects.toMatchObject({ statusCode: 403 });
    await runtime.start(id);
    await runtime.waitForIdle(id);
    await expect(runtime.executeAction('flow.document.list', { requirementId: id }, { sessionId: endedSession })).rejects.toMatchObject({ statusCode: 403 });
    expect((await runtime.executeAction('flow.document.list', { requirementId: id }, { sessionId: fixture.requirement.sessionId })).documents.length).toBeGreaterThan(0);
  });

  it('retains failed-stage notes as drafts and never replaces them with a failed write', async () => {
    let runtime;
    let id;
    let failWrite = false;
    const fixture = await harness({
      fsImpl: { ...fs, rename: async (...args) => { if (failWrite) throw new Error('disk unavailable'); return fs.rename(...args); } },
      results: { spec: { ...spec, evidence: [] } },
      duringNode: async ({ node, sessionId }) => {
        if (node !== 'spec') return;
        const input = { requirementId: id, documentId: 'research-notes', version: 0, title: 'Research notes', kind: 'research', content: 'Observed project facts' };
        await runtime.executeAction('flow.document.write', input, { sessionId });
        failWrite = true;
        try { await expect(runtime.executeAction('flow.document.write', { ...input, version: 1, content: 'Uncommitted replacement' }, { sessionId })).rejects.toThrow('disk unavailable'); }
        finally { failWrite = false; }
      },
    });
    ({ runtime } = fixture);
    id = fixture.requirement.id;
    await runtime.start(id);
    const record = await runtime.waitForIdle(id);
    expect(record.state).toBe('attention');
    expect(record.documents).toMatchObject([{ id: 'research-notes', version: 1, status: 'draft', content: 'Observed project facts' }]);
    expect(await fixture.reopen().document(id, { documentId: 'research-notes' })).toMatchObject({ version: 1, status: 'draft', content: 'Observed project facts' });
    await expect(runtime.document(id, { documentId: 'result-spec-requirement' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('generates a title and goal from a description while retaining the original request across restart', async () => {
    const { runtime, reopen } = await harness({ generate: async () => ({ text: JSON.stringify({ title: 'Greeting file', goal: 'Create greeting.txt with exactly Hello flow.' }) }) });
    const task = 'Please create greeting.txt containing exactly Hello flow. Keep the README unchanged.';
    const record = await runtime.create({ directory: '/fixture', task });
    expect(record).toMatchObject({ title: 'Greeting file', goal: 'Create greeting.txt with exactly Hello flow.', task, state: 'todo' });
    const restored = await reopen().list('/fixture');
    expect(restored.requirements.find((entry) => entry.id === record.id)).toMatchObject({ title: record.title, goal: record.goal, task });
  });

  it.each(['unavailable', 'malformed', 'invalid'])('creates no workspace or requirement when intake is %s', async (mode) => {
    let workspaces = 0;
    const { runtime, store } = await harness({
      generate: async () => {
        if (mode === 'unavailable') throw new Error('Model unavailable');
        return { text: mode === 'malformed' ? 'not json' : JSON.stringify({ title: 'Title without a goal' }) };
      },
      worktrees: { isGitRepository: async () => true, create: async () => { workspaces += 1; return { directory: '/fixture-worktree' }; } },
    });
    await expect(runtime.create({ directory: '/fixture', task: 'Describe the new behavior' })).rejects.toThrow();
    expect(workspaces).toBe(1);
    expect(await store.all()).toHaveLength(1);
  });

  it('refuses failed isolation without admitting a session in the checkout', async () => {
    let rejectWorktree = false;
    const { runtime, store, sessions } = await harness({ worktrees: {
      isGitRepository: async () => true,
      create: async () => { if (rejectWorktree) throw new Error('Git worktree creation failed'); return { directory: '/fixture-worktree' }; },
    } });
    rejectWorktree = true;
    await expect(runtime.create({ title: 'Blocked', task: 'Do not use the checkout', directory: '/fixture' })).rejects.toThrow('Git worktree creation failed');
    expect(await store.all()).toHaveLength(1);
    expect(sessions).toEqual(['/fixture-worktree']);
  });

  it('continues execution after the board submits clarification answers', async () => {
    const { runtime, requirement } = await harness({
      decisions: (state) => state.allowedActions.find((entry) => entry.node === 'clarify') ?? state.allowedActions[0],
      resultFactories: { clarify: (attempt) => ({ ...notes, questions: attempt === 1 ? ['Which greeting?'] : [] }) },
    });
    const record = await runtime.create({ directory: '/fixture', title: 'Greeting', task: 'Write a greeting', config: { ...requirement.config, clarification: 'auto' } });
    await runtime.start(record.id);
    const waiting = await runtime.waitForIdle(record.id);
    await runtime.answer(waiting.id, ['Hello flow'], waiting.revision, true);
    const resumed = await runtime.waitForIdle(record.id);
    expect(resumed).toMatchObject({ questions: [], answers: [{ question: 'Which greeting?', answer: 'Hello flow' }] });
    expect(resumed.tickets[0]).toMatchObject({ id: 'T1', state: 'acceptance' });
  });

  it('pauses an empty-evidence clarification without advancing to specification', async () => {
    const { runtime, requirement, calls } = await harness({
      decisions: (state) => state.allowedActions.find((entry) => entry.node === 'clarify') ?? state.allowedActions[0],
      results: { clarify: { summary: 'Filename needs confirmation', evidence: [], questions: ['Which filename?'] } },
    });
    const record = await runtime.create({ directory: '/fixture', title: 'Greeting', task: 'Confirm the filename first', config: { ...requirement.config, clarification: 'auto' } });
    await runtime.start(record.id);
    const waiting = await runtime.waitForIdle(record.id);
    expect(waiting).toMatchObject({ state: 'attention', questions: [], pending: null });
    expect(waiting.error).toContain('evidence');
    expect(calls.map((entry) => entry.node)).toEqual(['clarify']);
  });

  it('stops a board node through the tool and retains its checkpoint', async () => {
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });
    const { runtime, requirement } = await harness({ runStep: async ({ onRun, onStart, signal }) => {
      await onRun('wf_paused');
      await onStart();
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Node interrupted')), { once: true });
        markStarted();
      });
    } });
    await runtime.executeAction('flow.start', { requirementId: requirement.id });
    await started;
    const stopped = await runtime.executeAction('flow.stop', { requirementId: requirement.id });
    expect(stopped).toMatchObject({ state: 'attention', workspace: requirement.workspace, pending: { runId: 'wf_paused' } });
    await expect(runtime.executeAction('flow.stop', { requirementId: requirement.id })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('runs board actions with the same acceptance and revision rules as the board UI', async () => {
    const { runtime, requirement } = await harness();
    const input = { requirementId: requirement.id };
    await runtime.executeAction('flow.start', input);
    const ready = await runtime.waitForIdle(requirement.id);
    await expect(runtime.executeAction('flow.accept', { ...input, ticketId: 'T1', revision: 0 })).rejects.toMatchObject({ statusCode: 409 });
    await expect(runtime.executeAction('flow.accept', { ...input, ticketId: 'T1' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(runtime.executeAction('flow.accept', { ...input, revision: ready.revision })).rejects.toMatchObject({ statusCode: 409 });
    const accepted = await runtime.executeAction('flow.accept', { ...input, ticketId: 'T1', revision: ready.revision });
    expect(accepted.tickets[0].state).toBe('done');
    await runtime.executeAction('flow.start', input);
    const verified = await runtime.waitForIdle(requirement.id);
    expect((await runtime.executeAction('flow.accept', { ...input, revision: verified.revision })).state).toBe('done');
  });

  it('requires current revisions and a complete ordered set of nonempty board answers', async () => {
    const { runtime, store, requirement } = await harness();
    const waiting = await store.update(requirement.id, (draft) => { draft.questions = ['Which behavior?', 'Which platform?']; });
    const input = { requirementId: waiting.id, answers: ['Option A', 'Web'], revision: waiting.revision };
    for (const [invalid, statusCode] of [[{ revision: undefined }, 400], [{ revision: 0 }, 409], [{ answers: ['Option A'] }, 400], [{ answers: ['Option A', ' '] }, 400]]) {
      await expect(runtime.executeAction('flow.answer', { ...input, ...invalid })).rejects.toMatchObject({ statusCode });
    }
    expect((await store.get(waiting.id)).questions).toEqual(waiting.questions);
    const answered = await runtime.executeAction('flow.answer', input);
    expect(answered).toMatchObject({ state: 'todo', questions: [], answers: [{ question: 'Which behavior?', answer: 'Option A' }, { question: 'Which platform?', answer: 'Web' }] });
  });

  it('refuses every board tool action after Workflows is disabled', async () => {
    let enabled = true;
    const { runtime, requirement } = await harness({ isEnabled: async () => enabled });
    enabled = false;
    for (const action of ['flow.list', 'flow.create', 'flow.start', 'flow.stop', 'flow.answer', 'flow.accept']) {
      await expect(runtime.executeAction(action, { requirementId: requirement.id }, { directory: '/fixture' })).rejects.toMatchObject({ statusCode: 403 });
    }
  });

  it('adds dependent tickets immediately and requires acceptance before dispatching their dependents', async () => {
    const { runtime, requirement, calls, routerInputs } = await harness({ results: { tickets: { ...notes, tickets: [ticket('T1'), ticket('T2', ['T1'])] } } });
    await runtime.start(requirement.id);
    let state = await runtime.waitForIdle(requirement.id);
    expect(state.tickets.map((entry) => entry.state)).toEqual(['acceptance', 'todo']);
    expect(calls.map((entry) => entry.node)).toEqual(['spec', 'tickets', 'develop', 'review']);
    expect(calls.at(-1)).toMatchObject({ model: 'fixture/reviewer#fast' });
    expect(calls.find((entry) => entry.node === 'tickets').skills).toEqual([]);
    const firstInput = JSON.parse(routerInputs[0].prompt);
    expect(firstInput).not.toHaveProperty('history');
    state = await runtime.accept(state.id, 'T1', state.revision);
    await runtime.start(state.id);
    state = await runtime.waitForIdle(state.id);
    expect(state.tickets.map((entry) => entry.state)).toEqual(['done', 'acceptance']);
    expect(state.tickets.map((entry) => entry.lastRunId)).toEqual(['wf_fixture4', 'wf_fixture6']);
    state = await runtime.accept(state.id, 'T2', state.revision);
    await runtime.start(state.id);
    state = await runtime.waitForIdle(state.id);
    expect(state.artifacts.release).toBeDefined();
    expect(state.state).toBe('acceptance');
    expect((await runtime.accept(state.id, undefined, state.revision)).state).toBe('done');
  });

  it('enforces the configured Ticket review limit and preserves it after reopening storage', async () => {
    const { runtime, requirement, calls, root } = await harness({ limit: 2, resultFactories: {
      develop: (round) => ({ ...notes, evidence: [`Validation attempt ${round}`] }),
    }, results: {
      review: { ...cleanReview, findings: [issue] },
    } });
    await runtime.start(requirement.id);
    const state = await runtime.waitForIdle(requirement.id);
    expect(state.state).toBe('attention');
    expect(state.tickets[0].reviewUsed).toBe(2);
    expect(calls.filter((entry) => entry.node === 'review')).toHaveLength(2);
    expect(state.artifacts.release).toBeUndefined();
    await expect(runtime.start(state.id)).rejects.toThrow('Review budget');
    const reopened = createFlowStore({ fsPromises: fs, path, dataDir: root });
    expect((await reopened.get(state.id)).tickets[0].reviewUsed).toBe(2);
  });

  it('stops on an invalid dependency graph without adding partial tickets', async () => {
    const { runtime, requirement } = await harness({ results: { tickets: { ...notes, tickets: [ticket('T1', ['T2']), ticket('T2', ['T1'])] } } });
    await runtime.start(requirement.id);
    const state = await runtime.waitForIdle(requirement.id);
    expect(state.state).toBe('attention');
    expect(state.error).toContain('cycle');
    expect(state.tickets).toEqual([]);
  });

  it('reconciles a completed final-budget Review after restart without dispatching another review', async () => {
    const { runtime, store, requirement, calls, completed, reopen } = await harness({ limit: 1 });
    await runtime.start(requirement.id);
    const accepted = await runtime.waitForIdle(requirement.id);
    const runId = [...completed.keys()].at(-1);
    await store.update(accepted.id, (draft) => {
      draft.state = 'running';
      draft.tickets[0].state = 'running';
      draft.tickets[0].review = { ...cleanReview, findings: [issue] };
      draft.tickets[0].elapsedMs = draft.config.maxTicketMinutes * 60_000;
      draft.pending = { node: 'review', ticketId: 'T1', runId };
    });
    const restarted = reopen();
    expect((await restarted.list('/fixture')).requirements[0].state).toBe('attention');
    await restarted.start(accepted.id);
    const reconciled = await restarted.waitForIdle(accepted.id);
    expect(reconciled.tickets[0]).toMatchObject({ state: 'acceptance', reviewUsed: 1 });
    expect(calls.filter((entry) => entry.node === 'review')).toHaveLength(1);
  });

  it('offers only frontier nodes and ticket IDs to the routing model, including pause', async () => {
    const { runtime, requirement, routerInputs } = await harness();
    await runtime.start(requirement.id);
    await runtime.waitForIdle(requirement.id);
    const tickets = routerInputs.find((input) => JSON.parse(input.prompt).allowedActions.some((action) => action.node === 'tickets'));
    const develop = routerInputs.find((input) => JSON.parse(input.prompt).allowedActions.some((action) => action.node === 'develop'));
    expect(tickets.responseSchema.properties.node.enum).toEqual(['tickets', 'pause']);
    expect(JSON.parse(tickets.prompt).actionPurposes.tickets).toMatch(/\S/);
    expect(JSON.parse(tickets.prompt).actionPurposes.pause).toMatch(/\S/);
    expect(tickets.responseSchema.properties.ticketId).toMatchObject({ const: null });
    expect(develop.responseSchema.properties.node.enum).toEqual(['develop', 'pause']);
    expect(develop.responseSchema.properties.ticketId.enum).toEqual([null, 'T1']);
  });

  it('refuses a Router action outside the allowed frontier', async () => {
    const { runtime, requirement, calls } = await harness({ decisions: () => ({ node: 'release', ticketId: null }) });
    await runtime.start(requirement.id);
    const state = await runtime.waitForIdle(requirement.id);
    expect(state.error).toContain('unavailable action');
    expect(calls).toEqual([]);
  });

  it('collects blocking questions and refuses a stale answer without losing the latest state', async () => {
    const { runtime, requirement } = await harness({
      decisions: (state) => state.allowedActions.find((entry) => entry.node === 'clarify') ?? state.allowedActions[0],
      results: { clarify: { ...notes, questions: ['Which behavior should this implement?'] } },
    });
    const config = { ...requirement.config, clarification: 'auto' };
    // A new requirement captures its configuration, independently of the template.
    const second = await runtime.create({ directory: '/fixture', title: 'Clarify', task: 'Unsettled behavior', config });
    await runtime.start(second.id);
    const state = await runtime.waitForIdle(second.id);
    expect(state.questions).toHaveLength(1);
    await expect(runtime.answer(state.id, ['Option A'], 0)).rejects.toMatchObject({ statusCode: 409 });
    const answered = await runtime.answer(state.id, ['Option A'], state.revision);
    expect(answered.questions).toEqual([]);
    expect(answered.answers[0].answer).toBe('Option A');
  });

  it('preserves the previous record after an atomic write fails', async () => {
    let failWrites = false;
    const { store, requirement } = await harness({ fsImpl: { ...fs, rename: async (...args) => {
      if (failWrites) throw new Error('disk unavailable');
      return fs.rename(...args);
    } } });
    failWrites = true;
    await expect(store.update(requirement.id, (draft) => { draft.title = 'Lost write'; })).rejects.toThrow('disk unavailable');
    expect((await store.get(requirement.id)).title).toBe('Feature');
  });
});
