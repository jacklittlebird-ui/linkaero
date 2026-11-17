DO $do$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public.validate_treasury_voucher()'::regprocedure) INTO d;
  d := replace(d, 'OR NEW.service_type IS NULL OR NEW.supplier_id IS NULL', 'OR NEW.service_type IS NULL OR (NEW.supplier_id IS NULL AND NEW.supplier_account_id IS NULL)');
  EXECUTE d;
END $do$;