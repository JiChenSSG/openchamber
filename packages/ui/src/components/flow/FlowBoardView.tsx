import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCheckboxRow, SettingsStackedField } from '@/components/sections/shared/SettingsSection';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useUIStore } from '@/stores/useUIStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { subscribeOpenchamberEvents } from '@/lib/openchamberEvents';
import { subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';
import { useI18n } from '@/lib/i18n';
import { selectWorkflowsShown } from '@/lib/workflows/availability';
import { selectedNodeRunId } from '@/lib/flow/selection';
import { fetchWorkflowRuns } from '@/lib/workflows/api';
import { refreshProjectWorktrees } from '@/lib/worktrees/worktreeManager';
import { readFlowBoard, readFlowTemplate, saveFlowTemplate, createFlowRequirement, actOnFlow, type FlowRequirement, type FlowTicket, type FlowState, type FlowTemplate } from '@/lib/flow/api';
import { NodeConfigEditor } from './NodeConfigEditor';
import { FlowIcon, FlowSettingsIcon } from './FlowIcon';
import { FlowTaskRequests } from './FlowTaskRequests';

const STATES: FlowState[] = ['todo', 'running', 'attention', 'acceptance', 'done'];
const ticketState = (requirement: FlowRequirement, state: FlowState): FlowState => state === 'running' && requirement.state === 'attention' ? 'attention' : state;
type Selection = { requirementId: string; ticketId: string | null };

export function FlowBoardView() {
  const { t } = useI18n();
  const projects = useProjectsStore((state) => state.projects);
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const project = projects.find((entry) => entry.id === activeProjectId);
  const directory = project?.path ?? '';
  const enabled = useUIStore(selectWorkflowsShown);
  const [requirements, setRequirements] = React.useState<FlowRequirement[]>([]);
  const [template, setTemplate] = React.useState<FlowTemplate | null>(null);
  const [filter, setFilter] = React.useState('all');
  const [selection, setSelection] = React.useState<Selection | null>(null);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [loadErrors, setLoadErrors] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [newOpen, setNewOpen] = React.useState(false);
  const [createError, setCreateError] = React.useState('');
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<FlowTemplate | null>(null);
  const [task, setTask] = React.useState('');
  const [worktree, setWorktree] = React.useState(true);
  const [answers, setAnswers] = React.useState<string[]>([]);
  const owner = React.useRef(0);
  const requestSequence = React.useRef(0);
  const [runtimeEpoch, setRuntimeEpoch] = React.useState(0);
  React.useEffect(() => subscribeRuntimeEndpointChanged(() => {
    owner.current += 1;
    setRequirements([]); setTemplate(null); setSelection(null); setDraft(null); setNewOpen(false); setSettingsOpen(false);
    setRuntimeEpoch((value) => value + 1);
  }), []);
  const reload = React.useCallback(async (signal?: AbortSignal) => {
    if (!directory || !enabled) return;
    const generation = owner.current;
    const sequence = ++requestSequence.current;
    try {
      const snapshot = await readFlowBoard(directory, signal);
      if (signal?.aborted || generation !== owner.current || sequence !== requestSequence.current) return;
      setRequirements(snapshot.requirements); setLoadErrors(snapshot.errors); setError('');
    } catch (cause) {
      if (!signal?.aborted && generation === owner.current && sequence === requestSequence.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!signal?.aborted && generation === owner.current && sequence === requestSequence.current) setLoading(false);
    }
  }, [directory, enabled]);
  React.useEffect(() => {
    owner.current += 1;
    setRequirements([]); setTemplate(null); setFilter('all'); setSelection(null); setError(''); setNotice(''); setLoadErrors([]); setLoading(true);
    setBusy(false); setNewOpen(false); setSettingsOpen(false); setDraft(null); setAnswers([]);
    if (!directory || !enabled) { setLoading(false); return; }
    const controller = new AbortController();
    const generation = owner.current;
    void reload(controller.signal);
    void readFlowTemplate(controller.signal).then((value) => {
      if (!controller.signal.aborted && generation === owner.current) setTemplate(value);
    }).catch((cause) => {
      if (!controller.signal.aborted && generation === owner.current) setError(cause instanceof Error ? cause.message : String(cause));
    });
    const unsubscribe = subscribeOpenchamberEvents((event) => {
      if (event.type === 'event-stream-ready' || (event.type === 'flow-updated' && event.directory === directory)) void reload(controller.signal);
    });
    return () => { owner.current += 1; controller.abort(); unsubscribe(); };
  }, [directory, enabled, reload, runtimeEpoch]);

  const selected = requirements.find((entry) => entry.id === selection?.requirementId);
  const ticket = selected?.tickets.find((entry) => entry.id === selection?.ticketId);
  const blockers = ticket?.blockedBy.filter((id) => !selected?.tickets.some((entry) => entry.id === id && entry.state === 'done')) ?? [];
  const visible = filter === 'all' ? requirements : requirements.filter((entry) => entry.id === filter);
  const perform = async <T,>(work: () => Promise<T>) => {
    if (busy) return;
    const generation = owner.current;
    setBusy(true); setError('');
    try {
      await work();
      if (generation === owner.current) await reload();
    } catch (cause) {
      if (generation === owner.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (generation === owner.current) setBusy(false); }
  };
  const openNew = () => {
    if (!template) return;
    setDraft(structuredClone(template)); setTask(''); setWorktree(true); setError(''); setCreateError(''); setNewOpen(true);
  };
  const openSettings = () => {
    if (!template) return;
    setDraft(structuredClone(template)); setSettingsOpen(true);
  };
  const openSession = async () => {
    if (!selected) return;
    const generation = owner.current;
    const runs = await fetchWorkflowRuns(selected.sessionId);
    if (generation !== owner.current) return;
    const runId = selectedNodeRunId(selected, selection?.ticketId ?? null);
    const run = runs.find((entry) => entry.id === runId);
    const sessionId = run?.agents.slice().reverse().find((entry) => entry.sessionId)?.sessionId ?? selected.sessionId;
    useSessionUIStore.getState().setCurrentSession(sessionId, selected.workspace);
    useUIStore.getState().closeMainSurfaces();
  };

  return <section className="@container absolute inset-0 z-10 flex min-h-0 flex-col bg-background" aria-label={t('flow.title')}>
    <div className="flex min-h-12 shrink-0 items-center gap-2 px-4">
      <Select value={filter} onValueChange={setFilter}>
        <SelectTrigger aria-label={t('flow.all')} className="min-w-0 max-w-48 shrink"><SelectValue>{filter === 'all' ? t('flow.all') : requirements.find((entry) => entry.id === filter)?.title}</SelectValue></SelectTrigger>
        <SelectContent><SelectItem value="all">{t('flow.all')}</SelectItem>{requirements.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.title}</SelectItem>)}</SelectContent>
      </Select>
      <div className="flex-1" />
      <Button variant="ghost" size="sm" className="hidden @xl:inline-flex" disabled={!directory || loading} onClick={() => void reload()}>{t('sourceBoard.list.refresh')}</Button>
      <Button variant="outline" size="sm" aria-label={t('flow.settings')} disabled={!template || busy} onClick={openSettings}><FlowSettingsIcon className="size-4" /><span className="hidden @xl:inline">{t('flow.settings')}</span></Button>
      <Button size="sm" disabled={!template || !directory || !enabled || busy} onClick={openNew}>{t('flow.new')}</Button>
    </div>
    <div className="min-h-5 shrink-0 px-4 typography-meta text-[var(--status-error-text)]" role="status">{error || notice || loadErrors[0]}</div>
    {!enabled ? <p className="p-6 text-muted-foreground">{t('chat.workflow.turnedOff')}</p> : !directory ? <p className="p-6 text-muted-foreground">{t('flow.noProject')}</p> : loading ? <p className="p-6 text-muted-foreground">{t('common.loading')}</p> : <div className="relative flex min-h-0 flex-1 gap-3 overflow-hidden px-4 pb-4">
      <div className={`min-w-0 flex-1 overflow-x-auto ${selection ? 'hidden @5xl:block' : ''}`}>
        <div className="grid h-full min-w-[1000px] grid-cols-5 gap-3">
          {STATES.map((state) => {
            const cards = visible.flatMap<{ record: FlowRequirement; ticket: FlowTicket | null }>((record) => [
              ...((!record.tickets.length || record.questions.length > 0) && record.state === state ? [{ record, ticket: null }] : []),
              ...record.tickets.filter((entry) => ticketState(record, entry.state) === state).map((entry) => ({ record, ticket: entry })),
            ]);
            return <section key={state} className="flex min-h-0 flex-col" aria-label={t(`flow.state.${state}`)}>
              <div className="flex h-10 shrink-0 items-center gap-2"><span className={`size-1.5 rounded-full ${state === 'running' ? 'bg-[var(--status-info)]' : state === 'attention' ? 'bg-[var(--status-warning)]' : state === 'acceptance' ? 'bg-[var(--status-success)]' : 'bg-muted-foreground'}`} /><h2 className="typography-meta font-medium">{t(`flow.state.${state}`)}</h2><span className="ms-auto typography-meta text-muted-foreground">{cards.length}</span></div>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-2">
                {cards.map(({ record, ticket: item }) => {
                  const cardTitle = item?.title ?? record.title;
                  return <button key={`${record.id}/${item?.id ?? ''}`} type="button" title={cardTitle} aria-pressed={selection?.requirementId === record.id && selection.ticketId === (item?.id ?? null)} onClick={() => { if (selection?.requirementId !== record.id) setAnswers([]); setSelection({ requirementId: record.id, ticketId: item?.id ?? null }); }} className="oc-tile oc-tile-hover min-h-11 w-full min-w-0 shrink-0 rounded-lg px-3 py-2 text-start aria-pressed:bg-interactive-selection aria-pressed:text-interactive-selection-foreground">
                  <span className="oc-ui-start-align block truncate typography-body font-medium" dir="auto">{cardTitle}</span>
                </button>;
                })}
                {!cards.length && <div className="flex flex-1 items-start justify-center pt-8 typography-meta text-muted-foreground">{t('flow.empty')}</div>}
              </div>
            </section>;
          })}
        </div>
      </div>
      {selected && <aside className="flex min-h-0 w-full shrink-0 flex-col overflow-y-auto @5xl:w-96" aria-label={ticket?.title ?? selected.title}>
        <div className="flex items-center gap-2 pb-4"><Button variant="ghost" size="sm" onClick={() => setSelection(null)}><FlowIcon className="me-2 size-4" />{t('flow.title')}</Button><div className="flex-1" /><Button variant="ghost" size="sm" disabled={busy} onClick={() => void perform(openSession)}>{t('workflows.panel.agent.openSession')}</Button></div>
        <h2 className="typography-body font-medium" dir="auto">{ticket?.title ?? selected.title}</h2>
        <FlowTaskRequests key={selected.id} sessionId={selected.sessionId} directory={selected.workspace} />
        {selected.questions.length > 0 && <form className="mt-4 flex flex-col gap-4" onSubmit={(event) => {
          event.preventDefault();
          const generation = owner.current;
          void perform(async () => { await actOnFlow(selected, 'answer', { answers, resume: true }); if (generation === owner.current) setAnswers([]); });
        }}>
          {selected.questions.map((question, index) => <SettingsStackedField key={`${selected.id}/${index}/${question}`} label={question} controlClassName="w-full max-w-none"><Textarea aria-label={question} required value={answers[index] ?? ''} maxLength={8_000} disabled={busy} onChange={(event) => setAnswers((previous) => selected.questions.map((_, current) => current === index ? event.target.value : previous[current] ?? ''))} /></SettingsStackedField>)}
          <Button type="submit" disabled={busy || selected.questions.some((_, index) => !answers[index]?.trim())}>{t('flow.answer')}</Button>
        </form>}
        <p className="mt-3 whitespace-pre-wrap typography-meta" dir="auto">{ticket?.description ?? selected.goal ?? selected.task}</p>
        {!ticket && selected.goal && <details className="mt-3"><summary className="cursor-pointer typography-meta">{t('flow.description')}</summary><p className="mt-3 whitespace-pre-wrap typography-meta" dir="auto">{selected.task}</p></details>}
        <code dir="ltr" className="mt-3 break-all typography-micro text-muted-foreground">{selected.workspace}</code>
        {selected.error && <p className="mt-4 rounded-lg bg-[var(--status-warning-background)] p-3 typography-meta text-[var(--status-warning-text)]" role="alert">{selected.error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {selected.state === 'running' ? <Button variant="outline" size="sm" disabled={busy} onClick={() => void perform(() => actOnFlow(selected, 'stop'))}>{t('chat.workflow.action.stop')}</Button> : selected.state !== 'done' && <Button size="sm" disabled={busy || !!selected.questions.length} onClick={() => void perform(() => actOnFlow(selected, 'start'))}>{t(selected.state === 'todo' ? 'workflows.panel.saved.confirmAction' : 'chat.workflow.action.resume')}</Button>}
          {ticket?.state === 'acceptance' && <Button size="sm" disabled={busy} onClick={() => void perform(() => actOnFlow(selected, 'accept', { ticketId: ticket.id }))}>{t('flow.accept')}</Button>}
          {selected.artifacts.release && selected.state !== 'done' && <Button size="sm" disabled={busy || selected.state === 'running'} onClick={() => void perform(() => actOnFlow(selected, 'accept'))}>{t('flow.accept')}</Button>}
        </div>
        {ticket && <p className="mt-4 typography-meta text-muted-foreground">{t('flow.reviews', { used: ticket.reviewUsed, limit: selected.config.maxReviewRounds })}</p>}
        {blockers.length ? <p className="mt-2 typography-meta text-muted-foreground">{t('flow.blocked', { tickets: blockers.join(', ') })}</p> : null}
        {ticket && <ul className="mt-6 list-disc space-y-2 ps-5 typography-meta">{ticket.acceptance.map((criterion) => <li key={criterion} dir="auto">{criterion}</li>)}</ul>}
        {ticket?.review?.findings.map((finding) => <div key={`${finding.file}/${finding.scenario}`} className="mt-4 rounded-lg bg-[var(--status-error-background)] p-3 typography-meta text-[var(--status-error-text)]"><code dir="ltr">{finding.file}</code><p dir="auto">{finding.scenario}</p><p dir="auto">{finding.cause}</p><p dir="auto">{finding.fix}</p></div>)}
        {ticket?.development && <details className="mt-6"><summary className="cursor-pointer typography-meta">{t('flow.evidence')}</summary><ul className="mt-3 list-disc space-y-2 ps-5 typography-meta">{ticket.development.evidence.map((item) => <li key={item} dir="auto">{item}</li>)}</ul></details>}
        {selected.artifacts.spec && <details className="mt-6"><summary className="cursor-pointer typography-meta">{t('flow.spec')}</summary><p className="mt-3 whitespace-pre-wrap typography-meta" dir="auto">{selected.artifacts.spec.content}</p></details>}
        {selected.artifacts.release && <p className="mt-6 whitespace-pre-wrap typography-meta" dir="auto">{selected.artifacts.release.summary}</p>}
        <details className="mt-6" open><summary className="cursor-pointer typography-meta">{t('flow.activity')}</summary><ol className="mt-3 space-y-4 typography-meta">{selected.events.slice().reverse().map((entry, index) => <li key={`${entry.at}/${index}`}><span className="text-muted-foreground">{entry.node}</span><p className="mt-1 whitespace-pre-wrap" dir="auto">{entry.message}</p></li>)}</ol></details>
      </aside>}
    </div>}
    {newOpen && draft && <Dialog open onOpenChange={(open) => { if (!busy) setNewOpen(open); }}><DialogContent className="max-h-[85dvh] max-w-3xl overflow-y-auto" aria-describedby={undefined}><DialogTitle>{t('flow.new')}</DialogTitle>
      <form className="flex flex-col gap-5" onSubmit={(event) => {
        event.preventDefault();
        setCreateError('');
        const generation = owner.current;
        void perform(async () => {
          const record = await createFlowRequirement({ task, directory, runInWorktree: worktree, config: draft }).catch((cause: unknown) => {
            if (generation === owner.current) setCreateError(cause instanceof Error ? cause.message : String(cause));
            throw cause;
          });
          if (generation !== owner.current) return;
          setNewOpen(false); setSelection({ requirementId: record.id, ticketId: null });
          if (worktree && project) {
            try { await refreshProjectWorktrees(project); } catch (cause) {
              if (generation === owner.current) setNotice(cause instanceof Error ? cause.message : String(cause));
            }
          }
        });
      }}>
        <SettingsStackedField label={t('flow.description')} controlClassName="w-full max-w-none"><Textarea aria-label={t('flow.description')} required rows={5} maxLength={20_000} disabled={busy} value={task} onChange={(event) => setTask(event.target.value)} /></SettingsStackedField>
        <SettingsCheckboxRow checked={worktree} onChange={setWorktree} label={t('workflows.flow.worktree')} ariaLabel={t('workflows.flow.worktree')} />
        <details><summary className="cursor-pointer typography-meta">{t('flow.settings')}</summary><div className="pt-5"><NodeConfigEditor directory={directory} value={draft} onChange={setDraft} /></div></details>
        <p className={`min-h-5 typography-meta ${createError ? 'text-[var(--status-error-text)]' : 'text-muted-foreground'}`} role="status">{createError || (busy ? t('common.loading') : '')}</p>
        <div className="flex justify-end gap-2"><Button variant="ghost" type="button" disabled={busy} onClick={() => setNewOpen(false)}>{t('dialog.common.actions.cancel')}</Button><Button type="submit" disabled={busy || !task.trim()}>{t('flow.create')}</Button></div>
      </form>
    </DialogContent></Dialog>}
    {settingsOpen && draft && <Dialog open onOpenChange={(open) => { if (!busy) setSettingsOpen(open); }}><DialogContent className="max-h-[85dvh] max-w-4xl overflow-y-auto" aria-describedby={undefined}><DialogTitle>{t('flow.settings')}</DialogTitle>
      <NodeConfigEditor directory={directory} value={draft} onChange={setDraft} />
      <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={() => setSettingsOpen(false)}>{t('dialog.common.actions.cancel')}</Button><Button disabled={busy} onClick={() => {
        const generation = owner.current;
        void perform(async () => { const saved = await saveFlowTemplate(draft); if (generation === owner.current) { setTemplate(saved); setSettingsOpen(false); } });
      }}>{t('flow.save')}</Button></div>
    </DialogContent></Dialog>}
  </section>;
}
