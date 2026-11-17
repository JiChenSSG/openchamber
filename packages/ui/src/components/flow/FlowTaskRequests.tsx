import { FormCard } from '@/components/chat/FormCard';
import { PermissionCard } from '@/components/chat/PermissionCard';
import { useScopedBlockingForms, useScopedBlockingPermissions } from '@/sync/sync-context';

export function FlowTaskRequests({ sessionId, directory }: { sessionId: string; directory: string }) {
  const permissions = useScopedBlockingPermissions(sessionId, directory);
  const forms = useScopedBlockingForms(sessionId, directory);
  return <div className="mt-4 flex flex-col gap-3 empty:hidden">
    {permissions.map((permission) => <PermissionCard key={permission.id} permission={permission} />)}
    {!permissions.length && forms.map((form) => <FormCard key={form.id} form={form} />)}
  </div>;
}
