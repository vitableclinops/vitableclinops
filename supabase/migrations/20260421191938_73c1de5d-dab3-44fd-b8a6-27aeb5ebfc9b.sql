ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'agreement_activated';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'agreement_invalidated';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'agreement_renewal_warning';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'agreement_terminated';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'transfer_initiated';