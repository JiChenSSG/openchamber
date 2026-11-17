# openflow

This fork adds a delivery workflow to OpenChamber 2.7.1. OpenCode remains the
execution engine. The official desktop installation is unchanged.

The long-lived development branch in `JiChenSSG/openchamber` is `openflow`.
The repository's `main` branch remains separate.

## Task board

Enable Workflows under Settings, General, OpenChamber Tools. Open Task board
from the sidebar's Pages section or its header button. Choose a project and
describe the problem to create a requirement. The agent generates a short title
and goal while retaining the original description. New-worktree is on initially.
Creation retains a workspace and owner session; Run starts execution.

Node settings edit the default template: instructions, agent, model, variant,
skills, clarification mode and budgets. A new requirement can override it before
creation. Existing requirements keep their captured configuration. The Router
uses a separate one-shot model call with no conversation history; an empty model
selection uses OpenChamber's Small Model. Specification and Ticket planning are
built in and require no external skill installation. Custom instructions and
extra skills can supplement planning. Results remain in the local board, without tracker publication
or a ticket-breakdown confirmation step.

Tickets appear automatically after their identifiers, acceptance and dependency
graph validate. Review findings return the active Ticket to development. The
configurable limit defaults to three reviews per Ticket, including the initial
review, and survives resume. Optional improvements do not block delivery. Open a
card to answer clarification questions and permissions directly, or inspect the
specification, findings, evidence and routing log. Submitting board answers
continues execution. Open session opens its current/latest node.

Shared documents collects research, specifications and stage handoffs for the
entire requirement, including all its Tickets. Open a version to read its text
and source. Stage notes remain drafts until their producing node validates.
The server retains document versions in application data, outside project source.

Accept a finished Ticket to unblock its dependents, then Resume the requirement.
After all Tickets are accepted, Resume performs integration verification and
delivery preparation. Final acceptance completes the requirement. Budget limits,
inconclusive answers and errors pause visibly; closing the board leaves work on
the server, while an application restart requires explicit resume. No publication
action is performed. See [runtime contracts](packages/web/server/lib/flow/DOCUMENTATION.md)
and the [approved scope](docs/plans/flow-workbench.md).

## Start a delivery

Enable Workflows under Settings, General, OpenChamber Tools. Open the Workflows
panel and run `@flow/delivery`. Enter the task and its acceptance criteria.
The new-worktree option is enabled initially. It requires a Git repository;
failure stops the start rather than silently using the main checkout.

The workflow runs Research, Plan, Develop and Review. Review findings return
to Develop automatically. The default limit is three review rounds. Release
preparation returns a candidate and checklist. It does not push, merge,
publish or deploy. Authorize those actions separately.

Runs, structured reports and approval cards use OpenChamber's existing
workflow runtime. A restarted run stops visibly and can be resumed. Completed
agent answers are replayed. An inconclusive report, missing evidence or exhausted
review rounds requires a revised run. Inspect the retained worktree and start
that run there with new-worktree creation off.

## Local identity

The Windows desktop executable is `openflow.exe`. Its bundled,
unmodified OpenCode 2.2.7 binary is staged as `ocf.exe`, or `ocf` on other platforms.
An explicitly configured external executable keeps its own name.

openflow retains `~/.config/openchamber-flow` and the `OpenChamber Flow`
Chromium profile, with `OpenChamber Flow Dev` for development. Those legacy
names and the private Flow bundle ID are stable storage/integration identities;
renaming the product does not reset existing tasks, sessions or device settings.
Its managed OpenCode uses independent session data, state and cache. Global
models, agents, commands and skills use the shared `~/.config/opencode` directory,
pinned through `OPENCODE_CONFIG_DIR` for both the editor and `ocf`. Startup does
not copy or overwrite that directory. Editing its configuration affects both
apps. Explicit config files and project overrides retain their normal layering.
Some accounts need a new login. No original database is migrated.
An explicit `OPENCHAMBER_DATA_DIR` selects this host's data root. Flow does
not register itself as the official `openchamber://` protocol handler, and
its updater refuses official updates. Update this fork manually.

The existing phone App can use the same server contracts, subject to device
testing. Its bundled UI does not gain the new start form automatically. The
existing workflow cards remain the phone's approval and result controls. Add
Flow as a new connection; the original host's pairing credentials are not copied.

## Development

Use the repository's package scripts. The required Bun version is declared in
`package.json`. Bun 1.4.2 can apply the existing virtualizer patch incorrectly;
use Bun 1.4.4. A workspace installed with the older tool needs a reinstall with
a fresh `BUN_INSTALL_CACHE_DIR`. Keep development data and sessions isolated as described in
`.agents/skills/openchamber-change-discipline/references/live-dev-instance.md`.
Do not launch a plain dev instance against an existing user's data.

The accepted scope and runtime coverage are in [the v0 plan](docs/plans/flow-v0.md).
