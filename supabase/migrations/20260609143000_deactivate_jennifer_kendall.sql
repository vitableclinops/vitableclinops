update public.providers
set
  active = false,
  employment_status = 'termed',
  updated_at = now()
where lower(email) = 'jennifer.kendall@vitablehealth.com'
  and lower(name) = 'jennifer kendall';
