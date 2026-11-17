# Flow task board

## Ownership

The desktop and web page manages requirement and Ticket presentation, node
configuration and user actions. `server/lib/flow` owns state, persistence,
dependencies, routing and budgets. Shared UI calls explicit OpenChamber routes
through `lib/flow/api.ts`; it does not call providers or privileged shell APIs.

## Invariants

- Requirement state and review counts come from parsed server responses.
- Same-owner load failures retain the last successful snapshot. Runtime and
  project changes discard the previous owner's data and reject late responses.
- Only a visible board subscribes to change signals. No idle polling or reads
  across every project are allowed.
- Node pickers are controlled values. They never change the chat composer's
  agent, model or variant selection.
- Completion requires explicit acceptance. Dragging a card cannot skip Review.
- Open session follows the selected Ticket's captured node link, even while a
  different Ticket is executing. Missing legacy links fall back to the owner.
- New requirements capture the template; editing it affects future requirements.
- Creation accepts a problem description. The server generates its short title
  and goal; creation errors remain visible inside the dialog without clearing
  the description. Cards show only one truncated title line.
- Opening a card exposes board clarification questions and the owner session's
  subtree forms and permissions inline. The existing form and permission cards
  own replies.
  Board answer submission requests resume; native form replies resume their turn.
- Shared documents belong to the selected requirement across all its Tickets.
  The list shows every version and its draft/confirmed state. Bodies load only
  when selected, as plain text with source node and run. Closing the section or
  changing requirement/runtime cancels the read; late responses are discarded.
  Loading or failed reads never appear as an empty library.

## Decisions

### Why card details use inline request cards

Board clarification results and native session requests have different owners.
Reusing the inline form and permission cards preserves native reply routing.
Composer docks anchor above an input and would float outside this side panel.

### Why the board is a main-area page

Tasks need space for dependency and execution details. The page follows the
existing main-surface lifecycle and leaves the chat available through Open
session. A permanently mounted context panel would keep its subscriptions and
catalogue reads alive while hidden.
