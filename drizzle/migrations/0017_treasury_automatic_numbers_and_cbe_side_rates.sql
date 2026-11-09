CREATE OR REPLACE FUNCTION public.assign_treasury_voucher_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prefix text;
BEGIN
  v_prefix := CASE WHEN NEW.voucher_type = 'receipt' THEN 'RCT'
    WHEN NEW.payment_subtype = 'pending_custody' THEN 'CST'
    WHEN NEW.payment_subtype = 'advance' THEN 'ADV'
    WHEN NEW.payment_subtype = 'cost' THEN 'COST' ELSE 'PAY' END;
  LOOP
    NEW.voucher_no := v_prefix || '-' || public.next_document_number('treasury:' || v_prefix, NEW.voucher_date);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.treasury_vouchers WHERE voucher_no = NEW.voucher_no);
  END LOOP;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.assign_treasury_voucher_number() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_assign_treasury_voucher_number BEFORE INSERT ON public.treasury_vouchers
FOR EACH ROW EXECUTE FUNCTION public.assign_treasury_voucher_number();

CREATE OR REPLACE FUNCTION public.treasury_cbe_quote(_currency public.finance_currency, _date date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT jsonb_build_object('rate_date', rate_date, 'buy_rate', buy_rate, 'sell_rate', sell_rate, 'source', source)
  FROM public.exchange_rates
  WHERE base_currency = 'EGP' AND quote_currency = _currency AND rate_date <= _date
    AND (source = 'CBE' OR source LIKE 'https://www.cbe.org.eg/%')
    AND buy_rate > 0 AND sell_rate > 0
  ORDER BY rate_date DESC, created_at DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.treasury_cbe_quote(public.finance_currency, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.treasury_cbe_quote(public.finance_currency, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_treasury_cbe_rate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_quote jsonb; v_rate numeric;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.currency IS NOT DISTINCT FROM OLD.currency AND NEW.voucher_date IS NOT DISTINCT FROM OLD.voucher_date
      AND NEW.voucher_type IS NOT DISTINCT FROM OLD.voucher_type AND NEW.exchange_rate IS NOT DISTINCT FROM OLD.exchange_rate THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.currency = 'EGP' THEN NEW.exchange_rate := 1;
  ELSE
    v_quote := public.treasury_cbe_quote(NEW.currency, NEW.voucher_date);
    v_rate := CASE WHEN NEW.voucher_type = 'receipt' THEN (v_quote->>'sell_rate')::numeric ELSE (v_quote->>'buy_rate')::numeric END;
    IF v_rate IS NULL OR v_rate <= 0 THEN
      RAISE EXCEPTION 'لا يوجد سعر شراء/بيع موثق من البنك المركزي للعملة % بتاريخ %؛ لا يمكن حفظ السند بسعر بديل', NEW.currency, NEW.voucher_date;
    END IF;
    NEW.exchange_rate := v_rate;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.enforce_treasury_cbe_rate() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_cbe_rate_treasury BEFORE INSERT OR UPDATE ON public.treasury_vouchers
FOR EACH ROW EXECUTE FUNCTION public.enforce_treasury_cbe_rate();