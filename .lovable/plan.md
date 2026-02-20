
# Complete Data Model Audit: All Entities, Attributes & Relationships

This is a full map of every entity ("noun") in the platform, what it owns, and how it links to everything else. The goal is to establish a single shared understanding so nothing falls off and every record in every table traces back to a real person, state, or workflow.

---

## The Entities (Nouns)

There are **12 core entities** and several supporting/log entities.

```text
Core:
  1. User (auth identity)
  2. Profile (the single source of truth for a person)
  3. Provider (a Profile with a clinical role)
  4. Physician (a Profile with MD/DO credentials)
  5. Pod / Pod Lead
  6. Agency
  7. State (compliance rules)
  8. Collaborative Agreement
  9. Task (agreement_tasks + milestone_tasks)
 10. Meeting (supervision_meetings + calendar_events)
 11. Licensure Application
 12. Reimbursement Request

Supporting:
  - Agreement Transfer (physician handoff workflow)
  - Provider State Status (per-state readiness/activation)
  - Provider License (per-state license record)
  - Knowledge Base Article
  - Event Attestation (all-hands compliance)
  - Audit Logs (agreement_audit_log, milestone_audit_log)
```

---

## Entity 1: User (auth.users)
The authentication identity only. Not directly queryable in code.

| Attribute | Type | Notes |
|---|---|---|
| id | UUID | Auth identity |
| email | text | Login email |
| role | app_role | Assigned via user_roles table |

**Links to:** Profile (1:1, via user_id on profiles)

---

## Entity 2: Profile (profiles table)
**The single source of truth for every person in the system.** Both providers and physicians live here. This is the record that must exist first before anything else can reference a person.

| Attribute | Type | Notes |
|---|---|---|
| id | UUID | Primary key — used as FK everywhere |
| user_id | UUID | Links to auth.users (nullable — pre-created profiles have no login yet) |
| email | text | Required, unique |
| full_name / first_name / last_name | text | |
| profession | text | Drives role: NP, RN, MD, DO, LPC, Coach |
| credentials | text | e.g., "NP-C, APRN" |
| npi_number | text | Required for licensed providers, MDs |
| phone_number | text | |
| avatar_url | text | |
| employment_type | text | w2, 1099, agency |
| employment_status | text | active, inactive, terminated |
| employment_start_date / end_date | date | |
| activation_status | text | pending_onboarding, onboarding, active |
| pod_id | UUID | FK → pods.id |
| agency_id | UUID | FK → agencies.id (only for employment_type = 'agency') |
| primary_specialty | text | |
| onboarding_completed | boolean | |
| actively_licensed_states | text | Denormalized — should be derived from provider_state_status |
| collaborative_physician | text | **PROBLEM: denormalized text, should be FK** |
| has_collaborative_agreements | boolean | Derived flag |
| chart_review_folder_url | text | Link to Google Drive etc. |
| bio, languages, services_offered | text | Provider-facing profile fields |
| birthday / date_of_birth | date | Two fields for same concept — **DUPLICATION ISSUE** |
| home_address / address_line_1/2/city/state/postal_code | text | Two address systems — **DUPLICATION ISSUE** |
| medallion_id | text | External credential management system ID |
| caqh_number | text | Credentialing network ID |

**Links to:**
- pods (via pod_id) → who their Pod Lead is
- agencies (via agency_id) → who manages them externally
- user_roles → what role they can log in as
- provider_state_status → per-state readiness (1:many)
- provider_licenses → per-state licenses (1:many)
- agreement_providers → which collaborative agreements they appear in (1:many)
- collaborative_agreements → as physician_id (1:many)
- licensure_applications → as provider_id (1:many)
- milestone_tasks → as provider_id (1:many)
- reimbursement_requests → as provider_id (1:many)

**Current integrity issues:**
- `collaborative_physician` is a free-text field on profiles rather than a FK to another profile (physician) — means no clickable link from provider → physician
- `birthday` and `date_of_birth` are duplicate fields
- Address data exists in two formats (`home_address` text vs. structured `address_line_1/2/city/state/postal_code`)
- `actively_licensed_states` is denormalized text that duplicates what `provider_state_status` should derive

