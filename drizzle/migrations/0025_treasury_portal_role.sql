ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'treasury';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.has_finance_access(_user_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id
    AND role::text IN ('admin','general_accounts','receivables','payables','accountant','treasury'))
$function$;
