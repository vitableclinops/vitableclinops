import { useState } from 'react';
import { ChevronDown, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { NC_NCBON_INSTRUCTIONS, NC_NCBON_TASK_TITLE, KY_KBN_INSTRUCTIONS, KY_KBN_TASK_TITLE } from '@/data/taskTemplates';
import { useToast } from '@/hooks/use-toast';

const INSTRUCTION_SETS: Record<string, { label: string; text: string }> = {
  [NC_NCBON_TASK_TITLE]: { label: 'NCBON upload instructions', text: NC_NCBON_INSTRUCTIONS },
  [KY_KBN_TASK_TITLE]: { label: 'KBN registration instructions', text: KY_KBN_INSTRUCTIONS },
};

export function NcbonInstructions({ title }: { title: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const config = INSTRUCTION_SETS[title];
  if (!config) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2 rounded-md border bg-muted/40 p-2" onClick={e => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-auto min-w-0 justify-start whitespace-normal text-left">
            <ChevronDown className={`mr-2 h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            {config.label}
          </Button>
        </CollapsibleTrigger>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={`Copy ${config.label}`} title={`Copy ${config.label}`} onClick={async () => {
          try {
            await navigator.clipboard.writeText(config.text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            toast({ title: 'Could not copy instructions', description: 'Expand the instructions to select and copy them.', variant: 'destructive' });
          }
        }}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      <CollapsibleContent>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{config.text}</p>
      </CollapsibleContent>
    </Collapsible>
  );
}
