import { z } from 'zod';
import { runtimeFetch } from '@/lib/runtime-fetch';

export const FLOW_NODES = ['router', 'research', 'clarify', 'spec', 'tickets', 'develop', 'review', 'verify', 'release'] as const;
const nodeSchema = z.enum(FLOW_NODES);
const nodeConfigSchema = z.object({ prompt: z.string(), agent: z.string(), model: z.string(), variant: z.string(), skills: z.array(z.string()) });
const templateSchema = z.object({
  maxReviewRounds: z.number().int().min(1).max(10), maxTicketMinutes: z.number().int().positive(),
  clarification: z.enum(['auto', 'deep', 'skip']), nodes: z.record(nodeSchema, nodeConfigSchema),
});
const notes = z.object({ summary: z.string(), evidence: z.array(z.string()) });
const review = notes.extend({ complete: z.boolean(), findings: z.array(z.object({ file: z.string(), scenario: z.string(), cause: z.string(), fix: z.string() })), suggestions: z.array(z.string()) });
const boardStateSchema = z.enum(['todo', 'running', 'attention', 'acceptance', 'done']);
const documentMetadataSchema = z.object({
  id: z.string(), version: z.number().int().positive(), title: z.string(),
  kind: z.enum(['research', 'clarification', 'spec', 'tickets', 'handoff', 'review', 'verification', 'release', 'note']),
  status: z.enum(['draft', 'confirmed']), node: nodeSchema, ticketId: z.string().nullable(), runId: z.string(),
  sessionId: z.string().nullable(), createdAt: z.number(), characters: z.number().int().nonnegative().optional(),
});
const documentSchema = documentMetadataSchema.extend({ content: z.string() });
const requirementSchema = z.object({
  id: z.string(), revision: z.number().int(), title: z.string(), task: z.string(), goal: z.string().optional(), directory: z.string(), workspace: z.string(), sessionId: z.string(),
  state: boardStateSchema, config: templateSchema,
  documents: z.array(documentMetadataSchema).default([]),
  artifacts: z.object({ spec: notes.extend({ content: z.string(), acceptance: z.array(z.string()) }).optional(), verify: review.optional(), release: notes.optional() }),
  tickets: z.array(z.object({ id: z.string(), title: z.string(), description: z.string(), acceptance: z.array(z.string()), blockedBy: z.array(z.string()), state: boardStateSchema, reviewUsed: z.number(), elapsedMs: z.number(), lastRunId: z.string().optional(), development: notes.nullable(), review: review.nullable() })),
  pending: z.object({ node: nodeSchema, ticketId: z.string().nullable(), runId: z.string().optional() }).nullable(),
  questions: z.array(z.string()), answers: z.array(z.object({ question: z.string(), answer: z.string() })),
  events: z.array(z.object({ at: z.number(), node: z.string(), message: z.string(), runId: z.string().optional() })), error: z.string().nullable(),
});
const boardSchema = z.object({ requirements: z.array(requirementSchema), errors: z.array(z.string()) });
export type FlowNode = z.infer<typeof nodeSchema>;
export type FlowTemplate = z.infer<typeof templateSchema>;
export type FlowRequirement = z.infer<typeof requirementSchema>;
export type FlowTicket = FlowRequirement['tickets'][number];
export type FlowState = z.infer<typeof boardStateSchema>;
export type FlowDocument = z.infer<typeof documentSchema>;

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await runtimeFetch(path, init);
  const payload: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(payload);
    throw new Error(error.success ? error.data.error : `Flow HTTP ${response.status}`);
  }
  return schema.parse(payload);
}
const json = <T,>(value: T) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
export const readFlowBoard = (directory: string, signal?: AbortSignal) => request(`/api/openchamber/flow?directory=${encodeURIComponent(directory)}`, boardSchema, { signal });
export const readFlowTemplate = (signal?: AbortSignal) => request('/api/openchamber/flow/template', templateSchema, { signal });
export const saveFlowTemplate = (config: FlowTemplate) => request('/api/openchamber/flow/template', templateSchema, { method: 'PUT', ...json(config) });
export const createFlowRequirement = (input: { task: string; directory: string; runInWorktree: boolean; config: FlowTemplate }) => request('/api/openchamber/flow', requirementSchema, { method: 'POST', ...json(input) });
export const actOnFlow = (record: FlowRequirement, action: 'start' | 'stop' | 'answer' | 'accept', extra: { ticketId?: string; answers?: string[]; resume?: boolean } = {}) => request(`/api/openchamber/flow/${encodeURIComponent(record.id)}/${action}`, requirementSchema, { method: 'POST', ...json({ revision: record.revision, ...extra }) });
export const readFlowDocument = (requirementId: string, documentId: string, version: number, signal: AbortSignal) => request(`/api/openchamber/flow/${encodeURIComponent(requirementId)}/document?documentId=${encodeURIComponent(documentId)}&version=${version}`, documentSchema, { signal });
