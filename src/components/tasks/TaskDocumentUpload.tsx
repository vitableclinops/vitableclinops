import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Upload, FileText, Trash2, Eye, Loader2, Paperclip, AlertCircle,
} from 'lucide-react';

export interface TaskDocument {
  id: string;
  task_id: string;
  agreement_id: string | null;
  file_name: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
}

interface TaskDocumentUploadProps {
  taskId: string;
  agreementId?: string | null;
  requiresUpload?: boolean;
  disabled?: boolean;
  compact?: boolean;
  onDocumentCountChange?: (count: number) => void;
}

const ACCEPTED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

function formatFileSize(bytes: number | null) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function TaskDocumentUpload({
  taskId,
  agreementId,
  requiresUpload = false,
  disabled = false,
  compact = false,
  onDocumentCountChange,
}: TaskDocumentUploadProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<TaskDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  const fetchDocuments = useCallback(async () => {
    const { data, error } = await supabase
      .from('task_documents')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setDocuments(data as TaskDocument[]);
      onDocumentCountChange?.(data.length);
    }
    setLoading(false);
  }, [taskId, onDocumentCountChange]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleUpload = async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast({ title: 'Invalid file type', description: 'Please upload a PDF, image, or Word document.', variant: 'destructive' });
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast({ title: 'File too large', description: 'Maximum file size is 20 MB.', variant: 'destructive' });
      return;
    }

    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase.from('profiles').select('full_name').eq('user_id', user?.id || '').maybeSingle();

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const uniqueName = `${crypto.randomUUID()}_${safeName}`;
      const storagePath = `${agreementId || 'unlinked'}/${taskId}/${uniqueName}`;

      const { error: uploadError } = await supabase.storage
        .from('task-documents')
        .upload(storagePath, file);

      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase
        .from('task_documents')
        .insert({
          task_id: taskId,
          agreement_id: agreementId || null,
          file_name: file.name,
          file_path: storagePath,
          file_size: file.size,
          mime_type: file.type,
          uploaded_by: user?.id || null,
          uploaded_by_name: profile?.full_name || user?.email || null,
        });

      if (insertError) throw insertError;

      // Audit log
      await supabase.from('agreement_audit_log').insert({
        entity_type: 'task',
        entity_id: taskId,
        action: 'document_uploaded',
        performed_by: user?.id || null,
        performed_by_name: profile?.full_name || user?.email || null,
        changes: { file_name: file.name, agreement_id: agreementId },
      });

      toast({ title: 'Document uploaded' });
      fetchDocuments();
    } catch (err: any) {
      console.error('Upload error:', err);
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const handleView = async (doc: TaskDocument) => {
    const { data, error } = await supabase.storage
      .from('task-documents')
      .createSignedUrl(doc.file_path, 300);

    if (error || !data?.signedUrl) {
      toast({ title: 'Error', description: 'Could not generate download link.', variant: 'destructive' });
      return;
    }
    window.open(data.signedUrl, '_blank');
  };

  const handleDelete = async (doc: TaskDocument) => {
    try {
      await supabase.storage.from('task-documents').remove([doc.file_path]);
      await supabase.from('task_documents').delete().eq('id', doc.id);

      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('agreement_audit_log').insert({
        entity_type: 'task',
        entity_id: taskId,
        action: 'document_deleted',
        performed_by: user?.id || null,
        changes: { file_name: doc.file_name, agreement_id: agreementId },
      });

      toast({ title: 'Document removed' });
      fetchDocuments();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = '';
  };

  if (loading) {
    return <div className="text-xs text-muted-foreground py-1">Loading documents…</div>;
  }

  // Compact mode: just show paperclip badge
  if (compact) {
    if (documents.length === 0 && !requiresUpload) return null;
    return (
      <Badge
        variant="outline"
        className={cn(
          "text-[10px] gap-0.5 px-1",
          requiresUpload && documents.length === 0 && "border-warning/50 text-warning",
        )}
      >
        <Paperclip className="h-2.5 w-2.5" />
        {documents.length > 0 ? documents.length : '!'}
      </Badge>
    );
  }

  return (
    <div className="space-y-2">
      {/* Warning if requires upload and no docs */}
      {requiresUpload && documents.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-warning bg-warning/10 border border-warning/30 rounded-md p-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>This task requires a document upload before it can be completed.</span>
        </div>
      )}

      {/* Document list */}
      {documents.length > 0 && (
        <div className="space-y-1.5">
          {documents.map(doc => (
            <div
              key={doc.id}
              className="flex items-center gap-2 p-2 rounded-md border bg-muted/30 text-sm"
            >
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{doc.file_name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {formatFileSize(doc.file_size)} · {doc.uploaded_by_name || 'Unknown'} · {new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </p>
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleView(doc)} title="View">
                <Eye className="h-3 w-3" />
              </Button>
              {!disabled && (
                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDelete(doc)} title="Delete">
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Upload zone */}
      {!disabled && (
        <div
          className={cn(
            "border-2 border-dashed rounded-md p-3 text-center transition-colors cursor-pointer",
            dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/20 hover:border-muted-foreground/40",
          )}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? (
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Uploading…
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Upload className="h-4 w-4" />
              <span>Drop file here or click to upload</span>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept={ACCEPTED_TYPES.join(',')}
            onChange={handleFileSelect}
          />
        </div>
      )}
    </div>
  );
}

/** Hook to check if a task has documents (for gating logic) */
export function useTaskDocumentCount(taskId: string) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    supabase
      .from('task_documents')
      .select('id', { count: 'exact', head: true })
      .eq('task_id', taskId)
      .then(({ count: c }) => setCount(c ?? 0));
  }, [taskId]);

  return count;
}
