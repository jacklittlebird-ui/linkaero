CREATE OR REPLACE FUNCTION public.require_treasury_cost_centres() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.payment_subtype='cost' AND (TG_OP='INSERT' OR NEW.airline_id IS DISTINCT FROM OLD.airline_id OR NEW.station_id IS DISTINCT FROM OLD.station_id OR NEW.service_type IS DISTINCT FROM OLD.service_type OR NEW.supplier_account_id IS DISTINCT FROM OLD.supplier_account_id OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.lines IS DISTINCT FROM OLD.lines OR NEW.status IS DISTINCT FROM OLD.status) THEN
  IF NEW.airline_id IS NULL OR NEW.station_id IS NULL OR COALESCE(NEW.service_type,'') NOT IN ('Security','Handling') OR NEW.supplier_account_id IS NULL THEN RAISE EXCEPTION 'سند التكلفة يتطلب العميل / شركة الطيران، المحطة، نوع الخدمة، والمورد'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER require_treasury_cost_centres BEFORE INSERT OR UPDATE ON public.treasury_vouchers FOR EACH ROW EXECUTE FUNCTION public.require_treasury_cost_centres();
CREATE OR REPLACE FUNCTION public.record_advance_recovery(_voucher_id uuid, _amount numeric, _notes text DEFAULT NULL) RETURNS public.treasury_vouchers LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.treasury_vouchers;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.is_admin(auth.uid()) OR public.has_finance_access(auth.uid())) THEN RAISE EXCEPTION 'Not authorised to record advance recoveries'; END IF;
 SELECT * INTO v FROM public.treasury_vouchers WHERE id=_voucher_id AND payment_subtype='advance' FOR UPDATE;
 IF v.id IS NULL THEN RAISE EXCEPTION 'Advance voucher not found'; END IF;
 IF v.status NOT IN ('approved','posted') THEN RAISE EXCEPTION 'Only approved or posted advances can be repaid'; END IF;
 IF _amount IS NULL OR _amount::text IN ('NaN','Infinity','-Infinity') OR _amount <= 0 OR _amount <> round(_amount,2) OR _amount > v.amount-v.recovered_amount THEN RAISE EXCEPTION 'Recovery amount must be positive and not exceed the outstanding advance'; END IF;
 PERFORM public.treasury_cash_gl(v.bank_account_id,v.cash_account_id);
 IF v.account_id IS NULL THEN RAISE EXCEPTION 'Advance must have an accounting account'; END IF;
 INSERT INTO public.treasury_vouchers(voucher_no,voucher_type,voucher_date,company_id,station_id,cash_account_id,bank_account_id,account_id,party_name,party_type,description,amount,currency,exchange_rate,rate_manual,status,reference,notes,created_by,lines)
 VALUES ('','receipt',CURRENT_DATE,v.company_id,v.station_id,v.cash_account_id,v.bank_account_id,v.account_id,v.party_name,'Employee','Advance repayment — '||v.voucher_no,_amount,v.currency,v.exchange_rate,true,'posted',v.voucher_no,_notes,auth.uid(),jsonb_build_array(jsonb_build_object('account_id',v.account_id,'amount',_amount,'description','Advance repayment — '||v.voucher_no)));
 UPDATE public.treasury_vouchers SET recovered_amount=recovered_amount+_amount, status=CASE WHEN recovered_amount+_amount=amount THEN 'settled'::public.voucher_status ELSE status END, settled_at=CASE WHEN recovered_amount+_amount=amount THEN now() ELSE settled_at END, settled_by=CASE WHEN recovered_amount+_amount=amount THEN auth.uid() ELSE settled_by END WHERE id=v.id RETURNING * INTO v;
 RETURN v;
END; $$;
REVOKE ALL ON FUNCTION public.record_advance_recovery(uuid,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_advance_recovery(uuid,numeric,text) TO authenticated,service_role;