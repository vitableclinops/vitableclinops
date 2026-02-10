import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface AgencyContact {
  id: string;
  agency_id: string;
  contact_name: string;
  role_title: string | null;
  email: string | null;
  phone: string | null;
  preferred_contact_method: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgencyDocument {
  id: string;
  agency_id: string;
  document_name: string;
  document_type: string;
  storage_path: string;
  file_size: number | null;
  mime_type: string | null;
  effective_date: string | null;
  expiration_date: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  notes: string | null;
  created_at: string;
}

export interface LinkedProvider {
  id: string;
  full_name: string | null;
  email: string;
  credentials: string | null;
  profession: string | null;
  employment_status: string | null;
  actively_licensed_states: string | null;
  activation_status: string | null;
  npi_number: string | null;
}

export const useAgencyDetail = (agencyId: string | undefined) => {
  const [contacts, setContacts] = useState<AgencyContact[]>([]);
  const [documents, setDocuments] = useState<AgencyDocument[]>([]);
  const [providers, setProviders] = useState<LinkedProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchAll = useCallback(async () => {
    if (!agencyId) return;
    setLoading(true);
    try {
      const [contactsRes, docsRes, providersRes] = await Promise.all([
        supabase
          .from('agency_contacts')
          .select('*')
          .eq('agency_id', agencyId)
          .order('contact_name'),
        supabase
          .from('agency_documents')
          .select('*')
          .eq('agency_id', agencyId)
          .order('created_at', { ascending: false }),
        supabase
          .from('profiles')
          .select('id, full_name, email, credentials, profession, employment_status, actively_licensed_states, activation_status, npi_number')
          .eq('agency_id', agencyId)
          .eq('employment_type', 'agency')
          .order('full_name'),
      ]);

      if (contactsRes.error) throw contactsRes.error;
      if (docsRes.error) throw docsRes.error;
      if (providersRes.error) throw providersRes.error;

      setContacts((contactsRes.data || []) as AgencyContact[]);
      setDocuments((docsRes.data || []) as AgencyDocument[]);
      setProviders((providersRes.data || []) as LinkedProvider[]);
    } catch (error) {
      console.error('Error fetching agency detail:', error);
    } finally {
      setLoading(false);
    }
  }, [agencyId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const addContact = async (contact: Partial<AgencyContact>) => {
    try {
      const { data, error } = await supabase
        .from('agency_contacts')
        .insert([{ ...contact, agency_id: agencyId } as any])
        .select()
        .single();
      if (error) throw error;
      setContacts(prev => [...prev, data as AgencyContact]);
      toast({ title: 'Contact added' });
      return data;
    } catch (error) {
      console.error('Error adding contact:', error);
      toast({ title: 'Error', description: 'Failed to add contact.', variant: 'destructive' });
      throw error;
    }
  };

  const updateContact = async (id: string, updates: Partial<AgencyContact>) => {
    try {
      const { data, error } = await supabase
        .from('agency_contacts')
        .update(updates as any)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      setContacts(prev => prev.map(c => c.id === id ? data as AgencyContact : c));
      toast({ title: 'Contact updated' });
      return data;
    } catch (error) {
      console.error('Error updating contact:', error);
      toast({ title: 'Error', description: 'Failed to update contact.', variant: 'destructive' });
      throw error;
    }
  };

  const deleteContact = async (id: string) => {
    try {
      const { error } = await supabase
        .from('agency_contacts')
        .delete()
        .eq('id', id);
      if (error) throw error;
      setContacts(prev => prev.filter(c => c.id !== id));
      toast({ title: 'Contact removed' });
    } catch (error) {
      console.error('Error deleting contact:', error);
      toast({ title: 'Error', description: 'Failed to remove contact.', variant: 'destructive' });
      throw error;
    }
  };

  const uploadDocument = async (file: File, metadata: { document_name: string; document_type: string; effective_date?: string; expiration_date?: string; notes?: string; uploaded_by?: string; uploaded_by_name?: string }) => {
    try {
      const filePath = `${agencyId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('agency-documents')
        .upload(filePath, file);
      if (uploadError) throw uploadError;

      const { data, error } = await supabase
        .from('agency_documents')
        .insert([{
          agency_id: agencyId,
          document_name: metadata.document_name,
          document_type: metadata.document_type,
          storage_path: filePath,
          file_size: file.size,
          mime_type: file.type,
          effective_date: metadata.effective_date || null,
          expiration_date: metadata.expiration_date || null,
          uploaded_by: metadata.uploaded_by || null,
          uploaded_by_name: metadata.uploaded_by_name || null,
          notes: metadata.notes || null,
        } as any])
        .select()
        .single();
      if (error) throw error;
      setDocuments(prev => [data as AgencyDocument, ...prev]);
      toast({ title: 'Document uploaded' });
      return data;
    } catch (error) {
      console.error('Error uploading document:', error);
      toast({ title: 'Error', description: 'Failed to upload document.', variant: 'destructive' });
      throw error;
    }
  };

  const deleteDocument = async (doc: AgencyDocument) => {
    try {
      await supabase.storage.from('agency-documents').remove([doc.storage_path]);
      const { error } = await supabase.from('agency_documents').delete().eq('id', doc.id);
      if (error) throw error;
      setDocuments(prev => prev.filter(d => d.id !== doc.id));
      toast({ title: 'Document deleted' });
    } catch (error) {
      console.error('Error deleting document:', error);
      toast({ title: 'Error', description: 'Failed to delete document.', variant: 'destructive' });
      throw error;
    }
  };

  const getDocumentUrl = async (storagePath: string) => {
    const { data } = await supabase.storage
      .from('agency-documents')
      .createSignedUrl(storagePath, 3600);
    return data?.signedUrl;
  };

  const linkProvider = async (providerId: string) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ employment_type: 'agency', agency_id: agencyId } as any)
        .eq('id', providerId);
      if (error) throw error;
      toast({ title: 'Provider linked to agency' });
      await fetchAll();
    } catch (error: any) {
      console.error('Error linking provider:', error);
      toast({ title: 'Error', description: error.message || 'Failed to link provider.', variant: 'destructive' });
      throw error;
    }
  };

  const unlinkProvider = async (providerId: string) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ employment_type: '1099', agency_id: null } as any)
        .eq('id', providerId);
      if (error) throw error;
      toast({ title: 'Provider unlinked from agency' });
      await fetchAll();
    } catch (error: any) {
      console.error('Error unlinking provider:', error);
      toast({ title: 'Error', description: error.message || 'Failed to unlink provider.', variant: 'destructive' });
      throw error;
    }
  };

  return {
    contacts, documents, providers, loading,
    refetch: fetchAll,
    addContact, updateContact, deleteContact,
    uploadDocument, deleteDocument, getDocumentUrl,
    linkProvider, unlinkProvider,
  };
};
