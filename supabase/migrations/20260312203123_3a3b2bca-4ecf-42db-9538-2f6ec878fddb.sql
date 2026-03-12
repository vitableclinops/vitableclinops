-- Allow providers to INSERT their own licenses during onboarding
CREATE POLICY "Providers can insert their own licenses"
ON public.provider_licenses
FOR INSERT
TO authenticated
WITH CHECK (
  profile_id IN (
    SELECT profiles.id FROM profiles WHERE profiles.user_id = auth.uid()
  )
);

-- Allow providers to UPDATE their own licenses
CREATE POLICY "Providers can update their own licenses"
ON public.provider_licenses
FOR UPDATE
TO authenticated
USING (
  profile_id IN (
    SELECT profiles.id FROM profiles WHERE profiles.user_id = auth.uid()
  )
)
WITH CHECK (
  profile_id IN (
    SELECT profiles.id FROM profiles WHERE profiles.user_id = auth.uid()
  )
);