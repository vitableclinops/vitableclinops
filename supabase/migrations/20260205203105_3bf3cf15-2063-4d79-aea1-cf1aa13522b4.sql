-- Allow null user_id for admin-imported profiles (pilot program)
-- These profiles will be linked when users sign up via email

ALTER TABLE public.profiles ALTER COLUMN user_id DROP NOT NULL;

-- Add unique constraint on email to enable upsert on signup
ALTER TABLE public.profiles ADD CONSTRAINT profiles_email_unique UNIQUE (email);

-- Update the handle_new_user function to link existing profiles by email
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  existing_profile_id uuid;
BEGIN
  -- Check if profile already exists with this email (admin pre-created)
  SELECT id INTO existing_profile_id
  FROM public.profiles
  WHERE email = NEW.email;
  
  IF existing_profile_id IS NOT NULL THEN
    -- Link existing profile to new user
    UPDATE public.profiles
    SET user_id = NEW.id,
        full_name = COALESCE(full_name, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', '')
    WHERE id = existing_profile_id;
  ELSE
    -- Create new profile
    INSERT INTO public.profiles (user_id, email, full_name)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', '')
    );
  END IF;
  
  -- Auto-assign 'provider' role as default (most common user type)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'provider')
  ON CONFLICT (user_id, role) DO NOTHING;
  
  RETURN NEW;
END;
$$;

-- Update RLS policies to handle null user_id profiles (admin-imported)
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;

-- Users can view their own profile OR profiles where user_id is null (admin view only handles those)
CREATE POLICY "Users can view their own profile"
ON public.profiles
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
ON public.profiles
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile"
ON public.profiles
FOR INSERT
WITH CHECK (auth.uid() = user_id);