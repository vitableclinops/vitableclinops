/**
 * notify-late-booking edge function
 *
 * Booking systems call this when an appointment is created. The function:
 *   - blocks new bookings inside the provider/visit cutoff window
 *   - sends an immediate provider email for late bookings when email is configured
 *   - records every blocked/late-booking event for auditability
 *
 * Auth: x-sync-secret must match BOOKING_SYNC_SECRET, or the Authorization bearer
 * token must match SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type SupabaseClientAny = ReturnType<typeof createClient<any, 'public', any>>;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
};

type BookingPayload = {
  appointment_id?: string;
  appointmentId?: string;
  provider_id?: string | null;
  provider_email?: string | null;
  provider_name?: string | null;
  appointment_start_at?: string;
  start_at?: string;
  booked_at?: string;
  visit_type?: string | null;
  patient_label?: string | null;
  action_url?: string | null;
  payload?: Record<string, unknown>;
};

type SchedulingPreferences = {
  time_zone?: string | null;
  late_booking_notice_hours?: number | string | null;
  booking_cutoff_minutes?: number | string | null;
  notify_late_bookings?: boolean | null;
  email_late_bookings?: boolean | null;
};

const DEFAULT_LATE_NOTICE_HOURS = 24;
const DEFAULT_BOOKING_CUTOFF_MINUTES = 15;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const syncSecret = Deno.env.get('BOOKING_SYNC_SECRET') ?? '';
  const bearer = (req.headers.get('authorization') ?? '').replace(/^bearer\s+/i, '');
  const hasValidSecret = !!syncSecret && req.headers.get('x-sync-secret') === syncSecret;
  const hasValidServiceRole = !!serviceRoleKey && bearer === serviceRoleKey;
  if (!hasValidSecret && !hasValidServiceRole) {
    return json({ error: 'Unauthorized' }, 401);
  }
  if (!serviceRoleKey) {
    return json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured' }, 500);
  }

  let body: BookingPayload;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const appointmentId = body.appointment_id ?? body.appointmentId;
  const providerId = body.provider_id ?? null;
  const appointmentStartAt = parseDate(body.appointment_start_at ?? body.start_at);
  const bookedAt = parseDate(body.booked_at) ?? new Date();
  if (!appointmentId) return json({ error: 'appointment_id is required' }, 400);
  if (!appointmentStartAt) return json({ error: 'appointment_start_at is required' }, 400);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceRoleKey);

  let providerEmail = body.provider_email ?? null;
  let providerName = body.provider_name ?? null;
  if (providerId && (!providerEmail || !providerName)) {
    const { data: provider } = await supabase
      .from('providers')
      .select('name, email')
      .eq('id', providerId)
      .maybeSingle();
    providerEmail = providerEmail ?? provider?.email ?? null;
    providerName = providerName ?? provider?.name ?? null;
  }

  const preferences = await loadPreferences(supabase, providerId);
  const cutoffMinutes = positiveNumber(
    preferences?.booking_cutoff_minutes,
    DEFAULT_BOOKING_CUTOFF_MINUTES,
  );
  const lateNoticeHours = positiveNumber(
    preferences?.late_booking_notice_hours,
    DEFAULT_LATE_NOTICE_HOURS,
  );
  const notifyLateBookings = preferences?.notify_late_bookings !== false;
  const emailLateBookings = preferences?.email_late_bookings !== false;

  const minutesUntilStart = (appointmentStartAt.getTime() - bookedAt.getTime()) / 60_000;
  const isInsideCutoff = minutesUntilStart < cutoffMinutes;
  const isLateBooking = minutesUntilStart <= lateNoticeHours * 60;

  if (isInsideCutoff) {
    await upsertNotification(supabase, {
      appointmentId,
      providerId,
      providerEmail,
      providerName,
      appointmentStartAt,
      bookedAt,
      minutesUntilStart,
      cutoffMinutes,
      lateNoticeHours,
      notificationStatus: 'blocked_by_cutoff',
      deliveryChannel: null,
      payload: body,
    });
    return json({
      ok: true,
      allowed: false,
      reason: 'booking_cutoff_window',
      booking_cutoff_minutes: cutoffMinutes,
      minutes_until_start: round2(minutesUntilStart),
    });
  }

  if (!notifyLateBookings || !isLateBooking) {
    return json({
      ok: true,
      allowed: true,
      notification_sent: false,
      minutes_until_start: round2(minutesUntilStart),
    });
  }

  let notificationStatus = 'queued';
  let deliveryChannel: string | null = null;
  let sentAt: string | null = null;
  let errorMessage: string | null = null;

  if (emailLateBookings && providerEmail) {
    deliveryChannel = 'email';
    try {
      await sendLateBookingEmail({
        to: providerEmail,
        providerName,
        appointmentStartAt,
        bookedAt,
        timeZone: preferences?.time_zone ?? 'America/New_York',
        visitType: body.visit_type ?? null,
        patientLabel: body.patient_label ?? null,
        actionUrl: body.action_url ?? null,
      });
      notificationStatus = 'sent';
      sentAt = new Date().toISOString();
    } catch (err) {
      notificationStatus = 'email_error';
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  } else {
    notificationStatus = providerEmail ? 'email_disabled' : 'missing_provider_email';
  }

  await upsertNotification(supabase, {
    appointmentId,
    providerId,
    providerEmail,
    providerName,
    appointmentStartAt,
    bookedAt,
    minutesUntilStart,
    cutoffMinutes,
    lateNoticeHours,
    notificationStatus,
    deliveryChannel,
    sentAt,
    errorMessage,
    payload: body,
  });

  return json({
    ok: true,
    allowed: true,
    late_booking: true,
    notification_sent: notificationStatus === 'sent',
    notification_status: notificationStatus,
    minutes_until_start: round2(minutesUntilStart),
  });
});

async function loadPreferences(
  supabase: SupabaseClientAny,
  providerId: string | null,
): Promise<SchedulingPreferences | null> {
  if (!providerId) return null;
  const { data } = await supabase
    .from('provider_scheduling_preferences')
    .select('time_zone, late_booking_notice_hours, booking_cutoff_minutes, notify_late_bookings, email_late_bookings')
    .eq('provider_id', providerId)
    .maybeSingle();
  return data as SchedulingPreferences | null;
}

async function upsertNotification(
  supabase: SupabaseClientAny,
  args: {
    appointmentId: string;
    providerId: string | null;
    providerEmail: string | null;
    providerName: string | null;
    appointmentStartAt: Date;
    bookedAt: Date;
    minutesUntilStart: number;
    cutoffMinutes: number;
    lateNoticeHours: number;
    notificationStatus: string;
    deliveryChannel: string | null;
    sentAt?: string | null;
    errorMessage?: string | null;
    payload: unknown;
  },
) {
  const { error } = await supabase
    .from('provider_booking_notifications')
    .upsert({
      appointment_id: args.appointmentId,
      provider_id: args.providerId,
      provider_email: args.providerEmail,
      provider_name: args.providerName,
      appointment_start_at: args.appointmentStartAt.toISOString(),
      booked_at: args.bookedAt.toISOString(),
      minutes_until_start: round2(args.minutesUntilStart),
      booking_cutoff_minutes: args.cutoffMinutes,
      late_notice_hours: args.lateNoticeHours,
      notification_status: args.notificationStatus,
      delivery_channel: args.deliveryChannel,
      notification_sent_at: args.sentAt ?? null,
      error: args.errorMessage ?? null,
      payload: args.payload,
    }, { onConflict: 'appointment_id' });
  if (error) throw new Error(`booking notification audit write failed: ${error.message}`);
}

async function sendLateBookingEmail(args: {
  to: string;
  providerName: string | null;
  appointmentStartAt: Date;
  bookedAt: Date;
  timeZone: string;
  visitType: string | null;
  patientLabel: string | null;
  actionUrl: string | null;
}) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured');
  const from = Deno.env.get('SCHEDULING_EMAIL_FROM') ?? Deno.env.get('EMAIL_FROM_ADDRESS') ?? 'scheduling@vitablehealth.com';
  const providerFirstName = (args.providerName ?? 'there').trim().split(/\s+/)[0] || 'there';
  const startLabel = formatInTimeZone(args.appointmentStartAt, args.timeZone);
  const bookedLabel = formatInTimeZone(args.bookedAt, args.timeZone);
  const subject = `New late booking for ${startLabel}`;
  const html = [
    `<p>Hi ${escapeHtml(providerFirstName)},</p>`,
    `<p>A visit was booked close to the appointment start time.</p>`,
    '<ul>',
    `<li><strong>Start:</strong> ${escapeHtml(startLabel)}</li>`,
    `<li><strong>Booked:</strong> ${escapeHtml(bookedLabel)}</li>`,
    args.visitType ? `<li><strong>Visit type:</strong> ${escapeHtml(args.visitType)}</li>` : '',
    args.patientLabel ? `<li><strong>Patient:</strong> ${escapeHtml(args.patientLabel)}</li>` : '',
    '</ul>',
    args.actionUrl ? `<p><a href="${escapeHtml(args.actionUrl)}">Open appointment</a></p>` : '',
  ].join('');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [args.to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Resend failed ${res.status}: ${text.slice(0, 300)}`);
  }
}

function parseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function positiveNumber(raw: number | string | null | undefined, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function formatInTimeZone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(date);
  } catch {
    return date.toLocaleString('en-US');
  }
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
