CREATE OR REPLACE FUNCTION public.treasury_cash_gl(_bank uuid, _cash uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  IF _bank IS NOT NULL THEN
    SELECT gl_account_id INTO v FROM public.bank_accounts WHERE id = _bank;
    IF v IS NULL THEN RAISE EXCEPTION 'لا يمكن الحفظ: الحساب البنكي غير مربوط بحساب في شجرة الحسابات — اربطه أولاً ثم أعد المحاولة'; END IF;
  ELSIF _cash IS NOT NULL THEN
    SELECT gl_account_id INTO v FROM public.cash_accounts WHERE id = _cash;
    IF v IS NULL THEN RAISE EXCEPTION 'لا يمكن الحفظ: الخزينة غير مربوطة بحساب في شجرة الحسابات — اربطها أولاً ثم أعد المحاولة'; END IF;
  ELSE
    RAISE EXCEPTION 'لا يمكن الحفظ: اختر الخزينة أو الحساب البنكي';
  END IF;
  RETURN v;
END; $$;
REVOKE ALL ON FUNCTION public.treasury_cash_gl(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.require_treasury_gl_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.treasury_cash_gl(NEW.bank_account_id, NEW.cash_account_id);
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.require_treasury_gl_link() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_require_treasury_gl_link ON public.treasury_vouchers;
CREATE TRIGGER trg_require_treasury_gl_link BEFORE INSERT OR UPDATE OF bank_account_id, cash_account_id ON public.treasury_vouchers
FOR EACH ROW EXECUTE FUNCTION public.require_treasury_gl_link();

CREATE OR REPLACE FUNCTION public.create_treasury_voucher_journal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cash uuid; v_je uuid; v_no text; v_dr uuid; v_cr uuid;
BEGIN
  IF NEW.journal_entry_id IS NOT NULL OR NEW.account_id IS NULL
     OR NEW.status IN ('draft','void','pending_approval') OR COALESCE(NEW.amount,0) <= 0 THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_pending_id IS NOT NULL THEN RETURN NEW; END IF;
  v_cash := public.treasury_cash_gl(NEW.bank_account_id, NEW.cash_account_id);

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

-- Settle a custody with actual expense lines; posts the settlement entry automatically
CREATE OR REPLACE FUNCTION public.settle_custody_with_lines(_voucher_id uuid, _lines jsonb, _notes text DEFAULT NULL)
RETURNS public.treasury_vouchers LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.treasury_vouchers; s public.treasury_vouchers; v_cash uuid; v_je uuid; v_no text;
  v_spent numeric := 0; v_ret numeric; v_rate numeric; l jsonb; i int := 1; v_first uuid;
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.has_finance_access(auth.uid())) THEN
    RAISE EXCEPTION 'Not authorised to settle custody vouchers';
  END IF;
  SELECT * INTO v FROM public.treasury_vouchers WHERE id = _voucher_id AND payment_subtype = 'pending_custody' FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Pending custody voucher not found'; END IF;
  IF v.status = 'settled' THEN RAISE EXCEPTION 'This custody voucher is already settled'; END IF;
  IF v.account_id IS NULL THEN RAISE EXCEPTION 'Custody voucher has no custody account'; END IF;

  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(_lines, '[]'::jsonb)) LOOP
    IF (l->>'account_id') IS NULL OR COALESCE((l->>'amount')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Each settlement line needs an account and an amount above zero';
    END IF;
    v_spent := v_spent + (l->>'amount')::numeric;
    v_first := COALESCE(v_first, (l->>'account_id')::uuid);
  END LOOP;
  IF v_spent > v.amount THEN RAISE EXCEPTION 'Actual spent cannot exceed the custody amount'; END IF;
  v_ret := v.amount - v_spent;
  v_rate := COALESCE(NULLIF(v.exchange_rate, 0), 1);
  v_cash := public.treasury_cash_gl(v.bank_account_id, v.cash_account_id);

  IF v_spent > 0 THEN
    INSERT INTO public.treasury_vouchers (
      voucher_no, voucher_type, payment_subtype, voucher_date, company_id, station_id,
      cash_account_id, bank_account_id, account_id, party_name, party_type,
      description, amount, currency, exchange_rate, status, parent_pending_id,
      reference, notes, created_by, posted_by, posted_at
    ) VALUES (
      v.voucher_no || '-STL', 'payment', 'general', CURRENT_DATE, v.company_id, v.station_id,
      v.cash_account_id, v.bank_account_id, v_first, v.party_name, v.party_type,
      'Settlement of custody voucher ' || v.voucher_no, v_spent, v.currency, v_rate,
      'posted', v.id, v.voucher_no, _notes, auth.uid(), auth.uid(), now()
    ) RETURNING * INTO s;
  END IF;

  v_no := 'JV-' || public.next_document_number('journal:treasury', CURRENT_DATE);
  INSERT INTO public.journal_entries
    (entry_no, entry_date, description, reference, reference_type, reference_id, status, posted_at,
     total_debit, total_credit, created_by, base_currency, company_id)
  VALUES (v_no, CURRENT_DATE, 'تسوية العهدة ' || v.voucher_no, v.voucher_no, 'treasury_settlement', v.id,
     'Posted', now(), ROUND(v.amount * v_rate, 2), ROUND(v.amount * v_rate, 2),
     COALESCE(auth.uid()::text, 'system'), 'EGP', v.company_id)
  RETURNING id INTO v_je;

  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(_lines, '[]'::jsonb)) LOOP
    INSERT INTO public.journal_entry_lines
      (entry_id, account_id, debit, credit, description, sort_order, company_id, station_id,
       transaction_currency, transaction_amount, exchange_rate, exchange_rate_date, base_currency, base_amount)
    VALUES (v_je, (l->>'account_id')::uuid, ROUND((l->>'amount')::numeric * v_rate, 2), 0,
       COALESCE(NULLIF(l->>'description',''), v.voucher_no), i, v.company_id, v.station_id,
       v.currency, (l->>'amount')::numeric, v_rate, CURRENT_DATE, 'EGP', ROUND((l->>'amount')::numeric * v_rate, 2));
    i := i + 1;
  END LOOP;
  IF v_ret > 0 THEN
    INSERT INTO public.journal_entry_lines
      (entry_id, account_id, debit, credit, description, sort_order, company_id, station_id,
       transaction_currency, transaction_amount, exchange_rate, exchange_rate_date, base_currency, base_amount)
    VALUES (v_je, v_cash, ROUND(v_ret * v_rate, 2), 0, 'مرتجع العهدة ' || v.voucher_no, i, v.company_id, v.station_id,
       v.currency, v_ret, v_rate, CURRENT_DATE, 'EGP', ROUND(v_ret * v_rate, 2));
    i := i + 1;
  END IF;
  INSERT INTO public.journal_entry_lines
    (entry_id, account_id, debit, credit, description, sort_order, company_id, station_id,
     transaction_currency, transaction_amount, exchange_rate, exchange_rate_date, base_currency, base_amount)
  VALUES (v_je, v.account_id, 0, ROUND(v.amount * v_rate, 2), 'إقفال العهدة ' || v.voucher_no, i, v.company_id, v.station_id,
     v.currency, v.amount, v_rate, CURRENT_DATE, 'EGP', ROUND(v.amount * v_rate, 2));

  IF s.id IS NOT NULL THEN UPDATE public.treasury_vouchers SET journal_entry_id = v_je WHERE id = s.id; END IF;

  UPDATE public.treasury_vouchers
     SET status = 'settled', settled_amount = v_spent, returned_amount = v_ret,
         settled_at = now(), settled_by = auth.uid(),
         settlement_voucher_id = s.id, notes = COALESCE(_notes, notes)
   WHERE id = v.id RETURNING * INTO v;
  RETURN v;
END; $$;
REVOKE ALL ON FUNCTION public.settle_custody_with_lines(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_custody_with_lines(uuid, jsonb, text) TO authenticated, service_role;

-- Every new account must sit under a parent; inherits statement type and level
CREATE OR REPLACE FUNCTION public.enforce_account_parent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.chart_of_accounts;
BEGIN
  IF NEW.parent_id IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.parent_id IS NULL THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'يجب ربط الحساب بحساب رئيسي/فرعي في شجرة الحسابات';
  END IF;
  SELECT * INTO p FROM public.chart_of_accounts WHERE id = NEW.parent_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'الحساب الرئيسي غير موجود'; END IF;
  NEW.account_type := p.account_type;
  NEW.level := COALESCE(p.level, 0) + 1;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.enforce_account_parent() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_enforce_account_parent ON public.chart_of_accounts;
CREATE TRIGGER trg_enforce_account_parent BEFORE INSERT OR UPDATE OF parent_id ON public.chart_of_accounts
FOR EACH ROW EXECUTE FUNCTION public.enforce_account_parent();