
CREATE OR REPLACE FUNCTION public.auto_create_agreement_on_task_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_transfer record;
  v_source record;
  v_new_agreement_id uuid;
  v_provider record;
BEGIN
  -- Only fire when status transitions TO 'completed'
  IF NEW.status != 'completed' THEN RETURN NEW; END IF;
  IF OLD.status = 'completed' THEN RETURN NEW; END IF;

  -- Only for agreement_creation tasks from transfer_initiation
  IF NEW.category != 'agreement_creation' THEN RETURN NEW; END IF;
  IF NEW.auto_trigger != 'transfer_initiation' THEN RETURN NEW; END IF;
  IF NEW.transfer_id IS NULL THEN RETURN NEW; END IF;

  -- Look up the transfer
  SELECT * INTO v_transfer FROM public.agreement_transfers WHERE id = NEW.transfer_id;
  IF v_transfer IS NULL THEN RETURN NEW; END IF;

  -- Skip if agreement already created for this transfer
  IF v_transfer.target_agreement_id IS NOT NULL THEN RETURN NEW; END IF;

  -- Need target physician to proceed
  IF v_transfer.target_physician_id IS NULL THEN RETURN NEW; END IF;

  -- Get source agreement config
  SELECT state_id, chart_review_frequency, meeting_cadence, renewal_cadence
    INTO v_source
    FROM public.collaborative_agreements
    WHERE id = v_transfer.source_agreement_id;

  IF v_source IS NULL THEN RETURN NEW; END IF;

  -- Create the new collaborative agreement in draft status
  INSERT INTO public.collaborative_agreements (
    state_abbreviation, state_id, state_name,
    physician_id, physician_name, physician_email,
    provider_name,
    start_date, workflow_status,
    meeting_cadence, chart_review_frequency, renewal_cadence,
    source
  ) VALUES (
    v_transfer.state_abbreviation,
    v_source.state_id,
    v_transfer.state_name,
    v_transfer.target_physician_id,
    v_transfer.target_physician_name,
    v_transfer.target_physician_email,
    v_transfer.affected_provider_count || ' Provider(s)',
    v_transfer.effective_date,
    'draft',
    COALESCE(v_transfer.meeting_cadence, v_source.meeting_cadence, 'monthly'),
    COALESCE(v_transfer.chart_review_frequency, v_source.chart_review_frequency),
    COALESCE(v_source.renewal_cadence, 'annual'),
    'transfer'
  )
  RETURNING id INTO v_new_agreement_id;

  -- Link the new agreement to the transfer
  UPDATE public.agreement_transfers
    SET target_agreement_id = v_new_agreement_id
    WHERE id = v_transfer.id;

  -- Re-parent initiation tasks to the new agreement
  UPDATE public.agreement_tasks
    SET agreement_id = v_new_agreement_id
    WHERE transfer_id = v_transfer.id
      AND auto_trigger = 'transfer_initiation';

  -- Link affected providers to the new agreement
  FOR v_provider IN
    SELECT p.id, p.full_name, p.email, p.npi_number
      FROM public.profiles p
      WHERE p.id = ANY(v_transfer.affected_provider_ids)
  LOOP
    INSERT INTO public.agreement_providers (
      agreement_id, provider_id, provider_name, provider_email, provider_npi,
      is_active, start_date
    ) VALUES (
      v_new_agreement_id, v_provider.id,
      COALESCE(v_provider.full_name, 'Unknown'),
      v_provider.email, v_provider.npi_number,
      true,
      v_transfer.effective_date
    );
  END LOOP;

  RETURN NEW;
END;
$$;
