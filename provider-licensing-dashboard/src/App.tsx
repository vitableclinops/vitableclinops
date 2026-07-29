import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Check, Loader2, Plus, RefreshCw, X } from 'lucide-react';
import { envError, supabase } from './lib/supabase';
import type { Database, EffectiveStatus, LicenseType, TaskStatus } from './types/supabase';

type Provider = Database['public']['Tables']['providers']['Row'];
type LicenseTask = Database['public']['Tables']['license_tasks']['Row'];
type EffectiveLicense = Database['public']['Views']['provider_effective_licenses']['Row'];

type LicensePair = Record<LicenseType, EffectiveLicense | null>;
type TaskPair = Record<LicenseType, LicenseTask[]>;

type StateCardData = {
  stateCode: string;
  stateName: string;
  licenses: LicensePair;
  tasks: TaskPair;
  isCovered: boolean;
  isNotApplicable: boolean;
};

const LICENSE_TYPES: LicenseType[] = ['RN', 'NP'];
const DEFAULT_PROVIDER_NAME = 'Genevieve Teetie';

// Reserved for future scope changes. The current 51 jurisdictions all apply.
const NOT_APPLICABLE_STATE_CODES = new Set<string>();

const statusCopy: Record<EffectiveStatus, string> = {
  active_direct: 'Active direct',
  active_via_compact: 'Compact',
  in_progress: 'In progress',
  needed: 'Needed',
};

