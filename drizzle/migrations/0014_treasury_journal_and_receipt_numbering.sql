CREATE TABLE IF NOT EXISTS public.document_sequences (
  scope text NOT NULL,
  seq_year int NOT NULL,
  last_no int NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, seq_year)
);
GRANT SELECT ON public.document_sequences TO authenticated;
GRANT ALL ON public.document_sequences TO service_role;
ALTER TABLE public.document_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_sequences_read ON public.document_sequences FOR SELECT TO authenticated USING (true);

-- Returns NNNN-YYYY, counter independent per scope and year
CREATE OR REPLACE FUNCTION public.next_document_number(_scope text, _date date)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_year int := EXTRACT(YEAR FROM COALESCE(_date, CURRENT_DATE))::int; v_no int;
BEGIN
  INSERT INTO public.document_sequences(scope, seq_year, last_no) VALUES (_scope, v_year, 1)
  ON CONFLICT (scope, seq_year) DO UPDATE SET last_no = public.document_sequences.last_no + 1
  RETURNING last_no INTO v_no;
  RETURN lpad(v_no::text, 4, '0') || '-' || v_year::text;
END; $$;
REVOKE EXECUTE ON FUNCTION public.next_document_number(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_document_number(text, date) TO authenticated, service_role;

-- Receipts: automatic number per receipt type (method)
CREATE OR REPLACE FUNCTION public.assign_receipt_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prefix text;
BEGIN
  IF NEW.receipt_no IS NULL OR btrim(NEW.receipt_no) = '' THEN
    v_prefix := CASE NEW.method
      WHEN 'Cash' THEN 'CSH' WHEN 'Bank Transfer' THEN 'BNK' WHEN 'Cheque' THEN 'CHQ'
      WHEN 'Credit Card' THEN 'CRD' WHEN 'Online' THEN 'ONL' ELSE 'RCT' END;
    NEW.receipt_no := v_prefix || '-' || public.next_document_number('receipt:' || v_prefix, NEW.receipt_date);
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.assign_receipt_number() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_assign_receipt_number ON public.receipts;
CREATE TRIGGER trg_assign_receipt_number BEFORE INSERT ON public.receipts
FOR EACH ROW EXECUTE FUNCTION public.assign_receipt_number();
ALTER TABLE public.receipts ALTER COLUMN receipt_no SET DEFAULT '';

-- GL account links for cash boxes and bank accounts
ALTER TABLE public.cash_accounts ADD COLUMN IF NOT EXISTS gl_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.bank_accounts ADD COLUMN IF NOT EXISTS gl_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;

-- Allow journal entries on pending custody vouchers (every voucher type gets an entry)
CREATE OR REPLACE FUNCTION public.validate_treasury_voucher()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text; v_rate numeric;
BEGIN
  NEW.base_currency := 'EGP';
  IF NEW.currency = 'EGP' THEN
    NEW.exchange_rate := 1;
  ELSIF COALESCE(NEW.exchange_rate, 0) <= 0 THEN
    v_rate := public.treasury_daily_rate(NEW.currency, NEW.voucher_date);
    IF v_rate IS NULL THEN
      RAISE EXCEPTION 'No daily exchange rate found for % on % — enter the CBE rate first', NEW.currency, NEW.voucher_date;
    END IF;
    NEW.exchange_rate := v_rate;
  END IF;
  NEW.base_amount := ROUND(COALESCE(NEW.amount,0) * NEW.exchange_rate, 2);

  IF NEW.voucher_type = 'receipt' THEN
    NEW.payment_subtype := NULL; NEW.pending_kind := NULL;
    NEW.requires_approval := false; NEW.print_unlocked := true;
  ELSE
    IF NEW.payment_subtype IS NULL THEN
      RAISE EXCEPTION 'Payment vouchers must specify a subtype (general, pending_custody, advance, cost)';
    END IF;
    IF NEW.payment_subtype = 'pending_custody' THEN
      NEW.voucher_type := 'pending';
      IF NEW.pending_kind IS NULL THEN
        RAISE EXCEPTION 'Pending custody vouchers must specify the custody kind (company or current)';
      END IF;
      NEW.requires_approval := false; NEW.print_unlocked := true;
    ELSE
      NEW.voucher_type := 'payment'; NEW.pending_kind := NULL; NEW.print_unlocked := true;
    END IF;
    IF NEW.payment_subtype = 'advance' THEN
      NEW.requires_approval := true;
      NEW.print_unlocked := (NEW.finance_approved_by IS NOT NULL);
      IF NEW.repayment_plan IS NULL THEN
        RAISE EXCEPTION 'Advance vouchers require a repayment plan (full, 2, 3, 4 or 6 months)';
      END IF;
    END IF;
    IF NEW.payment_subtype = 'cost' THEN
      IF NEW.airline_id IS NULL OR NEW.station_id IS NULL
         OR NEW.service_type IS NULL OR NEW.supplier_id IS NULL THEN
        RAISE EXCEPTION 'Cost vouchers require all four cost centres: airline/customer, airport/station, service type and supplier';
      END IF;
      IF NEW.account_id IS NOT NULL THEN
        SELECT code INTO v_code FROM public.chart_of_accounts WHERE id = NEW.account_id;
        IF v_code LIKE '8%' AND NEW.flight_schedule_id IS NULL THEN
          RAISE EXCEPTION 'Accounts starting with 8 must be linked to a flight schedule';
        END IF;
      END IF;
    END IF;
  END IF;

  IF NEW.status IN ('posted','settled') AND NEW.payment_subtype = 'advance'
     AND NEW.finance_approved_by IS NULL THEN
    RAISE EXCEPTION 'Advance vouchers require finance manager approval before posting or printing';
  END IF;
  IF NEW.status = 'posted' AND NEW.payment_subtype = 'pending_custody' THEN
    RAISE EXCEPTION 'Pending custody vouchers cannot be posted — settle them instead';
  END IF;
  RETURN NEW;
END; $$;

-- Create a numbered journal entry linked to the voucher's account
CREATE OR REPLACE FUNCTION public.create_treasury_voucher_journal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cash uuid; v_je uuid; v_no text; v_dr uuid; v_cr uuid; v_code text;
BEGIN
  IF NEW.journal_entry_id IS NOT NULL OR NEW.account_id IS NULL
     OR NEW.status IN ('draft','void','pending_approval') OR COALESCE(NEW.amount,0) <= 0 THEN
    RETURN NEW;
  END IF;
  -- custody settlement vouchers: cash already moved when the custody was issued
  IF NEW.parent_pending_id IS NOT NULL THEN RETURN NEW; END IF;

  IF NEW.bank_account_id IS NOT NULL THEN
    SELECT gl_account_id INTO v_cash FROM public.bank_accounts WHERE id = NEW.bank_account_id;
    v_code := '120120000';
  ELSE
    SELECT gl_account_id INTO v_cash FROM public.cash_accounts WHERE id = NEW.cash_account_id;
    v_code := '120110000';
  END IF;
  IF v_cash IS NULL THEN
    SELECT id INTO v_cash FROM public.chart_of_accounts WHERE code = v_code LIMIT 1;
  END IF;
  IF v_cash IS NULL THEN RETURN NEW; END IF;

  IF NEW.voucher_type = 'receipt' THEN v_dr := v_cash; v_cr := NEW.account_id;
  ELSE v_dr := NEW.account_id; v_cr := v_cash; END IF;

  v_no := 'JV-' || public.next_document_number('journal:treasury', NEW.voucher_date);
  INSERT INTO public.journal_entries
    (entry_no, entry_date, description, reference, reference_type, reference_id, status, posted_at,
     total_debit, total_credit, created_by, base_currency, company_id)
  VALUES
    (v_no, NEW.voucher_date, COALESCE(NULLIF(NEW.description,''), 'Treasury voucher ' || NEW.voucher_no),
     NEW.voucher_no, 'treasury_voucher', NEW.id, 'Posted', now(),
     NEW.base_amount, NEW.base_amount, COALESCE(auth.uid()::text, 'system'), 'EGP', NEW.company_id)
  RETURNING id INTO v_je;

  INSERT INTO public.journal_entry_lines
    (entry_id, account_id, debit, credit, description, sort_order, company_id, station_id,
     service_type, airline_id, supplier_id, flight_schedule_id,
     transaction_currency, transaction_amount, exchange_rate, exchange_rate_date, base_currency, base_amount)
  VALUES
    (v_je, v_dr, NEW.base_amount, 0, NEW.voucher_no, 1, NEW.company_id, NEW.station_id,
     NEW.service_type, NEW.airline_id, NEW.supplier_id, NEW.flight_schedule_id,
     NEW.currency, NEW.amount, NEW.exchange_rate, NEW.voucher_date, 'EGP', NEW.base_amount),
    (v_je, v_cr, 0, NEW.base_amount, NEW.voucher_no, 2, NEW.company_id, NEW.station_id,
     NEW.service_type, NEW.airline_id, NEW.supplier_id, NEW.flight_schedule_id,
     NEW.currency, NEW.amount, NEW.exchange_rate, NEW.voucher_date, 'EGP', NEW.base_amount);

  UPDATE public.treasury_vouchers SET journal_entry_id = v_je WHERE id = NEW.id;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.create_treasury_voucher_journal() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_treasury_voucher_journal ON public.treasury_vouchers;
CREATE TRIGGER trg_treasury_voucher_journal AFTER INSERT OR UPDATE OF status, account_id ON public.treasury_vouchers
FOR EACH ROW EXECUTE FUNCTION public.create_treasury_voucher_journal();