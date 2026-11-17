import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { DELIVERY_WORKFLOW_NAME } from './delivery.js';
import { createWorkflowRuntime } from './runtime.js';
import { createWorkflowRunStore } from './store.js';

const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })));
});

const setup = async ({ reviews = [[]], createWorktree, isGitRepository = async () => true, enabled = true, failStage, reviewComplete = true, reviewEvidence = ['Read router.js and the validation results'], ownerFailure = false } = {}) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-delivery-'));
  directories.push(directory);
  const store = createWorkflowRunStore({ fsPromises: fs, path, dataDir: directory });
  const stages = [];
  const prompts = [];
  const sessions = [];
  let reviewIndex = 0;
  let runtime;
  let finish;
  const ended = new Promise((resolve) => { finish = resolve; });
  runtime = createWorkflowRuntime({
    store, fsPromises: fs, path, worktrees: createWorktree ? { create: createWorktree, isGitRepository } : undefined,
    isEnabled: async () => enabled,
    agentSessions: {
      createSession: async (input) => { sessions.push(input); if (ownerFailure) throw new Error('OpenCode unavailable'); return 'ses_delivery'; },
      start: async ({ text, onSession }) => {
        const stage = /^Flow stage: (\w+)/.exec(text)?.[1];
        stages.push(stage);
        prompts.push(text);
        await onSession(`ses_worker${stages.length}`);
        if (stage === failStage) return { sessionId: 'ses_failed', outcome: { state: 'error', text: '', errorMessage: 'worker unavailable' } };
        const findings = reviews[Math.min(reviewIndex, reviews.length - 1)];
        if (stage === 'Review') reviewIndex += 1;
        const result = stage === 'Review'
          ? { summary: 'Inspected the changes', complete: reviewComplete, findings, evidence: reviewEvidence }
          : { summary: `${stage} report`, evidence: ['Checked the acceptance criteria'] };
        return { sessionId: `ses_worker${stages.length}`, outcome: { state: 'completed', text: JSON.stringify(result), errorMessage: '' } };
      },
      followUp: async () => ({ state: 'error', text: '', errorMessage: 'unexpected schema correction' }),
      readUsage: async () => null,
      interrupt: async () => {},
    },
    postSynthetic: async (sessionId, message) => {
      finish(await runtime.executeAction('workflow.result', { runId: message.metadata.runId }, { sessionId, directory }));
    },
    sleep: async () => {},
  });
  return { directory, runtime, stages, prompts, sessions, ended, store };
};

const finding = { file: 'router.js', scenario: 'Review fails', cause: 'Release starts early', fix: 'Block release until review passes' };

