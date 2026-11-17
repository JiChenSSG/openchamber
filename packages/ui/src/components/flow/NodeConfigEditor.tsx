import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsChipGroup, SettingsCheckboxRow, SettingsStackedField, SettingsTwoColumn } from '@/components/sections/shared/SettingsSection';
import { useConfigStore, selectProvidersForDirectory, selectConfigAgentsForDirectory } from '@/stores/useConfigStore';
import { useSkillsStore, selectAvailableSkillsForDirectory } from '@/stores/useSkillsStore';
import { filterVisibleAgents } from '@/stores/useAgentsStore';
import { useOpenCodeReadiness } from '@/hooks/useOpenCodeReadiness';
import { useI18n } from '@/lib/i18n';
import { listModelVariantIds } from '@/lib/modelVariants';
import { FLOW_NODES, type FlowNode, type FlowTemplate } from '@/lib/flow/api';

function ValueSelect({ label, value, items, onChange }: { label: string; value: string; items: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  const { t } = useI18n();
  const choices = [{ value: '__inherit__', label: t('flow.default') }, ...items];
  if (value && !items.some((item) => item.value === value)) choices.push({ value, label: value });
  return <Select value={value || '__inherit__'} onValueChange={(next) => onChange(next === '__inherit__' ? '' : next)}>
    <SelectTrigger aria-label={label} className="max-w-full"><SelectValue>{choices.find((item) => item.value === (value || '__inherit__'))?.label}</SelectValue></SelectTrigger>
    <SelectContent>{choices.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
  </Select>;
}

export function NodeConfigEditor({ directory, value, onChange }: { directory: string; value: FlowTemplate; onChange: (config: FlowTemplate) => void }) {
  const { t } = useI18n();
  const [node, setNode] = React.useState<FlowNode>('router');
  const config = value.nodes[node];
  const providers = useConfigStore((state) => selectProvidersForDirectory(state, directory));
  const agents = useConfigStore((state) => selectConfigAgentsForDirectory(state, directory));
  const skills = useSkillsStore((state) => selectAvailableSkillsForDirectory(state, directory));
  const { isReady: modelsReady } = useOpenCodeReadiness('models', directory);
  const { isReady: agentsReady } = useOpenCodeReadiness('agents', directory);
  React.useEffect(() => {
    if (!modelsReady) void useConfigStore.getState().loadProviders({ directory, source: 'Flow:nodes' });
    if (!agentsReady) void useConfigStore.getState().loadAgents({ directory, source: 'Flow:nodes' });
    void useSkillsStore.getState().loadSkills(directory);
  }, [agentsReady, directory, modelsReady]);
  const models = providers.flatMap((provider) => provider.models.map((model) => ({ value: `${provider.id}/${model.id}`, label: `${provider.name} / ${model.name}`, model })));
  const selectedModel = models.find((model) => model.value === config.model)?.model;
  const variants = listModelVariantIds(selectedModel?.variants);
  const edit = (patch: Partial<typeof config>) => onChange({ ...value, nodes: { ...value.nodes, [node]: { ...config, ...patch } } });
  const skillChoices = [...skills.map((skill) => ({ id: skill.id, name: skill.name })), ...config.skills.filter((id) => !skills.some((skill) => skill.id === id)).map((id) => ({ id, name: id }))];
  return <div className="@container flex min-w-0 flex-col gap-6">
    <SettingsTwoColumn>
      <SettingsStackedField label={t('flow.reviewLimit')}><Input type="number" min={1} max={10} aria-label={t('flow.reviewLimit')} value={value.maxReviewRounds} onChange={(event) => { const count = Number(event.target.value); if (Number.isInteger(count) && count >= 1 && count <= 10) onChange({ ...value, maxReviewRounds: count }); }} className="max-w-24" /></SettingsStackedField>
      <SettingsStackedField label={t('flow.timeLimit')}><Input type="number" min={1} max={480} aria-label={t('flow.timeLimit')} value={value.maxTicketMinutes} onChange={(event) => { const count = Number(event.target.value); if (Number.isInteger(count) && count >= 1 && count <= 480) onChange({ ...value, maxTicketMinutes: count }); }} className="max-w-24" /></SettingsStackedField>
    </SettingsTwoColumn>
    <SettingsStackedField label={t('flow.clarification')} controlClassName="max-w-none">
      <SettingsChipGroup value={value.clarification} options={(['auto', 'deep', 'skip'] as const).map((mode) => ({ value: mode, label: t(`flow.${mode}`) }))} onChange={(clarification) => onChange({ ...value, clarification })} aria-label={t('flow.clarification')} />
    </SettingsStackedField>
    <div className="flex min-w-0 gap-4">
      <nav aria-label={t('flow.settings')} className="flex w-36 shrink-0 flex-col gap-1">
        {FLOW_NODES.map((id) => <Button key={id} variant="chip" size="sm" aria-pressed={node === id} onClick={() => setNode(id)} className="justify-start truncate">{t(`flow.node.${id}`)}</Button>)}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <SettingsTwoColumn>
          <SettingsStackedField label={t('flow.model')}><ValueSelect label={t('flow.model')} value={config.model} items={models} onChange={(model) => edit({ model, variant: '' })} /></SettingsStackedField>
          <SettingsStackedField label={t('flow.variant')}><ValueSelect label={t('flow.variant')} value={config.variant} items={variants.map((variant) => ({ value: variant, label: variant }))} onChange={(variant) => edit({ variant })} /></SettingsStackedField>
        </SettingsTwoColumn>
        {node !== 'router' && <SettingsStackedField label={t('flow.agent')}><ValueSelect label={t('flow.agent')} value={config.agent} items={filterVisibleAgents(agents).map((agent) => ({ value: agent.name, label: agent.displayName }))} onChange={(agent) => edit({ agent })} /></SettingsStackedField>}
        <SettingsStackedField label={t('flow.prompt')} controlClassName="w-full max-w-none"><Textarea aria-label={t('flow.prompt')} rows={7} value={config.prompt} maxLength={20_000} onChange={(event) => edit({ prompt: event.target.value })} className="w-full resize-y" /></SettingsStackedField>
        <SettingsStackedField label={t('flow.skills')} controlClassName="w-full max-w-none">
          <div className="max-h-40 w-full overflow-y-auto">
            {skillChoices.map((skill) => <SettingsCheckboxRow key={skill.id} checked={config.skills.includes(skill.id)} label={skill.name} ariaLabel={skill.name} onChange={(checked) => edit({ skills: checked ? [...config.skills, skill.id] : config.skills.filter((id) => id !== skill.id) })} />)}
          </div>
        </SettingsStackedField>
      </div>
    </div>
  </div>;
}
