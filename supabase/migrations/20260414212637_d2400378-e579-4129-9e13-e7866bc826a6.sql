ALTER TABLE public.homebase_shifts
ADD CONSTRAINT homebase_shifts_homebase_employee_id_fkey
FOREIGN KEY (homebase_employee_id) REFERENCES public.homebase_employees(id);