describe('delivery stage routing', () => {
  it('prepares a release after a clean review without publishing it', async () => {
    const { runtime, directory, stages, ended, store } = await setup();
    await runtime.startSaved({ directory, name: DELIVERY_WORKFLOW_NAME, args: { task: 'Implement routing' }, runInWorktree: false });
    const run = await ended;
    expect(run.error).toBeUndefined();
    expect(stages).toEqual(['Research', 'Plan', 'Develop', 'Review']);
    expect(run).toMatchObject({ state: 'completed', result: { status: 'awaiting-publication-approval', release: { published: false } } });
    await store.flush();
    const reloaded = createWorkflowRunStore({ fsPromises: fs, path, dataDir: directory });
    expect((await reloaded.list())[0]).toMatchObject({ result: { status: 'awaiting-publication-approval' } });
  });

  it('routes findings back to development and reviews the correction', async () => {
    const { runtime, directory, stages, prompts, ended, store } = await setup({ reviews: [[finding], []] });
    await runtime.startSaved({ directory, name: DELIVERY_WORKFLOW_NAME, args: { task: 'Implement routing' }, runInWorktree: false });
    expect((await ended).state).toBe('completed');
    expect(stages).toEqual(['Research', 'Plan', 'Develop', 'Review', 'Develop', 'Review']);
    expect(prompts[4]).toContain(finding.cause);
    await store.flush();
  });

  it('blocks release when a completed review still has findings at the round limit', async () => {
    const { runtime, directory, stages, ended, store } = await setup({ reviews: [[finding]] });
    await runtime.startSaved({ directory, name: DELIVERY_WORKFLOW_NAME, args: { task: 'Implement routing', maxReviewRounds: 1 }, runInWorktree: false });
    const run = await ended;
    expect(run).toMatchObject({ state: 'failed' });
    expect(stages).toEqual(['Research', 'Plan', 'Develop', 'Review']);
    expect(run.result).toBeUndefined();
    await store.flush();
  });

  it('fails closed when a worker cannot produce a report', async () => {
    const { runtime, directory, stages, ended, store } = await setup({ failStage: 'Develop' });
    await runtime.startSaved({ directory, name: DELIVERY_WORKFLOW_NAME, args: { task: 'Implement routing' }, runInWorktree: false });
    expect((await ended).state).toBe('failed');
    expect(stages).toEqual(['Research', 'Plan', 'Develop']);
    await store.flush();
  });

  it.each([
    { reviewComplete: false, reviewEvidence: ['The required environment was unavailable'] },
    { reviewComplete: true, reviewEvidence: [] },
  ])('blocks release without a completed evidenced review: $reviewComplete', async (review) => {
    const { runtime, directory, ended, store } = await setup(review);
    await runtime.startSaved({ directory, name: DELIVERY_WORKFLOW_NAME, args: { task: 'Implement routing' }, runInWorktree: false });
    expect(await ended).toMatchObject({ state: 'failed' });
    await store.flush();
  });

  it('creates the default worktree before the owner and workers', async () => {
    const { runtime, directory, sessions, ended, store } = await setup({ createWorktree: async () => ({ directory: '/isolated/flow' }) });
    const started = await runtime.startSaved({ directory, sessionId: 'ses_existing', name: DELIVERY_WORKFLOW_NAME, args: { task: 'Implement routing' } });
    expect(started).toMatchObject({ directory: '/isolated/flow', sessionId: 'ses_delivery' });
    expect(sessions).toEqual([expect.objectContaining({ directory: '/isolated/flow' })]);
    expect(await ended).toMatchObject({ result: { workspace: '/isolated/flow' } });
    await store.flush();
  });

  it('does not start an owner or a worker when worktree creation fails', async () => {
    const { runtime, directory, stages, sessions } = await setup({ createWorktree: async () => { throw new Error('Git denied'); } });
    await expect(runtime.startSaved({ directory, name: DELIVERY_WORKFLOW_NAME, args: { task: 'Implement routing' } })).rejects.toThrow('Git denied');
    expect(stages).toEqual([]);
    expect(sessions).toEqual([]);
  });

  it('reports the retained workspace when admission fails after creation', async () => {
    const { runtime, directory, stages } = await setup({ createWorktree: async () => ({ directory: '/isolated/retained' }), ownerFailure: true });
    await expect(runtime.startSaved({ directory, name: DELIVERY_WORKFLOW_NAME, args: { task: 'Implement routing' } })).rejects.toThrow('/isolated/retained');
    expect(stages).toEqual([]);
  });

  it('rejects a non-Git project before worktree creation or agent admission', async () => {
    const { runtime, directory, sessions } = await setup({ isGitRepository: async () => false, createWorktree: async () => { throw new Error('must not create'); } });
    await expect(runtime.startSaved({ directory, name: DELIVERY_WORKFLOW_NAME, args: { task: 'Implement routing' } })).rejects.toMatchObject({ statusCode: 400 });
    expect(sessions).toEqual([]);
  });

  it('refuses a disabled workflow before creating a worktree', async () => {
    const { runtime, directory, sessions } = await setup({ enabled: false, createWorktree: async () => { throw new Error('must not create'); } });
    await expect(runtime.startSaved({ directory, name: DELIVERY_WORKFLOW_NAME, args: { task: 'Implement routing' } })).rejects.toMatchObject({ statusCode: 403 });
    expect(sessions).toEqual([]);
  });

  it('does not treat a failed Git probe as a non-Git fallback', async () => {
    const { runtime, directory, sessions } = await setup({ isGitRepository: async () => { throw new Error('Git probe unavailable'); }, createWorktree: async () => { throw new Error('must not create'); } });
    await expect(runtime.startSaved({ directory, name: DELIVERY_WORKFLOW_NAME, args: { task: 'Implement routing' } })).rejects.toThrow('Git probe unavailable');
    expect(sessions).toEqual([]);
  });

  it.each([{ task: ' ' }, { task: 'Implement routing', maxReviewRounds: 0 }, { task: 'Implement routing', maxReviewRounds: 11 }])('rejects invalid delivery input before creating a worktree: $task $maxReviewRounds', async (args) => {
    const { runtime, directory, sessions } = await setup({ createWorktree: async () => { throw new Error('must not create'); } });
    await expect(runtime.startSaved({ directory, name: DELIVERY_WORKFLOW_NAME, args })).rejects.toMatchObject({ statusCode: 400 });
    expect(sessions).toEqual([]);
  });

  it('lists the built-in without adding files to the project', async () => {
    const { runtime, directory } = await setup();
    expect((await runtime.listSaved({ directory })).workflows).toContainEqual(expect.objectContaining({ name: DELIVERY_WORKFLOW_NAME }));
    await expect(fs.access(path.join(directory, '.openchamber'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