function App() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [licenses, setLicenses] = useState<EffectiveLicense[]>([]);
  const [tasks, setTasks] = useState<LicenseTask[]>([]);
  const [selectedStateCode, setSelectedStateCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(envError);
  const [savingTaskIds, setSavingTaskIds] = useState<Set<string>>(new Set());
  const [addingStepKey, setAddingStepKey] = useState<string | null>(null);

  const selectedProvider = providers.find(provider => provider.id === selectedProviderId) ?? null;

  const loadProviders = useCallback(async () => {
    if (envError) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: providerError } = await supabase
      .from('providers')
      .select('*')
      .order('name', { ascending: true });

    if (providerError) {
      setError(providerError.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as unknown as Provider[];
    setProviders(rows);

    const defaultProvider =
      rows.find(provider => provider.name.toLowerCase() === DEFAULT_PROVIDER_NAME.toLowerCase()) ??
      rows[0] ??
      null;

    setSelectedProviderId(current => current || defaultProvider?.id || '');
    setLoading(false);
  }, []);

  const loadDashboardData = useCallback(async (providerId: string, mode: 'loading' | 'refreshing' = 'refreshing') => {
    if (!providerId || envError) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (mode === 'loading') setLoading(true);
    else setRefreshing(true);
    setError(null);

    const [licenseResult, taskResult] = await Promise.all([
      supabase
        .from('provider_effective_licenses')
        .select('*')
        .eq('provider_id', providerId)
        .order('state_code', { ascending: true })
        .order('license_type', { ascending: true }),
      supabase
        .from('license_tasks')
        .select('*')
        .eq('provider_id', providerId)
        .order('state_code', { ascending: true })
        .order('license_type', { ascending: true })
        .order('step_order', { ascending: true }),
    ]);

    if (licenseResult.error) setError(licenseResult.error.message);
    else setLicenses((licenseResult.data ?? []) as unknown as EffectiveLicense[]);

    if (taskResult.error) setError(taskResult.error.message);
    else setTasks((taskResult.data ?? []) as unknown as LicenseTask[]);

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    if (selectedProviderId) {
      void loadDashboardData(selectedProviderId, 'loading');
    }
  }, [selectedProviderId, loadDashboardData]);

  const stateCards = useMemo(() => {
    const byState = new Map<string, StateCardData>();

    for (const license of licenses) {
      if (!byState.has(license.state_code)) {
        byState.set(license.state_code, {
          stateCode: license.state_code,
          stateName: license.state_name,
          licenses: { RN: null, NP: null },
          tasks: { RN: [], NP: [] },
          isCovered: false,
          isNotApplicable: NOT_APPLICABLE_STATE_CODES.has(license.state_code),
        });
      }

      byState.get(license.state_code)!.licenses[license.license_type] = license;
    }

    for (const task of tasks) {
      const card = byState.get(task.state_code);
      if (card) card.tasks[task.license_type].push(task);
    }

    return [...byState.values()]
      .map(card => ({
        ...card,
        isCovered:
          card.isNotApplicable ||
          LICENSE_TYPES.every(type => isActive(card.licenses[type]?.effective_status)),
      }))
      .sort((a, b) => a.stateCode.localeCompare(b.stateCode));
  }, [licenses, tasks]);

  const selectedState = stateCards.find(card => card.stateCode === selectedStateCode) ?? null;
  const coveredCount = stateCards.filter(card => card.isCovered || card.isNotApplicable).length;
  const directLicenseCount = licenses.filter(license => license.license_id).length;
  const showEmptyState = selectedProvider && licenses.length > 0 && directLicenseCount === 0;

  async function handleTaskToggle(task: LicenseTask, checked: boolean) {
    setSavingTaskIds(current => new Set(current).add(task.id));
    setError(null);

    const patch: Database['public']['Tables']['license_tasks']['Update'] = {
      status: checked ? 'complete' : 'not_started',
      completed_at: checked ? new Date().toISOString() : null,
    };

    const { error: updateError } = await supabase
      .from('license_tasks')
      .update(patch)
      .eq('id', task.id);

    setSavingTaskIds(current => {
      const next = new Set(current);
      next.delete(task.id);
      return next;
    });

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await loadDashboardData(task.provider_id);
  }

  async function handleAddStep(stateCode: string, licenseType: LicenseType, stepName: string) {
    if (!selectedProviderId) return;

    const trimmed = stepName.trim();
    if (!trimmed) return;

    const key = `${stateCode}-${licenseType}`;
    setAddingStepKey(key);
    setError(null);

    const existingSteps = tasks.filter(
      task => task.state_code === stateCode && task.license_type === licenseType,
    );
    const stepOrder = existingSteps.reduce((max, task) => Math.max(max, task.step_order), 0) + 1;

    const payload: Database['public']['Tables']['license_tasks']['Insert'] = {
      provider_id: selectedProviderId,
      state_code: stateCode,
      license_type: licenseType,
      step_name: trimmed,
      step_order: stepOrder,
      status: 'not_started',
    };

    const { error: insertError } = await supabase.from('license_tasks').insert(payload);

    setAddingStepKey(null);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    await loadDashboardData(selectedProviderId);
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal text-slate-950">
              Provider Licensing Tracker
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              RN and NP coverage by jurisdiction
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="flex min-w-[260px] flex-col gap-1 text-xs font-medium uppercase tracking-wide text-slate-500">
              Provider
              <select
                value={selectedProviderId}
                onChange={event => {
                  setSelectedProviderId(event.target.value);
                  setSelectedStateCode(null);
                }}
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium normal-case tracking-normal text-slate-900 shadow-sm"
                disabled={providers.length === 0}
              >
                {providers.map(provider => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="min-w-[190px] rounded-md border border-slate-200 bg-slate-50 px-4 py-2">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Covered
              </div>
              <div className="text-lg font-semibold text-slate-950">
                {coveredCount} of 51 states covered
              </div>
            </div>

            <button
              type="button"
              onClick={() => selectedProviderId && loadDashboardData(selectedProviderId)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!selectedProviderId || refreshing}
              title="Refresh licensing data"
            >
              <RefreshCw className={clsx('h-4 w-4', refreshing && 'animate-spin')} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6">
        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {showEmptyState && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Run the Medallion sync to populate direct license rows for {selectedProvider.name}.
          </div>
        )}

        <StatusLegend />

        {loading ? (
          <div className="flex min-h-[420px] items-center justify-center text-slate-600">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading licensing data
          </div>
        ) : stateCards.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">No licensing grid found</h2>
            <p className="mt-2 text-sm text-slate-600">
              Run the licensing tracker migration, then run the Medallion sync to populate.
            </p>
          </div>
        ) : (
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
            {stateCards.map(card => (
              <StateCard
                key={card.stateCode}
                card={card}
                providerHomeState={selectedProvider?.home_state ?? null}
                selected={selectedStateCode === card.stateCode}
                onClick={() => setSelectedStateCode(card.stateCode)}
              />
            ))}
          </section>
        )}
      </main>

      <StateDrawer
        state={selectedState}
        provider={selectedProvider}
        savingTaskIds={savingTaskIds}
        addingStepKey={addingStepKey}
        onClose={() => setSelectedStateCode(null)}
        onTaskToggle={handleTaskToggle}
        onAddStep={handleAddStep}
      />
    </div>
  );
}

function StateCard({
  card,
  providerHomeState,
  selected,
  onClick,
}: {
  card: StateCardData;
  providerHomeState: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'min-h-[136px] rounded-md border bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-md',
        selected && 'border-blue-500 ring-2 ring-blue-100',
        card.isNotApplicable && 'bg-slate-100 opacity-60',
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="text-lg font-semibold leading-6 text-slate-950">{card.stateCode}</div>
          <div className="line-clamp-2 min-h-[36px] text-xs leading-4 text-slate-600">
            {card.stateName}
          </div>
        </div>
        {card.isCovered && (
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <Check className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      <div className="space-y-2">
        {LICENSE_TYPES.map(type => (
          <StatusRow
            key={type}
            type={type}
            license={card.licenses[type]}
            providerHomeState={providerHomeState}
          />
        ))}
      </div>
    </button>
  );
}

function StatusRow({
  type,
  license,
  providerHomeState,
}: {
  type: LicenseType;
  license: EffectiveLicense | null;
  providerHomeState: string | null;
}) {
  const status = license?.effective_status ?? 'needed';
  const isCompact = status === 'active_via_compact';
  const tooltip = isCompact
    ? type === 'RN'
      ? `Covered by multistate RN from ${providerHomeState ?? license?.home_state ?? 'home state'}`
      : `Covered by APRN Compact from ${providerHomeState ?? license?.home_state ?? 'home state'}`
    : undefined;

  return (
    <div className="flex min-h-6 items-center justify-between gap-2 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot status={status} title={tooltip} />
        <span className="font-semibold text-slate-800">{type}</span>
        <span className="truncate text-slate-500">
          {license?.direct_status === 'submitted' ? 'Submitted' : statusCopy[status]}
        </span>
      </div>
      {isCompact && (
        <span
          className="rounded-sm border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700"
          title={tooltip}
        >
          compact
        </span>
      )}
    </div>
  );
}

function StatusDot({ status, title }: { status: EffectiveStatus; title?: string }) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-block h-3.5 w-3.5 shrink-0 rounded-full border',
        status === 'active_direct' && 'border-emerald-600 bg-emerald-600',
        status === 'active_via_compact' && 'border-blue-600 bg-blue-600',
        status === 'in_progress' && 'border-amber-500 bg-[linear-gradient(90deg,#f59e0b_50%,#ffffff_50%)]',
        status === 'needed' && 'border-slate-300 bg-white',
      )}
    />
  );
}

