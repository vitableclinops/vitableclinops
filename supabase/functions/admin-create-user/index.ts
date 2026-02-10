import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email since admin is creating
      user_metadata: {
        full_name: fullName,
        must_change_password: true, // Flag for frontend to enforce password change
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

    return new Response(
      JSON.stringify({ 
        success: true, 
        userId: newUser.user?.id,
        password,
        message: 'Account created successfully' 
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
