# Flow task workbench

## Approved scope

Flow is part of the core application in `JiChenSSG/openchamber`. The task board
groups Tickets under a requirement and its Spec. A stateless Router selects
registered nodes from an explicit set of legal next actions. The server owns
state, dependency admission, budgets and persistence; the model cannot waive
them. The existing delivery workflow remains available.

Each node captures its prompt, agent, model, variant and selected skills. Router
calls contain a bounded state snapshot, no conversation history and no tools.
Automatic clarification asks only blocking questions. Explicit deep clarification
loads the grilling skill. Existing `to-spec` and `to-tickets` skills supply
planning instructions. Flow overrides their external publishing and ticket
confirmation steps: validated tickets enter the local board immediately.

One requirement owns one retained worktree. Tickets execute serially in dependency
order. Review checks acceptance, correctness, security and explicit project
requirements. Optional improvements do not block. A Ticket's configurable review
limit defaults to three calls, including the initial review, and survives retries.
Budget exhaustion and inconclusive results require user intervention. Nothing
automatically pushes, merges, publishes or deploys.

## Runtime surfaces

| Surface | Behavior |
| --- | --- |
| Web | Full board, node configuration and execution through authenticated routes |
| Electron | Same shared UI and server; no new privileged shell capability |
| VS Code | No board entry; the server-owned Flow API is not proxied as an OpenCode API |
| Hosted mobile | Existing session questions, permissions and workflow reports remain usable; no new board entry |
| Capacitor mobile | Existing bundled UI and server contracts remain compatible; no new native UI |

## State and failure contract

Requirement and Ticket state belongs to the server's private Flow store. UI
responses replace state only after successful parsing; read failure preserves
the previous snapshot. Disk writes serialize and become visible after atomic
replacement. A corrupt record is retained for repair and is never overwritten
as empty data. Closing the board does not stop work. Restarted work requires
explicit resume and retains its node-run reference and consumed Review budget.

Node execution reuses workflow sessions, structured answers and cancellation.
Every model node is linked durably before execution. Resuming reconciles that
run before dispatching another one. Template edits affect future requirements,
not an existing requirement's captured configuration.
