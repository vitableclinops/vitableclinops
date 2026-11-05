import { createContext, useContext, type ReactNode } from 'react';
import * as UI from '@/components/ui/dialog';

/** When true, verification "dialogs" render as an in-page box instead of a popup. */
const InlineDialogContext = createContext(false);
export const InlineDialogProvider = ({ children }: { children: ReactNode }) => <InlineDialogContext.Provider value>{children}</InlineDialogContext.Provider>;
const useInline = () => useContext(InlineDialogContext);

type P = { children?: ReactNode; className?: string };
export function Dialog(props: React.ComponentProps<typeof UI.Dialog>) {
  return useInline() ? <>{props.children}</> : <UI.Dialog {...props} />;
}
export function DialogContent({ className, ...props }: React.ComponentProps<typeof UI.DialogContent>) {
  return useInline() ? <div className="space-y-4 rounded-md border bg-card p-4">{props.children}</div> : <UI.DialogContent className={className} {...props} />;
}
export function DialogHeader(props: P) { return useInline() ? <div className="space-y-1">{props.children}</div> : <UI.DialogHeader {...props} />; }
export function DialogTitle(props: P) { return useInline() ? <p className="text-sm font-semibold">{props.children}</p> : <UI.DialogTitle {...props} />; }
export function DialogDescription(props: P) { return useInline() ? <p className="text-xs text-muted-foreground">{props.children}</p> : <UI.DialogDescription {...props} />; }
export function DialogFooter(props: P) { return useInline() ? <div className="flex flex-wrap justify-end gap-2 [&>button:not(:last-child)]:hidden">{props.children}</div> : <UI.DialogFooter {...props} />; }
