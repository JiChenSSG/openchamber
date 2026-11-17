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
- Router uses the existing one-shot Small Model helper with a bounded snapshot,
  a 20-second deadline and no session, history or tools. Model and variant can
  be selected independently. Routing fails visibly on invalid output.
- The template captures each node's prompt, model, variant, agent and explicit
  skills. New requirements copy it; later template edits cannot alter a run.
- `to-spec` and `to-tickets` are explicitly attached skills. Flow replaces their
  tracker publishing and ticket-confirmation steps with a structured local
  result. All ticket identifiers and blocking edges are validated before any
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

## Persistence and failure

`<dataDir>/flow/` stores one atomic JSON file per requirement and a template.
Writes serialize, validate a private draft and publish it only after rename.
Failed writes leave the previous memory and disk snapshot authoritative.
Malformed files are retained and reported, never replaced by an empty success;
unrelated valid records remain available. Stale user mutations receive 409.
There is no automatic retention deletion.

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

## Decisions

### Why persisted state is separate from Router context

A bounded snapshot makes routing independent of conversation length and allows
choosing a fast model. History lives in task artifacts and node sessions, not
an accumulating Router conversation. Server checks remain authoritative.

### Why node execution reuses workflows

Structured answers, session tracking, interruption and restart recovery already
have one owner. Internal managed runs suppress owner-agent wakeups and can only
be resumed through Flow; generic workflow actions cannot evade Ticket budgets.
