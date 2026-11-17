import { describe, expect, test } from 'bun:test';
import { selectedNodeRunId } from './selection';

describe('Flow node session selection', () => {
  test('opens the selected Ticket while a different Ticket is active', () => {
    const record = {
      pending: { node: 'review' as const, ticketId: 'T2', runId: 'wf_active2' },
      tickets: [{ id: 'T1', lastRunId: 'wf_finished1' }, { id: 'T2', lastRunId: 'wf_active2' }],
      events: [{ at: 1, node: 'review', message: 'T2 started', runId: 'wf_active2' }],
    };
    expect(selectedNodeRunId(record, 'T1')).toBe('wf_finished1');
    expect(selectedNodeRunId(record, 'T2')).toBe('wf_active2');
    expect(selectedNodeRunId(record, null)).toBe('wf_active2');
  });

  test('does not infer a Ticket association from another Ticket history', () => {
    expect(selectedNodeRunId({ pending: null, tickets: [{ id: 'T1' }], events: [{ at: 1, node: 'review', message: 'Other ticket', runId: 'wf_other' }] }, 'T1')).toBeUndefined();
  });
});
