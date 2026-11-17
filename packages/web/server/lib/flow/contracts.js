import { z } from 'zod';

const text = z.string().trim().min(1);
const evidence = z.array(text).min(1).max(50);
const FLOW_NODES = ['router', 'research', 'clarify', 'spec', 'tickets', 'develop', 'review', 'verify', 'release'];
const nodeConfig = z.object({
  prompt: z.string().max(20_000).default(''),
  agent: z.string().trim().max(256).default(''),
  model: z.string().trim().max(256).refine((value) => value === '' || /^[^/\s#]+\/[^\s#]+$/.test(value), 'Use provider/model without a variant suffix').default(''),
  variant: z.string().trim().max(256).default(''),
  skills: z.array(text.max(256)).max(20).default([]),
}).strict().refine((value) => !value.variant || !!value.model, 'A variant requires an explicit model');
export const templateSchema = z.object({
  maxReviewRounds: z.number().int().min(1).max(10).default(3),
  maxTicketMinutes: z.number().int().min(1).max(480).default(60),
  clarification: z.enum(['auto', 'deep', 'skip']).default('auto'),
  nodes: z.object(Object.fromEntries(FLOW_NODES.map((node) => [node, nodeConfig.prefault({})]))).prefault({}),
}).strict();
export const defaultTemplate = () => {
  const template = templateSchema.parse({});
  template.nodes.spec.skills = ['to-spec'];
  template.nodes.tickets.skills = ['to-tickets'];
  for (const node of FLOW_NODES) {
    if (node !== 'router') template.nodes[node].prompt = NODE_INSTRUCTIONS[node];
  }
  return template;
};
const finding = z.object({ file: text, scenario: text, cause: text, fix: text }).strict();
const notesSchema = z.object({ summary: text.max(8_000), evidence }).strict();
const reviewSchema = notesSchema.extend({ complete: z.boolean(), findings: z.array(finding).max(50), suggestions: z.array(text).max(30) }).strict();
const ticketDraft = z.object({
  id: text.regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/), title: text.max(240), description: text.max(12_000),
  acceptance: z.array(text).min(1).max(30), blockedBy: z.array(text).max(30),
}).strict();
export const nodeResults = {
  research: notesSchema,
  clarify: notesSchema.extend({ questions: z.array(text.max(2_000)).max(6) }).strict(),
  spec: notesSchema.extend({ content: text.max(60_000), acceptance: z.array(text).min(1).max(50) }).strict(),
  tickets: notesSchema.extend({ tickets: z.array(ticketDraft).min(1).max(30) }).strict(),
  develop: notesSchema,
  review: reviewSchema,
  verify: reviewSchema,
  release: notesSchema,
};
const ticketSchema = ticketDraft.extend({
  state: z.enum(['todo', 'running', 'attention', 'acceptance', 'done']),
  reviewUsed: z.number().int().nonnegative(), elapsedMs: z.number().nonnegative(),
  lastRunId: text.optional(),
  lastReviewEvidence: z.string().nullable().default(null),
  development: notesSchema.nullable(), review: reviewSchema.nullable(),
});
export const requirementSchema = z.object({
  version: z.literal(1), id: z.string().regex(/^flw_[a-f0-9]{32}$/), revision: z.number().int().nonnegative(),
  title: text.max(240), task: text.max(20_000), directory: text, workspace: text, sessionId: text,
  state: z.enum(['todo', 'running', 'attention', 'acceptance', 'done']),
  config: templateSchema, createdAt: z.number(), updatedAt: z.number(),
  artifacts: z.object({
    research: nodeResults.research.optional(), clarify: nodeResults.clarify.optional(), spec: nodeResults.spec.optional(),
    tickets: nodeResults.tickets.optional(), verify: nodeResults.verify.optional(), release: nodeResults.release.optional(),
  }),
  tickets: z.array(ticketSchema).max(30),
  pending: z.object({ node: z.enum(FLOW_NODES).exclude(['router']), ticketId: z.string().nullable(), runId: text.optional() }).nullable(),
  questions: z.array(text).max(6), answers: z.array(z.object({ question: text, answer: text })).max(100),
  clarificationUsed: z.number().int().nonnegative(), routerUsed: z.number().int().nonnegative(),
  events: z.array(z.object({ at: z.number(), node: z.string(), message: z.string(), runId: z.string().optional() })).max(200),
  error: z.string().nullable(),
});
export const createRequirementSchema = z.object({
  title: text.max(240), task: text.max(20_000), directory: text,
  runInWorktree: z.boolean().default(true), config: templateSchema.optional(),
}).strict();

export const requirementIdSchema = z.string().regex(/^flw_[a-f0-9]{32}$/);
export const requirementActionSchema = z.object({
  revision: z.number().int().nonnegative(),
  ticketId: z.string().trim().min(1).optional(),
  answers: z.array(z.string().trim().min(1).max(8_000)).max(6).optional(),
}).strict();

export const validateTickets = (drafts) => {
  const ids = new Set(drafts.map((ticket) => ticket.id));
  if (ids.size !== drafts.length) throw new Error('Ticket identifiers must be unique');
  const byId = new Map(drafts.map((ticket) => [ticket.id, ticket]));
  const complete = new Set();
  const visiting = new Set();
  const visit = (id) => {
    if (complete.has(id)) return;
    if (visiting.has(id)) throw new Error('Ticket dependencies contain a cycle');
    if (!ids.has(id)) throw new Error(`Unknown blocking ticket: ${id}`);
    visiting.add(id);
    for (const blocker of byId.get(id).blockedBy) visit(blocker);
    visiting.delete(id);
    complete.add(id);
  };
  for (const id of ids) visit(id);
};

export const NODE_INSTRUCTIONS = {
  research: 'Inspect project instructions and relevant code. Report verified facts and unresolved decisions. Keep project files unchanged.',
  clarify: 'Ask only unresolved decisions that materially affect scope, behavior, acceptance or safety. Research discoverable facts yourself. Return up to six questions in the structured report, then stop. Do not repeat answered questions. If the inputs are sufficient, return no questions. Keep project files unchanged.',
  spec: 'Use the selected to-spec skill to produce a specification from the task, research and confirmed decisions. Include scope, non-goals, user behavior and verifiable acceptance. Return the specification as content. Flow uses its local board as tracker: do not publish externally or modify project files.',
  tickets: 'Use the selected to-tickets skill to split the specification into small, independently verifiable vertical slices. Include acceptance and true blocking edges. Return stable unique ticket identifiers. Flow explicitly overrides the skill ticket-confirmation and publishing steps: return the structured tickets immediately, without asking for breakdown approval or publishing externally. The host adds them to the local board.',
  develop: 'Complete this Ticket with the smallest clear implementation satisfying its acceptance and existing project requirements. Reuse existing mechanisms. Address the blocking Review findings. Do not add speculative abstractions, compatibility layers, retries or fallback code. Error handling must correspond to realistic failure paths; retain necessary input, permission and data-integrity checks. Do not swallow failures or expand scope. Run relevant validation and report actual evidence. Leave code in this worktree.',
  review: 'Review the actual implementation against this Ticket, its acceptance, non-goals and explicit project requirements. Block only unmet acceptance, demonstrable correctness regressions, security/permission/data-integrity risks, or material violations of explicit requirements. Each finding needs a triggering supported scenario, consequence, code evidence and minimal fix. Do not turn guesses into defects. Do not demand speculative defensive code, abstractions, configuration, compatibility, unrelated refactors or personal style changes. Put nonblocking improvements in suggestions. Recheck unresolved findings and regressions introduced by their fixes; do not repeat resolved findings or raise the acceptance bar. Set complete only after actually reviewing. Return no findings once the goal is met. Keep project files unchanged.',
  verify: 'Verify the completed Tickets together against the entire Spec and its acceptance. Use actual code and validation evidence. Report only concrete blocking integration or acceptance defects; put optional improvements in suggestions. Do not expand scope or pursue perfection. Set complete only when verification was performed. Keep project files unchanged.',
  release: 'Prepare a concise delivery summary and checklist naming the retained workspace and validation evidence. Do not push, merge, publish, deploy, change credentials or claim publication. The user authorizes publication separately. Keep project files unchanged.',
};
