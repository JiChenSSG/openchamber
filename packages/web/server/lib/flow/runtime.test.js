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

const harness = async ({ results = {}, resultFactories = {}, limit = 3, decisions, fsImpl = fs, isEnabled = async () => true, runStep } = {}) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-runtime-'));
  roots.push(root);
  const store = createFlowStore({ fsPromises: fsImpl, path, dataDir: root });
  const calls = [];
  const completed = new Map();
  const routerInputs = [];
  const workflows = { async runStep(input) {
    if (input.runId && completed.has(input.runId)) return completed.get(input.runId);
    calls.push({ node: input.options.label.split(':')[0], model: input.options.model, skills: input.options.skills });
    await input.onRun(`wf_fixture${calls.length}`);
    await input.onStart();
    const node = calls.at(-1).node;
    const result = resultFactories[node]?.(calls.filter((entry) => entry.node === node).length) ?? results[node];
    const output = { runId: `wf_fixture${calls.length}`, result: result ?? ({ spec, tickets: { ...notes, tickets: [ticket('T1')] }, review: cleanReview, verify: cleanReview }[node] ?? notes) };
    completed.set(output.runId, output);
    return output;
  } };
  const dependencies = {
    store, workflows: runStep ? { runStep } : workflows, isEnabled,
    agentSessions: { createSession: async () => 'owner-fixture' },
    worktrees: { isGitRepository: async () => true, create: async () => ({ directory: '/fixture-worktree' }) },
    generate: async (input) => {
      routerInputs.push(input);
      const snapshot = JSON.parse(input.prompt);
      const action = decisions?.(snapshot) ?? snapshot.allowedActions.find((entry) => entry.node === 'spec') ?? snapshot.allowedActions[0];
      return { text: JSON.stringify({ ...action, reason: 'Choose the legal next action' }) };
    },
  };
  const runtime = createFlowRuntime(dependencies);
  const config = defaultTemplate();
  config.maxReviewRounds = limit;
  config.clarification = 'skip';
  config.nodes.review.model = 'fixture/reviewer';
  config.nodes.review.variant = 'fast';
  const requirement = await runtime.create({ directory: '/fixture', title: 'Feature', task: 'Deliver a feature', config });
  return { runtime, store, requirement, calls, routerInputs, root, completed,
    reopen: () => createFlowRuntime({ ...dependencies, store: createFlowStore({ fsPromises: fs, path, dataDir: root }) }),
  };
};

describe('Flow task delivery', () => {
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
    expect(calls.find((entry) => entry.node === 'tickets').skills).toEqual(['to-tickets']);
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
