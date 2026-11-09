ALTER TABLE public.treasury_vouchers
  ADD COLUMN IF NOT EXISTS movement_kind text,
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vendor_invoice_id uuid REFERENCES public.vendor_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS on_account boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.treasury_vouchers.movement_kind IS 'customer | supplier | financing | cash_in_transit | expense | other';

CREATE OR REPLACE FUNCTION public.treasury_voucher_mark_invoice_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status IN ('approved','posted') AND NOT NEW.on_account THEN
    IF NEW.invoice_id IS NOT NULL THEN
      UPDATE public.invoices SET status = 'Paid' WHERE id = NEW.invoice_id AND status <> 'Paid';
    END IF;
    IF NEW.vendor_invoice_id IS NOT NULL THEN
      UPDATE public.vendor_invoices SET status = 'Paid' WHERE id = NEW.vendor_invoice_id AND status <> 'Paid';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_treasury_voucher_mark_invoice_paid ON public.treasury_vouchers;
CREATE TRIGGER trg_treasury_voucher_mark_invoice_paid
AFTER INSERT OR UPDATE OF status ON public.treasury_vouchers
FOR EACH ROW EXECUTE FUNCTION public.treasury_voucher_mark_invoice_paid();