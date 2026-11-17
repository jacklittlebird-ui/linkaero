CREATE OR REPLACE FUNCTION public.admin_reset_treasury_vouchers()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_je uuid[]; v_v int; v_j int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT array_agg(DISTINCT id) INTO v_je FROM (
    SELECT id FROM public.journal_entries WHERE reference_type = 'treasury_voucher'
    UNION SELECT journal_entry_id FROM public.treasury_vouchers WHERE journal_entry_id IS NOT NULL) s;
  UPDATE public.short_term_loans SET voucher_id = NULL WHERE voucher_id IS NOT NULL;
  UPDATE public.treasury_vouchers SET parent_pending_id = NULL, journal_entry_id = NULL WHERE id IS NOT NULL;
  DELETE FROM public.treasury_vouchers WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_v = ROW_COUNT;
  DELETE FROM public.journal_entry_lines WHERE entry_id = ANY(COALESCE(v_je, '{}'));
  DELETE FROM public.journal_entries WHERE id = ANY(COALESCE(v_je, '{}'));
  GET DIAGNOSTICS v_j = ROW_COUNT;
  DELETE FROM public.treasury_number_reservations WHERE id IS NOT NULL;
  DELETE FROM public.document_sequences WHERE scope LIKE 'treasury:%' OR scope = 'journal:treasury';
  RETURN jsonb_build_object('vouchers', v_v, 'journals', v_j);
END $$;
REVOKE ALL ON FUNCTION public.admin_reset_treasury_vouchers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_treasury_vouchers() TO authenticated;