ALTER TABLE public.treasury_vouchers
  ADD COLUMN IF NOT EXISTS supplier_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS flight_no text,
  ADD COLUMN IF NOT EXISTS flight_date date;
CREATE INDEX IF NOT EXISTS idx_tv_flight_date ON public.treasury_vouchers(flight_date) WHERE flight_no IS NOT NULL;