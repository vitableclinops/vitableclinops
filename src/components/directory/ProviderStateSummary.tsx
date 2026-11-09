import { Badge } from '@/components/ui/badge';
import { usePcpCoverage } from '@/hooks/usePcpCoverage';
import { activeLicensedStates, useMedallionDirectoryData } from '@/hooks/useMedallionDirectory';
import { useExternalDirectoryData } from '@/hooks/useExternalImport';
import { summarizeLicenses } from '@/lib/externalImport';
import { pcpCellFor } from '@/lib/pcpCoverage';
import { licensedNotActiveStates } from '@/lib/licensedNotActiveStates';
import { CopyValueButton } from './CopyValueButton';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { useActiveStateAgreementAudit } from '@/hooks/useActiveStateAgreementAudit';
import { providerStateExportRows } from '@/lib/providerStateExport';
import * as XLSX from 'xlsx';

type Profile = Parameters<typeof pcpCellFor>[0] & { full_name?: string | null };

/** Licenses-tab summary: EHR-active states vs licensed-but-not-active, from the same live sources as States & Compliance. */
export function ProviderStateSummary({ provider }: { provider: Profile }) {
  const { data: coverage, isLoading: covLoading } = usePcpCoverage(true);
  const { data: medallion, isLoading: medLoading } = useMedallionDirectoryData(true);
  const { data: external } = useExternalDirectoryData(true);
  const audit = useActiveStateAgreementAudit(true);

  if (covLoading || medLoading) return <p className="text-sm text-muted-foreground">Loading states…</p>;

  const cell = pcpCellFor(provider, coverage);
  let licensed = activeLicensedStates(medallion?.licensesByProfile.get(provider.id));
  let incomplete = false;
  if (!licensed.length && !medallion?.byProfile.get(provider.id)) {
    const ext = external?.byProfile.get(provider.id);
    if (ext) {
      const s = summarizeLicenses(ext.licenses, ext.licenseInventory);
      licensed = s.states;
      incomplete = s.incomplete;
    }
  }
  const active = [...new Set(cell.states)].sort();
  const coverageKnown = cell.kind === 'states' || cell.kind === 'none_returned' || (cell.kind === 'needs_review' && active.length > 0);
  const notActive = coverageKnown ? licensedNotActiveStates(licensed, active) : [];

  const exportStates = () => {
    if (!audit.data) return;
    const rows = providerStateExportRows(provider, licensed, active, coverageKnown, audit.data);
    if (!rows.length) return;
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet['!cols'] = [{ wch: 28 }, { wch: 8 }, { wch: 34 }, { wch: 65 }, { wch: 65 }, { wch: 65 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'States and requirements');
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(provider.full_name || 'provider').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}-states-and-requirements.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const Row = ({ title, states, tone, empty }: { title: string; states: string[]; tone: 'active' | 'muted'; empty: string }) => (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{title} <span className="text-muted-foreground font-normal">({states.length})</span></h4>
        {states.length > 0 && <CopyValueButton value={states.join(', ')} />}
      </div>
      {states.length ? (
        <div className="flex flex-wrap gap-1.5">
          {states.map(s => (
            <Badge key={s} variant={tone === 'active' ? 'default' : 'outline'} className="font-mono">{s}</Badge>
          ))}
        </div>
      ) : <p className="text-sm text-muted-foreground">{empty}</p>}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/40 p-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Total # of Licenses:</span>
        <span className="text-lg font-bold">{new Set([...licensed, ...active]).size}</span>
        <Button variant="outline" size="sm" className="sm:ml-auto" onClick={exportStates}
          disabled={!audit.data || audit.isFetching || audit.isError || (!licensed.length && !active.length)}>
          <Download className="h-4 w-4 mr-2" />Export spreadsheet
        </Button>
      </div>
      {audit.isError && <p className="text-sm text-destructive">Requirements could not load. <Button variant="link" size="sm" onClick={() => audit.refetch()}>Retry</Button></p>}

      <Row title="Active states in EHR" states={active} tone="active"
        empty={coverageKnown ? 'Not active in any state' : cell.detail || cell.text} />
      <Row title="Licensed but not active in EHR" states={notActive} tone="muted"
        empty={!coverageKnown ? 'Unavailable until EHR coverage can be matched' : licensed.length ? 'None — active in every licensed state' : 'No licenses on record'} />
      {incomplete && <p className="text-xs text-muted-foreground">Agency license list is incomplete.</p>}
    </div>
  );
}
