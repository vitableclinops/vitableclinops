import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

/** Small inline copy-to-clipboard button with brief check feedback. */
export function CopyValueButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label ? `Copy ${label}` : 'Copy'}
      title="Copy"
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          // clipboard unavailable — still show feedback so the user can retry
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}
