CREATE OR REPLACE FUNCTION public.auto_link_dispatch_security_contract()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_airline text; v_contract_id uuid; v_count int; v_c_airline text;
BEGIN
  SELECT a.name INTO v_airline
  FROM public.flight_schedules fs LEFT JOIN public.airlines a ON a.id = fs.airline_id
  WHERE fs.id = NEW.flight_schedule_id;

  IF v_airline IS NULL OR btrim(v_airline) = '' THEN RETURN NEW; END IF;

  IF NEW.contract_id IS NOT NULL THEN
    SELECT c.airline INTO v_c_airline FROM public.contracts c WHERE c.id = NEW.contract_id;
    IF v_c_airline IS NOT NULL AND lower(btrim(v_c_airline)) = lower(btrim(v_airline)) THEN
      RETURN NEW;
    END IF;
    NEW.contract_id := NULL; -- contract belongs to another airline
  END IF;

  SELECT c.id, count(*) OVER () INTO v_contract_id, v_count
  FROM public.contracts c
  WHERE c.status = 'Active' AND c.service_category IN ('Security','Both')
    AND lower(btrim(c.airline)) = lower(btrim(v_airline))
  LIMIT 1;

  IF v_count = 1 THEN NEW.contract_id := v_contract_id; END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_dispatch_contract_airline ON public.dispatch_assignments;
CREATE TRIGGER trg_validate_dispatch_contract_airline
BEFORE UPDATE OF contract_id ON public.dispatch_assignments
FOR EACH ROW EXECUTE FUNCTION public.auto_link_dispatch_security_contract();