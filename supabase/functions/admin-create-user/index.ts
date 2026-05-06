import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Resend } from 'npm:resend@2.0.0';

const LOGIN_URL = 'https://vitableclinops.lovable.app/auth';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify the request has a valid auth token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Verify the calling user is an admin
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if calling user has admin role
    const { data: callerRoles } = await userClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const isAdmin = callerRoles?.some(r => r.role === 'admin');
    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: 'Only administrators can create accounts' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const { email, password: providedPassword, fullName, roles } = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({ error: 'Email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate a secure random password if none provided
    const password = providedPassword || Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 20) + '!A1';

    // Create admin client with service role
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Create the auth user
    // Check if user already exists
    const { data: existingUsers } = await adminClient.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email === email);

    if (existingUser) {
      return new Response(
        JSON.stringify({ error: `An account with email "${email}" already exists. You can manage their roles from the User Roles page.` }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        must_change_password: true,
      },
    });

    if (createError) {
      return new Response(
        JSON.stringify({ error: createError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // The profile should be auto-created by the database trigger
    // Wait a moment for trigger to complete
    await new Promise(resolve => setTimeout(resolve, 500));

    // Update profile with full name if needed
    if (fullName && newUser.user) {
      await adminClient
        .from('profiles')
        .update({ full_name: fullName })
        .eq('user_id', newUser.user.id);
    }

    // Assign roles (replace default 'provider' role if different roles specified)
    if (roles && Array.isArray(roles) && roles.length > 0 && newUser.user) {
      // Remove default provider role if not in requested roles
      if (!roles.includes('provider')) {
        await adminClient
          .from('user_roles')
          .delete()
          .eq('user_id', newUser.user.id)
          .eq('role', 'provider');
      }

      // Add each requested role
      for (const role of roles) {
        await adminClient
          .from('user_roles')
          .upsert(
            { user_id: newUser.user.id, role },
            { onConflict: 'user_id,role' }
          );
      }
    }

    // Send welcome email with temporary password and login link
    let emailSent = false;
    let emailError: string | null = null;
    try {
      const resendKey = Deno.env.get('RESEND_API_KEY');
      if (resendKey) {
        const resend = new Resend(resendKey);
        const fromAddress = Deno.env.get('EMAIL_FROM_ADDRESS') || 'Vitable Health <onboarding@resend.dev>';
        const greetingName = (fullName && fullName.trim()) || email.split('@')[0];
        const html = `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;line-height:1.6;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px;">
            <h1 style="color:#0f766e;margin:0 0 16px;">Welcome to Vitable ClinOps</h1>
            <p>Hi ${greetingName},</p>
            <p>An account has been created for you. Use the temporary password below to sign in. You'll be asked to set a new password on first login.</p>
            <div style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:20px 0;">
              <p style="margin:0 0 8px;"><strong>Email:</strong> ${email}</p>
              <p style="margin:0;"><strong>Temporary password:</strong> <code style="background:#fff;padding:4px 8px;border-radius:4px;border:1px solid #e5e7eb;font-size:14px;">${password}</code></p>
            </div>
            <p style="margin:24px 0;">
              <a href="${LOGIN_URL}" style="display:inline-block;background:#0f766e;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Log in to Vitable ClinOps</a>
            </p>
            <p style="color:#6b7280;font-size:13px;">Or open this link directly: <a href="${LOGIN_URL}" style="color:#0f766e;">${LOGIN_URL}</a></p>
            <p style="color:#6b7280;font-size:12px;margin-top:32px;">For security, please change your password immediately after signing in.</p>
          </div>
        `;
        const { error: sendErr } = await resend.emails.send({
          from: fromAddress,
          to: [email],
          subject: 'Your Vitable ClinOps account — temporary password inside',
          html,
        });
        if (sendErr) {
          emailError = sendErr.message || String(sendErr);
          console.error('Welcome email failed:', sendErr);
        } else {
          emailSent = true;
        }
      } else {
        emailError = 'RESEND_API_KEY not configured';
      }
    } catch (e) {
      emailError = (e as Error).message;
      console.error('Welcome email exception:', e);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        userId: newUser.user?.id,
        password,
        emailSent,
        emailError,
        message: emailSent
          ? 'Account created and welcome email sent'
          : 'Account created (welcome email failed — share password manually)'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error creating user:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
