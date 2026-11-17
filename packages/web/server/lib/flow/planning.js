/** App-owned planning instructions, available without an OpenCode skill install. */
export const PLANNING_INSTRUCTIONS = {
  spec: `Write a specification from the original request, verified research, confirmed decisions and shared requirement documents. Preserve every explicit constraint. Include the goal, scope, non-goals, current behavior, intended user behavior, implementation constraints, risks and verifiable acceptance criteria. Distinguish observed facts from assumptions and unresolved decisions. Investigate discoverable facts using project instructions and relevant code. A blocking product decision belongs in clarification; do not invent an answer. Keep the specification proportional to the task. Return the complete specification in content and its acceptance criteria in acceptance, with a summary and factual evidence. Keep project files unchanged. The server archives the specification in the requirement library.`,
  tickets: `Turn the existing specification into small executable vertical slices. Each ticket has a stable unique id, a short title, an implementation description, independently verifiable acceptance criteria and blockedBy containing only true prerequisite ticket ids. Preserve the specification's constraints and cover all its acceptance criteria across the tickets. Use one ticket for a task that already fits a single coherent change. Order prerequisites before dependents; avoid cycles, self-dependencies, duplicate ids and invented infrastructure. Cite the specification and research as evidence. Return summary, evidence and tickets directly for the local board. The server validates the complete dependency graph before adding tickets. Keep project files unchanged. Publishing externally requires separate user authorization.`,
};

// Exact shipped defaults are recognized so saved templates need no external install.
const LEGACY = {
  spec: 'Use the selected to-spec skill to produce a specification from the task, research and confirmed decisions. Include scope, non-goals, user behavior and verifiable acceptance. Return the specification as content. Flow uses its local board as tracker: do not publish externally or modify project files.',
  tickets: 'Use the selected to-tickets skill to split the specification into small, independently verifiable vertical slices. Include acceptance and true blocking edges. Return stable unique ticket identifiers. Flow explicitly overrides the skill ticket-confirmation and publishing steps: return the structured tickets immediately, without asking for breakdown approval or publishing externally. The host adds them to the local board.',
};

export const normalizePlanningTemplate = (template) => {
  for (const node of ['spec', 'tickets']) {
    const config = template.nodes[node];
    config.skills = config.skills.filter((id) => id !== 'to-spec' && id !== 'to-tickets');
    if (config.prompt === LEGACY[node]) config.prompt = PLANNING_INSTRUCTIONS[node];
  }
  return template;
};
