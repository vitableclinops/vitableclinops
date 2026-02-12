CREATE POLICY "Authenticated users can view pod_lead roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (role = 'pod_lead');