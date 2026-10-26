# Phase 2 brief: Sales & POS (shared facts for every work stream)

Read `docs/CONVENTIONS.md` first (it applies fully), then this file, then the Laravel code for your stream.
Reference implementations to copy the style from: Products (`apps/api/src/modules/products/products/*`,
web `.../m/products/*`) and Contacts (`apps/api/src/modules/contacts/*`).

## Streams and ownership (do not touch another stream's folders)

| Stream | API folder | Web folder | Laravel spec |
|---|---|---|---|
| A. Sales engine | `modules/sales/` (`sales.module.ts`) | none (API only; write `docs/SALES-API.md`) | `SellPosController`, `SellController`, `TransactionPaymentController`, `TransactionUtil` (createSellTransaction, updateSellTransaction, createOrUpdateSellLines, createOrUpdatePaymentLines, getInvoiceNumber, updatePaymentStatus, mapPurchaseSell, adjustMappingPurchaseSell, deleteSale), `ProductUtil` (calculateInvoiceTotal, decreaseProductQuantity, updateProductStock), `app/Transaction.php`, `TransactionSellLine.php`, `TransactionPayment.php`, `InvoiceScheme.php` |
| B. Cash register | `modules/cash-register/` | `m/sell/register/` | `CashRegisterController`, `CashRegisterUtil`, `CashRegister*.php`, `resources/views/cash_register/*` |
| C. Sell return | `modules/sell-returns/` | `m/sell/returns/` | `SellReturnController`, `TransactionUtil::addSellReturn` (+ related stock/mapping/payment code), `resources/views/sell_return/*` |
| D. POS & sales screens (wave 2, after A) | none | `m/sell/` (layout, POS, sales list, add/edit sale, detail, drafts, quotations, payment dialog, receipt print) | `resources/views/sale_pos/*`, `sell/*` |

Cross-stream contract: `apps/api/src/modules/cash-register/cash-register.service.ts` (written by the lead).
Stream A calls `getOpenRegister`, `addSellPayments`, `updateSellPayments` inside its own DB transaction;
stream B replaces the `NotImplementedException` bodies (keep signatures, extra methods allowed).
Until B finishes, A must still compile and test its own logic (mock the service in unit tests).

## Data model facts (verify in Laravel and with read-only SELECTs)

- A sale is a `transactions` row with `type = 'sell'`; drafts, quotations and suspended sales are variations of status /
  sub_status / is_suspend. Lines are `transaction_sell_lines`; payments `transaction_payments`; stock is
  `variation_location_details.qty_available`, and FIFO cost mapping is `transaction_sell_lines_purchase_lines`
  (sell line <-> purchase line with quantity, plus `qty_returned`).
- Invoice numbers come from `invoice_schemes` (prefix, start_number, invoice_count, total_digits, scheme_type blank|year) via
  `TransactionUtil::getInvoiceNumber`; the counter must be incremented atomically (`SELECT ... FOR UPDATE` in the same transaction).
- The local DB has real data to compare against: business_id 1 has ~1,097 final sales (`transactions` type sell, status final),
  their lines, payments and cash register rows. Business 2 (the dev login) is empty. Use read-only SELECTs on business 1 to learn
  the exact stored values (rounding, tax fields, status/payment_status, register rows, mapping rows) and to build golden tests:
  recompute `total_before_tax`, `tax_amount`, `final_total`, payment status of existing sales with your rules and report any mismatch.
- Permissions that exist (use exactly these): sell.view, sell.create, sell.update, sell.delete, sell.payments, direct_sell.access,
  view_own_sell_only, discount.access, access_shipping, edit_product_price_from_pos_screen, edit_product_discount_from_pos_screen,
  edit_product_price_from_sale_screen, edit_product_discount_from_sale_screen, list_drafts, list_quotations, print_invoice,
  view_cash_register, close_cash_register, register_report.view, access_default_selling_price, access_all_locations,
  location.<id>. (Laravel also has edit/delete payment checks inside TransactionPaymentController: read them.)

## Rules that matter most

1. **Money and quantities use `Prisma.Decimal`** end to end; round exactly like Laravel (read `Util::num_f`, `currency_precision`,
   `quantity_precision`). No floats in totals, tax, discounts, balances, stock.
2. **Everything that changes stock, payments, invoice counters or register rows happens in ONE interactive transaction**
   (`db.$transaction(async (tx) => ...)`; `tx` keeps tenant scoping and time zone conversion). Lock rows that can be raced:
   `SELECT ... FOR UPDATE` (raw, parameterised) on the `variation_location_details` rows and on the `invoice_schemes` row.
   Selling more than the available stock must be refused exactly where Laravel refuses it (`enable_stock`, business/pos settings).
   Raw queries return unsigned INT and COUNT as BigInt: wrap with `Number()`.
3. **Time**: `forTenant` converts DateTime values between real instants and the naive business-time-zone values Laravel stores.
   Always pass real `Date` instants (`new Date()`) and read them back as instants; format for display in `user.timeZone`
   (`AuthUser.timeZone`). Use `startOfDayInstant` / `startOfMonthInstant` from `common/time.ts` for day/month ranges. Date-only
   columns (e.g. `dob`) are not converted.
4. Soft delete / never hard-delete money rows: sales with payments are cancelled or deleted exactly as Laravel does
   (read `deleteSale`: it restores stock and mapping first). Audit: set `created_by`; Laravel's activity log is out of scope.
5. Customer balance and `payment_status` (paid | partial | due) must stay consistent with payments after every operation.
6. Write unit tests for every pricing, tax, discount, stock/mapping, payment-status and register rule (pure `*.rules.ts` + specs).
   Services contain orchestration only. Aim for the golden-data comparison described above.
7. API output: camelCase request DTOs, responses may return DB rows as-is plus computed fields. Pagination via `PageQueryDto`.
8. Web: follow CONVENTIONS (shared components, messages in `apps/web/messages/modules/<ns>.{en,si}.json`, `useCan`).
   POS-grade UX matters: keyboard friendly, fast, works on tablets, large touch targets.
9. Do not start servers, do not commit, do not write to the database from tests or scripts (read-only SELECTs only).
   Verification: `pnpm --filter @pos/api lint`, `pnpm --filter @pos/web lint`, and your own specs with `--runInBand`.

## Deliverable of every stream

Files created, endpoints and permissions, rules covered by tests, differences from Laravel, anything skipped, and any needed change in
shared files (you must not make it). Stream A also writes `docs/SALES-API.md` (request/response shapes for every endpoint, written
so that the web stream can build against it without reading the code).
