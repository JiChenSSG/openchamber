# Flow task orchestration

## Ownership

Flow owns requirements, Specs, dependency-linked Tickets, captured node
configuration, routing decisions and Ticket budgets. The workflow runtime owns
agent sessions, structured answers, run checkpoints and cancellation. OpenCode
owns model execution, skill loading, questions and permissions. Flow introduces
no provider connection and never publishes code or external tracker issues.

## Invariants

- The server validates every Router action against the current legal frontier.
  The model cannot waive dependencies, acceptance, budgets or permission checks.
  Its output schema lists the frontier's node names and Ticket IDs, including
  the pause option; the server still checks each returned node/Ticket pair.
  Each available node also carries its artifact purpose in the Router snapshot,
  so choosing a planning stage can advance an implementation request.
- Router uses the existing one-shot Small Model helper with a bounded snapshot,
  a 60-second deadline and no session, history or tools. Model and variant can
  be selected independently. Routing fails visibly on invalid output.
- The template captures each node's prompt, model, variant, agent and explicit
  skills. New requirements copy it; later template edits cannot alter a run.
- Description-only creation uses the captured Router model, or Small Model,
  to generate a short title and goal before allocating a worktree or session.
  The original task remains authoritative and is retained alongside the goal.
  Explicit-title callers keep their existing creation contract. Invalid model
  output or generation failure creates no task or workspace.
- Every node result includes factual evidence. Clarification and planning can
  cite task facts or confirmed decisions; implementation, Review and verification
  cite inspected files or checks actually run. Empty evidence remains invalid.
- Specification and Ticket planning use app-owned instructions without external
  skills. Custom prompts supplement the built-in planning contract. Saved
  `to-spec`/`to-tickets` selections resolve to these built-ins; exact shipped
  legacy prompts normalize on read, while custom prompts and extra skills stay.
  All ticket identifiers and blocking edges are validated before any
  ticket becomes visible. A replay reconciles the linked node before applying
  the result; it cannot append duplicate tickets.
- One requirement owns a retained worktree; Tickets run serially. Failed
  isolation admits no agent. A failed session/store admission reports the
  retained workspace instead of removing code or silently using the checkout.
- A Ticket's Review limit includes its first review and defaults to three.
  Admission consumes a slot durably before dispatch. Restart and retry preserve
  it, and direct workflow resume cannot bypass Flow. Suggestions do not block.
- Review evaluates the goal, acceptance, correctness, security and explicit
  project requirements. Speculative defensive code and personal preferences
  do not enter the automatic repair loop. Repeated identical findings with
  unchanged validation evidence stop early.
- Per-Ticket elapsed time is saved after each node attempt; a running node has
  a deadline. Downtime is not charged. Cancellation requests an interrupt and
  waits for the workflow to settle; it does not promise every descendant OS
  process has been terminated.
- Tickets require explicit acceptance before dependent Tickets start. Final
  verification and delivery preparation require all Tickets accepted. No
  push, merge, publication or deployment is authorized by completion.
- Closing the board leaves execution on the server. Restart marks interrupted
  requirements as needing attention; explicit resume reconciles the captured
  workflow node before sending another prompt.
- Board answers can request immediate resume after the answers are persisted.
  Tool answers retain explicit Start. Stale or incomplete answers never resume
  execution. A resume failure retains the saved answers for explicit retry.

## Persistence and failure

`<dataDir>/flow/` stores one atomic JSON file per requirement and a template.
Writes serialize, validate a private draft and publish it only after rename.
Failed writes leave the previous memory and disk snapshot authoritative.
Malformed files are retained and reported, never replaced by an empty success;
unrelated valid records remain available. Stale user mutations receive 409.
There is no automatic retention deletion.

Each requirement owns a shared document library in the same atomic JSON file.
All Tickets and stage child sessions use that library. Versioned document bodies
and node results commit together with the requirement checkpoint; failed writes
publish neither. Project source directories receive no library files. Documents
record their node, Ticket, run, writing session and version. Automatic reports
use reserved `result-` names and their run ID makes replay idempotent.