---

## Entity 3: Provider
A Provider **is** a Profile whose `profession` is one of: NP, RN, LPC, Mental Health Coach. No separate table — same `profiles` row.

**Key attributes (in addition to all Profile attributes):**
- profession → NP / RN / LPC / Coach
- employment_type → w2, 1099, agency
- pod_id → assigned Pod Lead's pod
- activation_status → pending_onboarding → onboarding → active

**Must have:**
- At least one row in `provider_state_status` per state they practice in
- At least one row in `provider_licenses` per state license held
- A `pod_id` once active
- If `employment_type = 'agency'`, must have `agency_id`

---

## Entity 4: Physician
A Physician **is** a Profile whose `profession` is MD or DO. They also appear in the `physician_profiles` view (a computed view, not a separate table).

**Key attributes (in addition to Profile):**
- profession → MD or DO
- npi_number (required)
- credentials (e.g., MD, DO)
- primary_specialty

**Must have:**
- At least one `collaborative_agreements` row as physician_id
- Linked `user_roles` row with role = 'physician' once they have a login

**Current integrity issue:**
- The `physician_profiles` view is a separate view on top of `profiles` — some queries use `physician_profiles.id`, some use `profiles.id`. These resolve to the same UUID, but it creates confusion in code where "physician_id" could refer to either.

---

## Entity 5: Pod & Pod Lead

**pods table:**
| Attribute | Type | Notes |
|---|---|---|
| id | UUID | |
| name | text | Pod name |
| pod_lead_id | UUID | FK → profiles.id of the lead |
| pod_lead_name / email | text | Denormalized — **should always resolve from pod_lead_id** |
| slack_channel | text | |

**Links to:**
- profiles.pod_id → all providers in this pod (1:many)
- milestone_tasks.pod_id → tasks assigned to this pod
- event_attestations.pod_id → attestations in scope for this pod

**user_roles table:**
| Attribute | Notes |
|---|---|
| user_id | auth user id |
| role | admin, provider, physician, pod_lead |

A Pod Lead is any Profile whose linked auth user has role = 'pod_lead' in user_roles. The pods table links to their profile via pod_lead_id.

---

## Entity 6: Agency

**agencies table:**
| Attribute | Notes |
|---|---|
| name | Agency organization name |
| contact_name / email / phone | Primary contact |
| is_active | Whether accepting new providers |
| notes | Free text |

**agency_contacts table** — Additional contacts per agency (many per agency).

**agency_documents table** — Contracts, agreements stored in cloud storage.

**Links to:**
- profiles.agency_id → providers managed by this agency (1:many)

**Rule:** A provider with `employment_type = 'agency'` MUST have an `agency_id`. W2/1099 providers CANNOT have an `agency_id`. Enforced by a database trigger.

---

## Entity 7: State (state_compliance_requirements table)
States are not stored as a separate "states" table — they are defined by their abbreviation (text key) and their compliance rules live in `state_compliance_requirements`.

| Attribute | Notes |
|---|---|
| state_abbreviation | Primary key (text, e.g., "TX") |
| state_name | Full name |
| ca_required | Is a collaborative agreement required? |
| collab_requirement_type | never / always / unless_autonomous / md_only |
| ca_meeting_cadence | monthly, quarterly, etc. |
| meeting_months | Array of months when meetings are required |
| fpa_status | Full Practice Authority status |
| rxr_required | Prescriptive authority rules |
| nlc | Nursing Licensure Compact member |
| np_md_ratio / np_md_ratio_limit | Supervision ratio limits |
| np_prohibited | Whether NPs cannot practice |
| collab_notes / fpa_requirements_summary | Regulatory notes |
| knowledge_base_url | Link to state-specific KB article |

**state_licensure_templates table** — Checklist templates per state for licensure applications. Each template has ordered steps that get copied to `licensure_application_steps` when an application is initiated.

