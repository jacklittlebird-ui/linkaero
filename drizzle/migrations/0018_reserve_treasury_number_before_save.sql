CREATE TABLE public.treasury_number_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, voucher_no text NOT NULL UNIQUE,
 prefix text NOT NULL, voucher_date date NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.treasury_number_reservations TO authenticated;
GRANT ALL ON public.treasury_number_reservations TO service_role;
ALTER TABLE public.treasury_number_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY treasury_number_reservations_own_read ON public.treasury_number_reservations FOR SELECT TO authenticated USING (user_id=auth.uid());
ALTER TABLE public.treasury_vouchers ADD COLUMN number_reservation_id uuid REFERENCES public.treasury_number_reservations(id);
CREATE OR REPLACE FUNCTION public.reserve_treasury_voucher_number(_subtype text, _date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_prefix text; v_no text; v_id uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_finance_access(auth.uid()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
 IF _date IS NULL OR (_subtype IS NOT NULL AND _subtype NOT IN ('general','pending_custody','advance','cost')) THEN RAISE EXCEPTION 'Invalid voucher type or date'; END IF;
 v_prefix := CASE WHEN _subtype IS NULL THEN 'RCT' WHEN _subtype='pending_custody' THEN 'CST' WHEN _subtype='advance' THEN 'ADV' WHEN _subtype='cost' THEN 'COST' ELSE 'PAY' END;
 LOOP
 v_no := v_prefix || '-' || public.next_document_number('treasury:' || v_prefix,_date);
 EXIT WHEN NOT EXISTS(SELECT 1 FROM public.treasury_vouchers WHERE voucher_no=v_no);
 END LOOP;
 INSERT INTO public.treasury_number_reservations(user_id,voucher_no,prefix,voucher_date) VALUES(auth.uid(),v_no,v_prefix,_date) RETURNING id INTO v_id;
 RETURN jsonb_build_object('id',v_id,'voucher_no',v_no);
END; $$;
REVOKE ALL ON FUNCTION public.reserve_treasury_voucher_number(text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reserve_treasury_voucher_number(text,date) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.assign_treasury_voucher_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_prefix text; v_no text;
BEGIN
 v_prefix := CASE WHEN NEW.voucher_type='receipt' THEN 'RCT' WHEN NEW.payment_subtype='pending_custody' THEN 'CST' WHEN NEW.payment_subtype='advance' THEN 'ADV' WHEN NEW.payment_subtype='cost' THEN 'COST' ELSE 'PAY' END;
 IF NEW.number_reservation_id IS NOT NULL THEN
 UPDATE public.treasury_number_reservations SET used_at=now()
 WHERE id=NEW.number_reservation_id AND user_id=auth.uid() AND prefix=v_prefix AND voucher_date=NEW.voucher_date AND used_at IS NULL
 RETURNING voucher_no INTO v_no;
 IF v_no IS NULL THEN RAISE EXCEPTION 'Invalid or already used voucher number reservation'; END IF;
 NEW.voucher_no := v_no;
 ELSE
 LOOP
 NEW.voucher_no := v_prefix || '-' || public.next_document_number('treasury:' || v_prefix,NEW.voucher_date);
 EXIT WHEN NOT EXISTS(SELECT 1 FROM public.treasury_vouchers WHERE voucher_no=NEW.voucher_no);
 END LOOP;
 END IF;
 RETURN NEW;
END; $$;