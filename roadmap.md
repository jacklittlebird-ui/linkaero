# Roadmap
- [x] Restore cash-box selection: 11 cash boxes configured with exact chart links; EGP selection verified in authenticated UI without financial test entries
- [x] Automatic treasury voucher numbers and easier account search (Arabic spelling normalization, code search, complete paginated account list)
- [x] Audit current-account entries and chart completeness: all 1,503 codes in the 2025 chart are present; database has two additional cash-in-transit accounts
- [ ] Automatic live CBE feed: blocked because official website rejects requests and no verified buy/sell endpoint is available; stored official rates resolve sell for receipts / buy for payments, missing rates block new foreign-currency vouchers
- [x] Cash-box linkage blocker removed; picker verified without creating financial test records (persisted voucher creation remains untested)
- [x] Custody settlement: settlement screen with expense lines, auto journal (DR expenses + DR cash return, CR custody)
- [x] Block vouchers when cash box / bank has no linked chart account
- [x] Chart of accounts: new account must have a parent (inherits type, level)
- [x] Income statement: Revenue, Direct costs, Station costs, Gross profit, G&A, Other items, Net profit