**Links to:**
- provider_state_status (via state_abbreviation — every provider×state combination)
- collaborative_agreements (via state_abbreviation)
- agreement_tasks (via state_abbreviation)
- licensure_applications (via state_abbreviation)
- provider_licenses (via state_abbreviation)

---

## Entity 8: Collaborative Agreement (collaborative_agreements)

This is the central operational entity of the platform.

| Attribute | Notes |
|---|---|
| id | UUID |
| physician_id | FK → profiles.id (physician) — **the correct link** |
| physician_name / email / npi | Denormalized copies for display |
| provider_id | FK → profiles.id (primary provider on agreement) |
| provider_name / email / npi | Denormalized copies |
| state_abbreviation / state_name | Which state this covers |
| state_id | Text copy of state abbreviation |
| workflow_status | draft → in_progress → pending_signatures → pending_verification → active → cancelled → archived |
| start_date / end_date | Agreement dates |
| next_renewal_date | When it expires |
| renewal_cadence | annual / biennial |
| meeting_cadence | monthly, quarterly, etc. |
| chart_review_required / frequency | Supervision requirements |
| readiness_status | not_ready / ready |
| agreement_document_url | Signed document link |
| medallion_id / medallion_document_url | External credential system |

**agreement_providers junction table** — Links multiple providers to one agreement (the many-side):
| Attribute | Notes |
|---|---|
| agreement_id | FK → collaborative_agreements.id |
| provider_id | FK → profiles.id — **must be populated** |
| provider_name / email | Denormalized display copies |
| is_active | Whether still on this agreement |
| signature_status | pending / signed |
| start_date / removed_at | Lifecycle dates |

**The intended relationship:**
One agreement = One physician + One state + One or more providers.
Each provider-physician-state combination must have its own agreement record.

**Current integrity issues:**
- `agreement_providers.provider_id` is still NULL on some rows (backfill in progress)
- `collaborative_agreements.provider_id` links to the "primary" provider, but the full list is in `agreement_providers` — this creates two representations of the same concept

---

## Entity 9: Task

Tasks exist in **two tables** that serve different purposes:

**agreement_tasks** — Operational workflow tasks:
| Attribute | Notes |
|---|---|
| id | UUID |
| agreement_id | FK → collaborative_agreements (nullable — some tasks are standalone) |
| provider_id | FK → profiles.id |
| physician_id | FK → profiles.id |
| transfer_id | FK → agreement_transfers (if part of a physician handoff) |
| meeting_id | FK → supervision_meetings |
| category | agreement / compliance / licensure / custom |
| status | pending → in_progress → completed / blocked / archived |
| title / description | |
| assigned_to | FK → profiles.id (who is doing this task) |
| assigned_to_name | Denormalized |
| assigned_role | admin / provider / physician |
| due_date | |
| priority | low / medium / high |
| is_required / sort_order | |
| checklist_items | JSON array of sub-items |
| state_abbreviation | Which state this relates to |
| escalated | Whether flagged for urgent attention |
| links_json | External links attached |

**milestone_tasks** — Provider lifecycle celebration tasks (anniversaries, etc.):
| Attribute | Notes |
|---|---|
| provider_id | FK → profiles.id |
| milestone_type | 6_month / 1_year / etc. |
| milestone_date / milestone_year | |
| assigned_to | FK → profiles.id (pod lead who handles it) |
| pod_id | FK → pods.id |
| status | pending / completed / skipped |
| due_date | |

**task_linked_providers** — Additional providers linked to a single agreement_task (for tasks that span multiple providers).

**Current integrity issue:**
- Some `agreement_tasks` have neither `agreement_id` nor `provider_id` set — making them orphaned tasks with no parent context
- `assigned_to_name` is denormalized and can drift from the actual profile

---

## Entity 10: Meeting

Meetings exist in **two tables**:

**supervision_meetings** — Collab agreement oversight meetings:
| Attribute | Notes |
|---|---|
| id | UUID |
| agreement_id | FK → collaborative_agreements.id |
| physician_id | FK → profiles.id |
| scheduled_date | |
| duration_minutes | |
| meeting_type | collaborative_meeting / chart_review / case_discussion |
| status | scheduled / completed / cancelled / missed |
| time_slot | am / pm |
| is_company_wide | Whether it's an all-hands style meeting |
| meeting_month | The month this counts for |
| state_abbreviation | |

