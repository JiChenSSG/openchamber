import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/lib/i18n';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (task: string, runInWorktree: boolean) => Promise<void>;
};

export function DeliveryWorkflowDialog({ open, onOpenChange, onStart }: Props) {
  const { t } = useI18n();
  const [task, setTask] = React.useState('');
  const [worktree, setWorktree] = React.useState(true);
  const [starting, setStarting] = React.useState(false);
  const taskId = React.useId();
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!starting) onOpenChange(next); }}>
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
        <DialogTitle>{t('workflows.flow.title')}</DialogTitle>
        <form className="flex flex-col gap-4" onSubmit={async (event) => {
          event.preventDefault();
          if (!task.trim() || starting) return;
          setStarting(true);
          try { await onStart(task.trim(), worktree); } finally { setStarting(false); }
        }}>
          <label htmlFor={taskId} className="flex flex-col gap-2 typography-meta">
            {t('workflows.flow.task')}
            <Textarea id={taskId} aria-label={t('workflows.flow.task')} value={task} onChange={(event) => setTask(event.target.value)} placeholder={t('workflows.flow.placeholder')} rows={5} maxLength={20_000} required disabled={starting} />
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 typography-meta">
            <Checkbox checked={worktree} onChange={setWorktree} disabled={starting} ariaLabel={t('workflows.flow.worktree')} />
            {t('workflows.flow.worktree')}
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={starting} onClick={() => onOpenChange(false)}>{t('dialog.common.actions.cancel')}</Button>
            <Button type="submit" disabled={starting || !task.trim()}>{t(starting ? 'workflows.flow.starting' : 'workflows.panel.saved.confirmAction')}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
