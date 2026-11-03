import { useState } from 'react';
import { ChevronDown, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { NC_NCBON_INSTRUCTIONS, NC_NCBON_TASK_TITLE } from '@/data/taskTemplates';
import { useToast } from '@/hooks/use-toast';

export function NcbonInstructions({ title }: { title: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  if (title !== NC_NCBON_TASK_TITLE) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2 rounded-md border bg-muted/40 p-2" onClick={e => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-auto min-w-0 justify-start whitespace-normal text-left">
            <ChevronDown className={`mr-2 h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            NCBON upload instructions
          </Button>
        </CollapsibleTrigger>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Copy NCBON instructions" title="Copy NCBON instructions" onClick={async () => {
          try {
            await navigator.clipboard.writeText(NC_NCBON_INSTRUCTIONS);
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
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{NC_NCBON_INSTRUCTIONS}</p>
      </CollapsibleContent>
    </Collapsible>
  );
}