**meeting_attendees** — Providers attending a supervision meeting:
| Attribute | Notes |
|---|---|
| meeting_id | FK → supervision_meetings.id |
| provider_id | FK → profiles.id — **required** |
| provider_name / email | Denormalized |
| attendance_status | invited / confirmed / attended / absent |
| has_rsvped | boolean |
| rsvp_slot / assigned_slot | am / pm slot |

**calendar_events** — Company-wide events (All-Hands, newsletters, training):
| Attribute | Notes |
|---|---|
| id | UUID |
| title / description | |
| starts_at / ends_at | |
| event_type | provider_all_hands / training / etc. |
| status | scheduled / completed / cancelled |
| attestation_required | Whether providers must confirm attendance |
| attestation_due_days | How many days after event to attest |
| newsletter_article_id | FK → kb_articles (linked newsletter) |
| total_providers / completed_attestations | Counters |

**event_attestations** — Per-provider attestation for a calendar event:
| Attribute | Notes |
|---|---|
| event_id | FK → calendar_events.id |
| provider_id | FK → profiles.id |
| status | pending / completed / excused |
| due_at / completed_at | |
| task_id | FK → agreement_tasks (the associated compliance task) |

---

## Entity 11: Licensure Application (licensure_applications)

| Attribute | Notes |
|---|---|
| id | UUID |
| provider_id | FK → profiles.id |
| state_abbreviation / state_name | Which state |
| template_id | FK → state_licensure_templates |
| designation_type | initial_license / renewal / telehealth / etc. |
| status | not_started → in_progress → submitted → approved |
| agreement_task_id | FK → agreement_tasks (the task that spawned this) |
| kb_article_id | FK → kb_articles (linked instructions) |
| provider_name / email | Denormalized |
| admin_notes / notes | |
| ca_requirement_type | Collaboration requirement awareness field |

**licensure_application_steps** — Ordered checklist steps per application:
| Attribute | Notes |
|---|---|
| application_id | FK → licensure_applications.id |
| title / description | Step content |
| status | not_started / in_progress / completed |
| sort_order | Step ordering |
| fee_amount / fee_receipt_url | Provider-uploaded receipt |
| reimbursement_status | none / submitted / approved / processed |

**provider_licenses table** — The resulting license record once approved:
| Attribute | Notes |
|---|---|
| profile_id | FK → profiles.id |
| state_abbreviation | |
| license_number / license_type | |
| status | active / pending / expired / revoked |
| issue_date / expiration_date | |
| collab_agreement_id | FK → collaborative_agreements (if this license requires a collab) |

---

## Entity 12: Reimbursement Request (reimbursement_requests)

| Attribute | Notes |
|---|---|
| provider_id | FK → profiles.id |
| provider_name | Denormalized |
| state_abbreviation | |
| license_application_id | FK → licensure_applications |
| application_fee_amount | Dollar amount |
| application_fee_receipt_url | Evidence file |
| admin_hours_spent / hourly_rate / admin_time_total | Time tracking |
| total_reimbursement | Calculated total |
| status | submitted / approved / processed / rejected |
| reviewed_by / processed_by | FK → profiles.id |

---

## Supporting Entities

**agreement_transfers** — Physician handoff workflow (source physician → target physician):
- Links: source_agreement_id, source_physician_id, target_physician_id, target_agreement_id
- Contains: affected_provider_ids (array), checklist_items (JSON workflow), readiness_status

**provider_state_status** — The per-state readiness dashboard row for each provider:
- provider_id (FK → profiles) + state_abbreviation = unique key
- readiness_status: not_ready / ready / override
- ehr_activation_status: inactive / active / pending / deactivated
- compliance_status: unknown / compliant / non_compliant

**provider_state_collab_decisions** — Records whether a provider needs a collab agreement in a given state (can be admin-overridden).

