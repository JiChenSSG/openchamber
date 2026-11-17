# Flow v0

## Approved behavior

The delivery workflow runs Research, Plan, Develop, Review, then Release preparation. The router sends review findings back to Develop without asking the user to choose the next stage. Review retries have a finite limit. A failed or inconclusive review cannot reach Release.

Development defaults to a new Git worktree. The worktree stays available after the run for inspection, fixes, and release. An explicit user choice permits the current directory. A failed worktree creation prevents agent execution.

Release produces a candidate and a publication checklist. Pushing, publishing, merging, and deploying require a separate user authorization. Completing preparation does not claim that a release was published.

## Execution ownership

The existing workflow runtime owns approval, child sessions, structured answers, persistence, replay, cancellation, and result delivery. The delivery preset owns stage instructions and routing decisions. It starts one workflow stage agent at a time.

The existing worktree creation bridge owns Git setup. The UI sends a start command and displays the authoritative run. It does not implement the stage loop or a second scheduler.

## Runtime coverage

- Web: delivery starts from the existing Workflows panel.
- Electron: uses the same panel and in-process backend. The Flow build has a separate product identity and backend data directory.
- VS Code: the managed workflow tool remains unavailable. Existing unsupported behavior is unchanged.
- Hosted mobile: existing workflow approval and report behavior remains compatible. MobileApp has no new delivery start entry in this version.
- Installed Capacitor mobile: existing API contracts remain compatible. Its bundled UI does not acquire the new form automatically.

## Persisted contracts

Flow has independent managed OpenCode session data, state and cache. The
original database is never imported. Existing model and agent configuration
remains shared through the unchanged configuration home.

Run records and structured stage answers use the existing workflow store. A resume reuses completed stages. Review corrections remain in the same worktree. Existing storage engines are reused; no application dependency is added.

Built-in workflow names use a reserved identifier that cannot collide with valid project-saved filenames. Existing saved workflows retain their start and replay behavior.

## Process identity

The custom Windows desktop is named openflow. Its bundled official OpenCode executable is staged as ocf.exe, or ocf on other platforms. The official installation and its binary remain unchanged. A deliberately configured external OpenCode binary keeps its own filename.

The custom build preserves its private Flow bundle ID, Electron profiles and data directory across product renames. Official update feeds must not replace the custom build.

## Acceptance

- A clean review reaches Release preparation.
- Review findings return to Develop and are included in its task.
- Exhausting review rounds or receiving no valid answer fails before Release.
- A new worktree is created before any workflow agent starts.
- Existing project-saved workflows retain their behavior.
- A run remains inspectable after reload and interruption through the existing runtime.
- User input, failed sends, and cancellation retain the existing permission checks.
- Windows packaging resolves the renamed bundled executable and keeps the official installation separate.
