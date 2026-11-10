ALTER TABLE public.treasury_vouchers ADD COLUMN IF NOT EXISTS rate_manual boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.enforce_treasury_cbe_rate()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_quote jsonb; v_rate numeric;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.currency IS NOT DISTINCT FROM OLD.currency AND NEW.voucher_date IS NOT DISTINCT FROM OLD.voucher_date
      AND NEW.voucher_type IS NOT DISTINCT FROM OLD.voucher_type AND NEW.exchange_rate IS NOT DISTINCT FROM OLD.exchange_rate
      AND NEW.rate_manual IS NOT DISTINCT FROM OLD.rate_manual THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.currency = 'EGP' THEN NEW.exchange_rate := 1; NEW.rate_manual := false;
  ELSIF NEW.rate_manual THEN
    IF NEW.exchange_rate IS NULL OR NEW.exchange_rate <= 0 THEN
      RAISE EXCEPTION 'أدخل سعر صرف يدوي أكبر من صفر';
    END IF;
  ELSE
    v_quote := public.treasury_cbe_quote(NEW.currency, NEW.voucher_date);
    v_rate := CASE WHEN NEW.voucher_type = 'receipt' THEN (v_quote->>'sell_rate')::numeric ELSE (v_quote->>'buy_rate')::numeric END;
    IF v_rate IS NULL OR v_rate <= 0 THEN
      RAISE EXCEPTION 'لا يوجد سعر موثق من البنك المركزي للعملة % بتاريخ %؛ استخدم الإدخال اليدوي', NEW.currency, NEW.voucher_date;
    END IF;
    NEW.exchange_rate := v_rate;
  END IF;
  RETURN NEW;
END; $function$;