function StatusLegend() {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 shadow-sm">
      <LegendItem status="active_direct" label="Active direct" />
      <LegendItem status="active_via_compact" label="Compact coverage" />
      <LegendItem status="in_progress" label="In progress or submitted" />
      <LegendItem status="needed" label="Needed" />
    </div>
  );
}

function LegendItem({ status, label }: { status: EffectiveStatus; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <StatusDot status={status} />
      <span>{label}</span>
    </div>
  );
}

function StateDrawer({
  state,
  provider,
  savingTaskIds,
  addingStepKey,
  onClose,
  onTaskToggle,
  onAddStep,
}: {
  state: StateCardData | null;
  provider: Provider | null;
  savingTaskIds: Set<string>;
  addingStepKey: string | null;
  onClose: () => void;
  onTaskToggle: (task: LicenseTask, checked: boolean) => Promise<void>;
  onAddStep: (stateCode: string, licenseType: LicenseType, stepName: string) => Promise<void>;
}) {
  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    if (state) window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [state, onClose]);

  if (!state || !provider) return null;

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/25"
        onClick={onClose}
        aria-label="Close drawer"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${state.stateName} licensing details`}
        className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col bg-white shadow-drawer"
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-slate-500">{provider.name}</div>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">
                {state.stateCode} · {state.stateName}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="space-y-5">
            {LICENSE_TYPES.map(type => (
              <LicenseSection
                key={type}
                licenseType={type}
                license={state.licenses[type]}
                tasks={state.tasks[type]}
                providerHomeState={provider.home_state}
                savingTaskIds={savingTaskIds}
                addingStepKey={addingStepKey}
                onTaskToggle={onTaskToggle}
                onAddStep={stepName => onAddStep(state.stateCode, type, stepName)}
              />
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

function LicenseSection({
  licenseType,
  license,
  tasks,
  providerHomeState,
  savingTaskIds,
  addingStepKey,
  onTaskToggle,
  onAddStep,
}: {
  licenseType: LicenseType;
  license: EffectiveLicense | null;
  tasks: LicenseTask[];
  providerHomeState: string | null;
  savingTaskIds: Set<string>;
  addingStepKey: string | null;
  onTaskToggle: (task: LicenseTask, checked: boolean) => Promise<void>;
  onAddStep: (stepName: string) => Promise<void>;
}) {
  const [stepName, setStepName] = useState('');
  const status = license?.effective_status ?? 'needed';
  const isAdding = addingStepKey === `${license?.state_code}-${licenseType}`;

  async function submitStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextStep = stepName.trim();
    if (!nextStep) return;
    await onAddStep(nextStep);
    setStepName('');
  }

  return (
    <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-950">{licenseType} License</h3>
          <div className="mt-2 flex items-center gap-2 text-sm text-slate-700">
            <StatusDot status={status} />
            <span>{license?.direct_status === 'submitted' ? 'Submitted' : statusCopy[status]}</span>
            {status === 'active_via_compact' && (
              <span
                className="rounded-sm border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700"
                title={
                  licenseType === 'RN'
                    ? `Covered by multistate RN from ${providerHomeState ?? license?.home_state ?? 'home state'}`
                    : `Covered by APRN Compact from ${providerHomeState ?? license?.home_state ?? 'home state'}`
                }
              >
                compact
              </span>
            )}
          </div>
        </div>

        <div className="text-right text-xs text-slate-500">
          <div>License number</div>
          <div className="mt-1 font-semibold text-slate-900">
            {license?.license_number || 'None recorded'}
          </div>
          {license?.expiration_date && (
            <div className="mt-1">Expires {formatDate(license.expiration_date)}</div>
          )}
        </div>
      </div>

      <div className="mt-4 border-t border-slate-200 pt-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Checklist
        </div>

        {tasks.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-3 text-sm text-slate-500">
            No steps yet.
          </div>
        ) : (
          <div className="space-y-2">
            {tasks.map(task => (
              <TaskRow
                key={task.id}
                task={task}
                saving={savingTaskIds.has(task.id)}
                onToggle={checked => onTaskToggle(task, checked)}
              />
            ))}
          </div>
        )}

        <form onSubmit={submitStep} className="mt-3 flex gap-2">
          <input
            value={stepName}
            onChange={event => setStepName(event.target.value)}
            placeholder="Add a licensing step"
            className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
          />
          <button
            type="submit"
            disabled={!stepName.trim() || isAdding}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            title="Add step"
          >
            {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add step
          </button>
        </form>
      </div>
    </section>
  );
}

function TaskRow({
  task,
  saving,
  onToggle,
}: {
  task: LicenseTask;
  saving: boolean;
  onToggle: (checked: boolean) => Promise<void>;
}) {
  const checked = task.status === 'complete';

  return (
    <label className="flex min-h-11 items-start gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
      <span className="relative mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          disabled={saving}
          onChange={event => onToggle(event.target.checked)}
          className="h-5 w-5 rounded border-slate-300 text-emerald-600"
        />
        {saving && (
          <span className="absolute inset-0 flex items-center justify-center rounded bg-white/80">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={clsx('block font-medium text-slate-900', checked && 'text-slate-500 line-through')}>
          {task.step_name}
        </span>
        <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>{taskStatusCopy(task.status)}</span>
          {task.owner && <span>Owner: {task.owner}</span>}
          {task.due_date && <span>Due {formatDate(task.due_date)}</span>}
          {task.completed_at && <span>Completed {formatDate(task.completed_at)}</span>}
        </span>
      </span>
    </label>
  );
}

function isActive(status: EffectiveStatus | undefined) {
  return status === 'active_direct' || status === 'active_via_compact';
}

function taskStatusCopy(status: TaskStatus) {
  return status.replace(/_/g, ' ');
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export default App;