**knowledge_base (kb_articles / kb_categories)** — Internal documentation. Articles link to calendar_events (newsletters) and licensure_applications.

**audit logs** — agreement_audit_log, milestone_audit_log, ehr_activation_events, compliance_status_log. All append-only.

---

## Identified Problems & Missing Links

The following are confirmed gaps where the data model should have a FK link but currently uses plain text instead:

| Location | Missing Link | Impact |
|---|---|---|
| `profiles.collaborative_physician` | Should be `FK → profiles.id` | Cannot click from provider → physician |
| `profiles.birthday` vs `profiles.date_of_birth` | Same field stored twice | Data inconsistency |
| `profiles.home_address` vs structured address fields | Two address systems | Cannot reliably display address |
| `profiles.actively_licensed_states` | Denormalized text of provider_state_status | Can go stale / mismatch |
| `pods.pod_lead_name / email` | Should always resolve from `pod_lead_id → profiles` | Can show stale name |
| `agreement_providers.provider_id` | Partially backfilled | Some rows still unlinked |
| `agreement_transfers` (no FK relationships declared) | source/target physician_id, agreement_id exist but no FK constraints | Orphaned transfer records possible |
| `supervision_meetings` | `physician_id` FK exists, but no `provider_id` — attendees tracked in separate table | Must always join `meeting_attendees` to know who attended |
| `milestone_tasks.provider_email` | Should always resolve from `provider_id → profiles` | Can drift |

---

## The Correct Relationship Map (How Everything Should Connect)

```text
auth.users (1)
  └─→ profiles (1)          ← THE HUB. Everything traces back here.
        ├─→ user_roles       ← what they can do
        ├─→ pods             ← who manages them (pod_lead_id)
        ├─→ agencies         ← who employs them (if agency)
        ├─→ provider_state_status (1:many, per state)
        ├─→ provider_licenses (1:many, per license)
        ├─→ agreement_providers (1:many, per agreement they're on)
        ├─→ collaborative_agreements (1:many, as physician_id)
        ├─→ licensure_applications (1:many, as provider_id)
        ├─→ reimbursement_requests (1:many)
        ├─→ milestone_tasks (1:many)
        └─→ meeting_attendees (1:many, per meeting they attend)

collaborative_agreements (1)
  ├─→ profiles (physician_id)     ← the MD/DO overseeing
  ├─→ profiles (provider_id)      ← primary NP
  ├─→ agreement_providers (1:many) ← all NPs on this agreement
  ├─→ agreement_tasks (1:many)    ← workflow tasks
  ├─→ agreement_workflow_steps    ← lifecycle steps
  ├─→ supervision_meetings (1:many)
  └─→ agreement_transfers (1:many) ← when physician changes

state_compliance_requirements (1 per state)
  └─→ state_licensure_templates (1:many) ← application checklists

licensure_applications (1)
  ├─→ profiles (provider_id)
  ├─→ state_licensure_templates (template_id)
  ├─→ licensure_application_steps (1:many)
  └─→ reimbursement_requests (1:many)

calendar_events (1)
  ├─→ kb_articles (newsletter_article_id)
  └─→ event_attestations (1:many per provider)
        └─→ profiles (provider_id)
              └─→ agreement_tasks (task_id) ← the compliance task
```

---

## What This Plan Would Fix (If Approved)

The structural gaps identified above can be addressed in a follow-up plan:

1. **Remove `profiles.collaborative_physician` text field** — replace with a view or a proper FK join from `collaborative_agreements` to get the linked physician name
2. **Deduplicate `birthday` / `date_of_birth`** — keep one, migrate the other
3. **Deduplicate address fields** — deprecate `home_address` in favor of structured fields
4. **Remove `profiles.actively_licensed_states`** — derive from `provider_state_status` at query time
5. **Add FK constraints to `agreement_transfers`** — so orphaned transfers are impossible
6. **Add `provider_id` to `supervision_meetings`** (or enforce that attendees table is always populated)
7. **Enforce denormalized name fields always match their FK source** — via database triggers that update `_name` fields when the source profile is updated
