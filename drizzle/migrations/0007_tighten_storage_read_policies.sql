DROP POLICY IF EXISTS "Authenticated users can view agency documents" ON storage.objects;
CREATE POLICY "Signed-in users can view agency documents" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'agency-documents' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Avatars are publicly accessible" ON storage.objects;
CREATE POLICY "Users can view their own avatar files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (auth.uid())::text);