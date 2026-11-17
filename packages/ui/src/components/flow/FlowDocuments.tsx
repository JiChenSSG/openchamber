import * as React from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { readFlowDocument, type FlowDocument, type FlowRequirement } from '@/lib/flow/api';

type Preview = { id: string; version: number } & (
  | { status: 'loading' }
  | { status: 'ready'; document: FlowDocument }
  | { status: 'error'; message: string }
);

export function FlowDocuments({ requirement }: { requirement: FlowRequirement }) {
  const { t } = useI18n();
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const pending = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => pending.current?.abort(), []);
  const open = async (id: string, version: number) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setPreview({ id, version, status: 'loading' });
    try {
      const document = await readFlowDocument(requirement.id, id, version, controller.signal);
      if (!controller.signal.aborted) setPreview({ id, version, status: 'ready', document });
    } catch (cause) {
      if (!controller.signal.aborted) setPreview({ id, version, status: 'error', message: cause instanceof Error ? cause.message : String(cause) });
    }
  };
  return <details className="mt-6" onToggle={(event) => { if (!event.currentTarget.open) { pending.current?.abort(); setPreview(null); } }}>
    <summary className="cursor-pointer typography-meta">{t('flow.documents.title')} · {requirement.documents.length}</summary>
    {!requirement.documents.length && <p className="mt-3 typography-meta text-muted-foreground">{t('flow.documents.empty')}</p>}
    <ul className="mt-3 space-y-1">
      {requirement.documents.slice().reverse().map((entry) => <li key={`${entry.id}/${entry.version}`}>
        <Button variant="ghost" className="w-full justify-start gap-2 text-start" aria-pressed={preview !== null && preview.id === entry.id && preview.version === entry.version} onClick={() => void open(entry.id, entry.version)}>
          <span className="min-w-0 flex-1 truncate" dir="auto" title={entry.title}>{entry.title}</span>
          <span className="shrink-0 typography-micro text-muted-foreground">{t('flow.documents.version', { version: entry.version })} · {t(`flow.documents.${entry.status}`)}</span>
        </Button>
      </li>)}
    </ul>
    <div className="mt-3 min-h-5 typography-meta" aria-live="polite">
      {preview?.status === 'loading' && <span className="text-muted-foreground">{t('flow.documents.loading')}</span>}
      {preview?.status === 'error' && <p className="text-[var(--status-error-text)]" role="alert">{preview.message}</p>}
      {preview?.status === 'ready' && <div className="oc-tile rounded-lg p-3">
        <p className="mb-3 typography-micro text-muted-foreground">{t(`flow.node.${preview.document.node}`)}{preview.document.ticketId ? ` · ${preview.document.ticketId}` : ''} · <bdi>{preview.document.runId}</bdi></p>
        <pre className="whitespace-pre-wrap break-words font-sans typography-meta" dir="auto">{preview.document.content}</pre>
      </div>}
    </div>
  </details>;
}
