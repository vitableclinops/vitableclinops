import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  userId: string;
  fullName?: string;
  email?: string;
  employmentStatus?: 'active' | 'inactive' | 'terminated';
  profession?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Verify caller
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

    // Verify admin
    const { data: callerRoles } = await userClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const isAdmin = callerRoles?.some((r: any) => r.role === 'admin');
    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: 'Only administrators can update accounts' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = (await req.json()) as RequestBody;
    const { userId, fullName, email, employmentStatus, profession } = body;

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'User ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Basic validation
    if (email !== undefined) {
      const trimmed = email.trim();
      if (!trimmed || trimmed.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        return new Response(
          JSON.stringify({ error: 'Invalid email address' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    if (fullName !== undefined && fullName.length > 200) {
      return new Response(
        JSON.stringify({ error: 'Full name too long' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (
      employmentStatus !== undefined &&
      !['active', 'inactive', 'terminated'].includes(employmentStatus)
    ) {
      return new Response(
        JSON.stringify({ error: 'Invalid employment status' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const ALLOWED_PROFESSIONS = ['MD', 'DO', 'NP', 'RN', 'LPC', 'mental_health_coach', 'physician'];
    if (profession !== undefined && profession !== null && !ALLOWED_PROFESSIONS.includes(profession)) {
      return new Response(
        JSON.stringify({ error: 'Invalid profession' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Update auth user (email) if provided
    if (email !== undefined) {
      const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(userId, {
        email: email.trim(),
        email_confirm: true,
      });
      if (authUpdateError) {
        return new Response(
          JSON.stringify({ error: `Auth update failed: ${authUpdateError.message}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Build profile update
    const profileUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (fullName !== undefined) profileUpdate.full_name = fullName.trim();
    if (email !== undefined) profileUpdate.email = email.trim();
    if (employmentStatus !== undefined) profileUpdate.employment_status = employmentStatus;
    if (profession !== undefined) profileUpdate.profession = profession;

    if (Object.keys(profileUpdate).length > 1) {
      const { error: profileError } = await adminClient
        .from('profiles')
        .update(profileUpdate)
        .eq('user_id', userId);

      if (profileError) {
        return new Response(
          JSON.stringify({ error: `Profile update failed: ${profileError.message}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Sync physician role <-> profession (MD/DO)
    if (profession !== undefined) {
      const isPhysicianProfession = profession === 'MD' || profession === 'DO' || profession === 'physician';
      if (isPhysicianProfession) {
        // Ensure physician role exists
        const { data: existingRole } = await adminClient
          .from('user_roles')
          .select('id')
          .eq('user_id', userId)
          .eq('role', 'physician')
          .maybeSingle();
        if (!existingRole) {
          await adminClient.from('user_roles').insert({ user_id: userId, role: 'physician' });
        }
      } else {
        // Remove physician role if profession is no longer MD/DO
        await adminClient
          .from('user_roles')
          .delete()
          .eq('user_id', userId)
          .eq('role', 'physician');
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Account updated' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('admin-update-account error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