Only a live stage child may write notes, checked again inside the serialized
mutation. Owner sessions can read; unrelated or expired sessions cannot. Note
writes require the last document version, with 0 for a new name. A validated
node result confirms its notes in the same commit. Failed or interrupted notes
remain drafts; confirmed means a schema-valid source report, not user acceptance
or proof that a model's claims are true. Document contents cannot grant permissions.
Read a specific version to retain a confirmed handoff when a later draft exists.

The library keeps up to 512 versions, 128 distinct names and 8 MiB of serialized
UTF-8 data. Notes are at most 64,000 characters; automatic reports at most 128,000.
Capacity failure pauses visibly and retains every prior version. Older records
without a library load with an empty one; their inline artifacts stay available.

Node links are saved before approval. A crash after linking can leave an
awaiting-approval run that resume starts once; a completed run is replayed
without a new agent. A crash between Review reservation and dispatch can consume
a slot conservatively. A schema-invalid or inconclusive result pauses for
inspection, and is never treated as acceptance. Known unusable node answers are
unlinked only after recording their run in the log, so an explicit retry can
request a fresh answer instead of replaying the same invalid result forever.
Failed integration verification requires inspecting its session and revising
the requirement; Resume cannot turn it into acceptance.

## Surfaces

Web and Electron expose the shared board over authenticated OpenChamber routes.
VS Code and both phone surfaces keep their existing UI; no board entry is
injected. Phone clients can still answer questions and permissions in the
existing session UI. No relay codec, auth or native bridge contract changes.

The managed `openchamber_flow` tool exposes `flow.list`, `flow.create`,
`flow.start`, `flow.stop`, `flow.answer`, `flow.accept` and `flow.document.*`
through Code Mode. Document list/read/write use the authenticated calling session;
provenance comes from the active node rather than agent-supplied source fields.
Board refreshes and document listings carry metadata only. Document text loads
on demand through authenticated routes. Stage prompts include the latest-version
directory beside their existing structured context.
List and create default to the caller's directory. Create captures the board
template and creates a retained worktree by default. Start also resumes an
interrupted requirement. Answers and acceptance require the latest revision;
the agent submits only decisions the user has made. The tool shares the
Workflows switch and checks it on every call, including stale plugin calls.
Template editing remains in the board UI.

## Decisions

### Why planning ships with Flow

The default planning path must work without user-installed skills. App-owned
instructions define specification and Ticket contracts; optional skills can add
project guidance without replacing graph validation or acceptance gates.

### Why documents commit with the requirement

One atomic snapshot keeps confirmed handoffs and stage checkpoints consistent
across retries, write failures and restart. Separate document files would require
cross-file recovery for the same guarantee. The library has explicit size limits
and never drops old versions to admit a new one.

### Why intake keeps the original description

A generated goal can omit a constraint. Keeping the user's text authoritative
prevents summarization from silently changing acceptance. Intake uses Small
Model's prompt-sized deadline; the Router retains a separate 60-second hang
guard. Its budget covers cold-model admission and generation without changing
the pause decision, frontier checks or acceptance gates.

### Why persisted state is separate from Router context

A bounded snapshot makes routing independent of conversation length and allows
choosing a fast model. History lives in task artifacts and node sessions, not
an accumulating Router conversation. Server checks remain authoritative.

### Why node execution reuses workflows

Structured answers, session tracking, interruption and restart recovery already
have one owner. Internal managed runs suppress owner-agent wakeups and can only
be resumed through Flow; generic workflow actions cannot evade Ticket budgets.

### Why the board tool shares the Workflows switch

Board execution already depends on Workflows. One switch controls both tools,
so enabling a board tool cannot imply that its execution runtime is available
while Workflows is disabled. The board tool stays behind Code Mode because its
calls update the existing board without drawing a chat card.
