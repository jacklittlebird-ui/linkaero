CREATE OR REPLACE FUNCTION public.sync_airport_to_finance_station()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid;
BEGIN
  SELECT id INTO v_company FROM public.companies WHERE code = 'LINK_EG' LIMIT 1;
  IF v_company IS NULL OR NEW.iata_code IS NULL OR btrim(NEW.iata_code) = '' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.finance_stations WHERE company_id = v_company AND upper(code) = upper(NEW.iata_code)) THEN
    INSERT INTO public.finance_stations (company_id, code, name, status)
    VALUES (v_company, upper(NEW.iata_code), COALESCE(NULLIF(NEW.name,''), NEW.iata_code), 'Active');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_airport_to_finance_station ON public.airports;
CREATE TRIGGER trg_sync_airport_to_finance_station AFTER INSERT OR UPDATE OF iata_code, name ON public.airports
FOR EACH ROW EXECUTE FUNCTION public.sync_airport_to_finance_station();

INSERT INTO public.finance_stations (company_id, code, name, status)
SELECT c.id, upper(a.iata_code), COALESCE(NULLIF(a.name,''), a.iata_code), 'Active'
FROM public.airports a CROSS JOIN (SELECT id FROM public.companies WHERE code='LINK_EG' LIMIT 1) c
WHERE a.iata_code IS NOT NULL AND btrim(a.iata_code) <> ''
  AND NOT EXISTS (SELECT 1 FROM public.finance_stations f WHERE f.company_id = c.id AND upper(f.code) = upper(a.iata_code));