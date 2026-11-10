ALTER TABLE public.treasury_vouchers ADD COLUMN IF NOT EXISTS lines jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.validate_treasury_voucher_lines()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE s numeric := 0; l jsonb;
BEGIN
  IF jsonb_typeof(NEW.lines) <> 'array' OR jsonb_array_length(NEW.lines) = 0 THEN RETURN NEW; END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(NEW.lines) LOOP
    IF NULLIF(l->>'account_id','') IS NULL THEN RAISE EXCEPTION 'كل بند يجب أن يرتبط بحساب من الدليل'; END IF;
    IF COALESCE((l->>'amount')::numeric,0) <= 0 THEN RAISE EXCEPTION 'مبلغ كل بند يجب أن يكون أكبر من صفر'; END IF;
    s := s + (l->>'amount')::numeric;
  END LOOP;
  IF round(s,2) <> round(NEW.amount,2) THEN
    RAISE EXCEPTION 'إجمالي البنود (%) لا يساوي إجمالي الخزينة (%)', s, NEW.amount;
  END IF;
  NEW.account_id := (NEW.lines->0->>'account_id')::uuid;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_treasury_voucher_lines ON public.treasury_vouchers;
CREATE TRIGGER trg_validate_treasury_voucher_lines BEFORE INSERT OR UPDATE ON public.treasury_vouchers
FOR EACH ROW EXECUTE FUNCTION public.validate_treasury_voucher_lines();

CREATE OR REPLACE FUNCTION public.create_treasury_voucher_journal()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_cash uuid; v_je uuid; v_no text; v_dr uuid; v_cr uuid;
  l jsonb; i int := 0; n int; v_base numeric; v_used numeric := 0; is_rcpt boolean;
BEGIN
  IF NEW.journal_entry_id IS NOT NULL OR NEW.account_id IS NULL
     OR NEW.status IN ('draft','void','pending_approval') OR COALESCE(NEW.amount,0) <= 0 THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_pending_id IS NOT NULL THEN RETURN NEW; END IF;
  v_cash := public.treasury_cash_gl(NEW.bank_account_id, NEW.cash_account_id);
  is_rcpt := NEW.voucher_type = 'receipt';

  v_no := 'JV-' || public.next_document_number('journal:treasury', NEW.voucher_date);
  INSERT INTO public.journal_entries
    (entry_no, entry_date, description, reference, reference_type, reference_id, status, posted_at,
     total_debit, total_credit, created_by, base_currency, company_id)
  VALUES
    (v_no, NEW.voucher_date, COALESCE(NULLIF(NEW.description,''), 'Treasury voucher ' || NEW.voucher_no),
     NEW.voucher_no, 'treasury_voucher', NEW.id, 'Posted', now(),
     NEW.base_amount, NEW.base_amount, COALESCE(auth.uid()::text, 'system'), 'EGP', NEW.company_id)
  RETURNING id INTO v_je;

  -- cash/bank line (full amount)
  INSERT INTO public.journal_entry_lines
    (entry_id, account_id, debit, credit, description, sort_order, company_id, station_id,
     service_type, airline_id, supplier_id, flight_schedule_id,
     transaction_currency, transaction_amount, exchange_rate, exchange_rate_date, base_currency, base_amount)
  VALUES
    (v_je, v_cash, CASE WHEN is_rcpt THEN NEW.base_amount ELSE 0 END, CASE WHEN is_rcpt THEN 0 ELSE NEW.base_amount END,
     NEW.voucher_no, 1, NEW.company_id, NEW.station_id,
     NEW.service_type, NEW.airline_id, NEW.supplier_id, NEW.flight_schedule_id,
     NEW.currency, NEW.amount, NEW.exchange_rate, NEW.voucher_date, 'EGP', NEW.base_amount);

  IF jsonb_array_length(COALESCE(NEW.lines,'[]'::jsonb)) > 0 THEN
    n := jsonb_array_length(NEW.lines);
    FOR l IN SELECT * FROM jsonb_array_elements(NEW.lines) LOOP
      i := i + 1;
      IF i = n THEN v_base := NEW.base_amount - v_used;
      ELSE v_base := round((l->>'amount')::numeric * NEW.exchange_rate, 2); v_used := v_used + v_base; END IF;
      INSERT INTO public.journal_entry_lines
        (entry_id, account_id, debit, credit, description, sort_order, company_id, station_id,
         service_type, airline_id, supplier_id, flight_schedule_id,
         transaction_currency, transaction_amount, exchange_rate, exchange_rate_date, base_currency, base_amount)
      VALUES
        (v_je, (l->>'account_id')::uuid, CASE WHEN is_rcpt THEN 0 ELSE v_base END, CASE WHEN is_rcpt THEN v_base ELSE 0 END,
         COALESCE(NULLIF(l->>'description',''), NEW.voucher_no), i + 1, NEW.company_id, NEW.station_id,
         NEW.service_type, NEW.airline_id, NEW.supplier_id, NEW.flight_schedule_id,
         NEW.currency, (l->>'amount')::numeric, NEW.exchange_rate, NEW.voucher_date, 'EGP', v_base);
    END LOOP;
  ELSE
    INSERT INTO public.journal_entry_lines
      (entry_id, account_id, debit, credit, description, sort_order, company_id, station_id,
       service_type, airline_id, supplier_id, flight_schedule_id,
       transaction_currency, transaction_amount, exchange_rate, exchange_rate_date, base_currency, base_amount)
    VALUES
      (v_je, NEW.account_id, CASE WHEN is_rcpt THEN 0 ELSE NEW.base_amount END, CASE WHEN is_rcpt THEN NEW.base_amount ELSE 0 END,
       NEW.voucher_no, 2, NEW.company_id, NEW.station_id,
       NEW.service_type, NEW.airline_id, NEW.supplier_id, NEW.flight_schedule_id,
       NEW.currency, NEW.amount, NEW.exchange_rate, NEW.voucher_date, 'EGP', NEW.base_amount);
  END IF;

  UPDATE public.treasury_vouchers SET journal_entry_id = v_je WHERE id = NEW.id;
  RETURN NEW;
END; $function$;