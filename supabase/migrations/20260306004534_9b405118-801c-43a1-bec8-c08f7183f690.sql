-- 1. Restore transfer target_agreement_id back to Tylene's real agreement
UPDATE public.agreement_transfers 
SET target_agreement_id = '671914e2-0eac-442d-a42f-51d32120ad38'
WHERE id = 'a8eb48c5-b134-43c7-8981-7ddb3126b8df';

-- 2. Move transfer tasks back to Tylene's agreement
UPDATE public.agreement_tasks 
SET agreement_id = '671914e2-0eac-442d-a42f-51d32120ad38'
WHERE agreement_id = '61d1bee4-892f-45f2-a8f6-c9f1ae5785d7'
  AND transfer_id = 'a8eb48c5-b134-43c7-8981-7ddb3126b8df';

-- 3. Insert fresh setup tasks for Melissa's NJ agreement (61d1bee4)
INSERT INTO public.agreement_tasks (agreement_id, provider_id, physician_id, title, description, category, status, priority, assigned_role, is_auto_generated, is_required, auto_trigger, state_abbreviation, state_name, sort_order) VALUES
('61d1bee4-892f-45f2-a8f6-c9f1ae5785d7', '8cbdaa50-ebbe-4c31-be32-76263585ae04', 'e68011f1-e078-4227-8b6f-945a7ce29469', 'Initiate new collaborative agreement record', 'Create new agreement record for 1 provider(s) with Kate Baron. The system will auto-populate from existing provider data.', 'agreement_creation', 'pending', 'high', 'admin', true, true, 'agreement_creation', 'NJ', 'New Jersey', 1),
('61d1bee4-892f-45f2-a8f6-c9f1ae5785d7', '8cbdaa50-ebbe-4c31-be32-76263585ae04', 'e68011f1-e078-4227-8b6f-945a7ce29469', 'Assign collaborating physician (Kate Baron)', 'Confirm physician assignment and update all provider records', 'custom', 'pending', 'high', 'admin', true, true, 'agreement_creation', 'NJ', 'New Jersey', 2),
('61d1bee4-892f-45f2-a8f6-c9f1ae5785d7', '8cbdaa50-ebbe-4c31-be32-76263585ae04', 'e68011f1-e078-4227-8b6f-945a7ce29469', 'Send new agreement via BoxSign', 'Route new collaborative agreement to physician and all affected providers for signature. When completed, record the Box Sign request ID, date sent, and confirming admin name.', 'signature', 'pending', 'high', 'admin', true, true, 'agreement_creation', 'NJ', 'New Jersey', 3),
('61d1bee4-892f-45f2-a8f6-c9f1ae5785d7', '8cbdaa50-ebbe-4c31-be32-76263585ae04', 'e68011f1-e078-4227-8b6f-945a7ce29469', 'Confirm NP + physician notification email sent', 'Verify all parties received email confirmation of the new agreement', 'custom', 'pending', 'medium', 'admin', true, true, 'agreement_creation', 'NJ', 'New Jersey', 4),
('61d1bee4-892f-45f2-a8f6-c9f1ae5785d7', '8cbdaa50-ebbe-4c31-be32-76263585ae04', 'e68011f1-e078-4227-8b6f-945a7ce29469', 'Upload executed new agreement', 'Confirm executed agreement document received. Record the Box Sign document reference and date completed.', 'document', 'pending', 'high', 'admin', true, true, 'agreement_creation', 'NJ', 'New Jersey', 5),
('61d1bee4-892f-45f2-a8f6-c9f1ae5785d7', '8cbdaa50-ebbe-4c31-be32-76263585ae04', 'e68011f1-e078-4227-8b6f-945a7ce29469', 'Schedule first collaboration meeting + record cadence', 'Set up initial collaborative meeting and establish meeting schedule', 'supervision_meeting', 'pending', 'medium', 'admin', true, true, 'agreement_creation', 'NJ', 'New Jersey', 6),
('61d1bee4-892f-45f2-a8f6-c9f1ae5785d7', '8cbdaa50-ebbe-4c31-be32-76263585ae04', 'e68011f1-e078-4227-8b6f-945a7ce29469', 'Link chart review calendar/tracker', 'Set up chart review schedule and store reference URL/tracker link', 'chart_review', 'pending', 'medium', 'admin', true, true, 'agreement_creation', 'NJ', 'New Jersey', 7),
('61d1bee4-892f-45f2-a8f6-c9f1ae5785d7', '8cbdaa50-ebbe-4c31-be32-76263585ae04', 'e68011f1-e078-4227-8b6f-945a7ce29469', 'Upload executed agreement to Medallion', 'Upload the executed collaborative agreement to Medallion as a provider-supervision relationship record', 'document', 'pending', 'high', 'admin', true, true, 'agreement_creation', 'NJ', 'New Jersey', 8),
('61d1bee4-892f-45f2-a8f6-c9f1ae5785d7', '8cbdaa50-ebbe-4c31-be32-76263585ae04', 'e68011f1-e078-4227-8b6f-945a7ce29469', 'Add to Kate Baron collab sheet', 'Add the executed collaborative agreement details to Kate Baron''s tracking spreadsheet', 'custom', 'pending', 'medium', 'admin', true, true, 'agreement_creation', 'NJ', 'New Jersey', 9),
('61d1bee4-892f-45f2-a8f6-c9f1ae5785d7', '8cbdaa50-ebbe-4c31-be32-76263585ae04', 'e68011f1-e078-4227-8b6f-945a7ce29469', 'Set renewal date', 'Set the agreement renewal date. Upon completion, the system will auto-calculate the renewal date as 1 year from the agreement start date.', 'custom', 'pending', 'medium', 'admin', true, true, 'agreement_creation', 'NJ', 'New Jersey', 10);
