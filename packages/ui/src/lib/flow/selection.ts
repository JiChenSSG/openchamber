import type { FlowRequirement, FlowTicket } from './api';

/** A selected Ticket never borrows another Ticket's currently active node. */
export const selectedNodeRunId = (
  record: Pick<FlowRequirement, 'pending' | 'events'> & { tickets: ReadonlyArray<Pick<FlowTicket, 'id' | 'lastRunId'>> },
  ticketId: string | null,
): string | undefined => {
  if (ticketId) {
    const ticket = record.tickets.find((entry) => entry.id === ticketId);
    return record.pending?.ticketId === ticketId ? record.pending.runId ?? ticket?.lastRunId : ticket?.lastRunId;
  }
  return record.pending?.runId ?? record.events.slice().reverse().find((entry) => entry.runId)?.runId;
};
