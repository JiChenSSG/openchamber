import { z } from 'zod';

// Saved project workflows cannot use this identifier: their names are filenames.
export const DELIVERY_WORKFLOW_NAME = '@flow/delivery';

export const deliveryArgsSchema = z.object({
  task: z.string().trim().min(1).max(20_000),
  maxReviewRounds: z.number().int().min(1).max(10).default(3),
  agent: z.string().trim().min(1).optional(),
  reviewAgent: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  reviewModel: z.string().trim().min(1).optional(),
});

/** A bounded stage router executed by the existing checkpointed workflow runtime. */
export const DELIVERY_WORKFLOW_SCRIPT = `export const meta = {
  name: 'flow-delivery',
  description: 'Research, plan, develop, review, and prepare a release',
  phases: ['Research', 'Plan', 'Develop', 'Review', 'Release']
};
const notesSchema = {
  type: 'object',
  required: ['summary', 'evidence'],
  properties: { summary: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } } },
  additionalProperties: false
};
const reviewSchema = {
  type: 'object',
  required: ['summary', 'complete', 'findings', 'evidence'],
  properties: {
    summary: { type: 'string' },
    complete: { type: 'boolean' },
    evidence: { type: 'array', items: { type: 'string' } },
    findings: { type: 'array', items: {
      type: 'object', required: ['file', 'scenario', 'cause', 'fix'],
      properties: { file: { type: 'string' }, scenario: { type: 'string' }, cause: { type: 'string' }, fix: { type: 'string' } },
      additionalProperties: false
    } }
  },
  additionalProperties: false
};
const stage = async (name, instructions, context, schema, reviewer = false) => {
  phase(name);
  const result = await agent(
    'Flow stage: ' + name + '\\nTask: ' + args.task + '\\n' + instructions +
    '\\nContext: ' + JSON.stringify(context) +
    '\\nAsk the user through the existing question or permission tools when input is required. Never push, merge, publish, deploy, or change credentials in this workflow.',
    { label: name, phase: name, schema,
      ...(reviewer ? { agent: args.reviewAgent || args.agent, model: args.reviewModel || args.model } : { agent: args.agent, model: args.model }) }
  );
  if (result === null) throw new Error(name + ' did not return a usable report. Inspect its session before resuming.');
  if (!result.summary.trim() || result.evidence.length === 0 || result.evidence.some(item => !item.trim())) throw new Error(name + ' returned no usable evidence. Inspect its session and start a revised run.');
  return result;
};
const research = await stage('Research', 'Inspect the project instructions and relevant sources. Report verified facts and uncertainties. Keep project files unchanged.', {}, notesSchema);
const plan = await stage('Plan', 'Use the research to produce an implementation plan with acceptance checks and a clear scope. Keep project files unchanged.', { research }, notesSchema);
let development;
let review;
for (let round = 1; round <= args.maxReviewRounds; round += 1) {
  development = await stage('Develop', 'Implement the plan and address every review finding. Run the relevant validation. Report changed files, commands and actual results. Leave changes in this worktree.', { research, plan, round, findings: review ? review.findings : [] }, notesSchema);
  review = await stage('Review', 'Inspect the actual changes and validation against the task and project instructions. Keep files unchanged. Report concrete findings and the evidence inspected. Each finding names a file and line, triggering scenario, cause and required fix. Set complete only when the review was performed. Report facts without a release verdict; the router decides the next stage.', { plan, development, round }, reviewSchema, true);
  if (!review.complete) throw new Error('Review needs input before development or release can continue. Inspect its session and start a revised run.');
  if (review.findings.length === 0) {
    log('Router: Review passed; preparing the release candidate.');
    break;
  }
  log('Router: Review returned ' + review.findings.length + ' finding(s); returning to Develop.');
}
if (review.findings.length !== 0) throw new Error('Review rounds exhausted. Release is blocked. Inspect the findings before starting a revised run.');
phase('Release');
return {
  status: 'awaiting-publication-approval',
  task: args.task,
  workspace: args.workspace,
  research,
  plan,
  development,
  review,
  release: {
    published: false,
    checklist: ['Inspect the retained worktree and validation evidence.', 'Authorize the intended push, merge, publication or deployment separately.']
  }
};
`;
