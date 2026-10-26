# Sales API (Phase 2, stream A: sales engine)

Everything the POS screen, the Add/Edit sale screen, the sales list, drafts, quotations and the payment dialogs need.
Code: `apps/api/src/modules/sales/`. Spec: Laravel `SellPosController`, `SellController`, `TransactionPaymentController`,
`TransactionUtil`, `ProductUtil`. This document is written so the web screens can be built from it alone.

## 1. Conventions

* Base URL: `/api` (global prefix). The web app goes through its `/api/proxy`; paths below are written without `/api`.
* Auth: Bearer JWT of the signed-in user. A missing permission gives **403** `{"statusCode":403,"message":"You do not have permission to perform this action"}`.
* Request JSON is **camelCase**. Unknown properties are rejected (400) - send only the fields listed here.
* Money, quantities and percentages in a request may be a JSON number or a numeric string (`"12.50"`). Never send formatted text (`"1,200.00"`).
  In responses every money / quantity is a **decimal string** (`"1072.5"`, `"3"`); keep them as strings or use a decimal library, never `parseFloat` for totals.
* Dates in responses are ISO instants (`2026-10-25T12:57:15.000Z`); show them in the business time zone (`posSettings.business.timeZone`).
  Date filters (`startDate`, `endDate`) are **local calendar days** `YYYY-MM-DD` in the business time zone, both ends included.
* Errors: HTTP status + JSON. Validation errors: `{"statusCode":400,"message":["quantity must be a number", ...],"error":"Bad Request"}`.
  Business-rule errors: `{"message":"...", "code":"SOME_CODE"}` (status 400/409). Show `message`; branch on `code` (table in section 8).
* A sale is one `transactions` row (`type = 'sell'`). Drafts, quotations, proformas and suspended sales are the same row with different
  `status` / `subStatus` / `isSuspend`. Lines are `lines[]`, payments `payments[]`.
* Everything that changes stock, payments, invoice numbers or register rows runs in **one database transaction**; a refused sale leaves nothing behind.

## 2. Permissions

Names are exactly the Laravel `permissions` names. Admin and Superadmin pass everything. "any of" = the user needs at least one.

| Endpoint | Permission (any of) |
|---|---|
| `GET /sales/pos-settings` | `sell.create`, `direct_sell.access`, `sell.update`, `sell.view` |
| `GET /sales/product-row` | `sell.create`, `direct_sell.access`, `sell.update` |
| `GET /sales/recent` | `sell.create`, `direct_sell.access` |
| `GET /sales/check-invoice-no` | `sell.create`, `direct_sell.access`, `sell.update` |
| `GET /sales/drafts` | `list_drafts` |
| `GET /sales/quotations` | `list_quotations` |
| `GET /sales` | `sell.view`, `sell.create`, `direct_sell.access`, `direct_sell.view`, `view_own_sell_only`, `view_commission_agent_sell`, `access_shipping`, `access_own_shipping` |
| `POST /sales` | `sell.create`, `direct_sell.access` |
| `GET /sales/:id` | `sell.view`, `sell.create`, `direct_sell.access`, `direct_sell.view`, `view_own_sell_only`, `list_drafts`, `list_quotations` |
| `PUT /sales/:id` | `sell.update`, `direct_sell.access` |
| `DELETE /sales/:id` | `sell.delete`, `direct_sell.delete` |
| `POST /sales/:id/convert-to-invoice`, `/convert-to-proforma` | `sell.create`, `direct_sell.access` |
| `POST /sales/:id/duplicate` | `sell.create` |
| `GET /sales/:id/payments`, `GET /sales/:id/payment-defaults`, `POST /sales/:id/payments` | `sell.payments` |
| `GET /sale-payments/:id` | `sell.payments`, `edit_sell_payment`, `delete_sell_payment` |
| `PUT /sale-payments/:id` | `edit_sell_payment` |
| `DELETE /sale-payments/:id` | `delete_sell_payment` |

Rules enforced **inside** the endpoints (Laravel only hides these controls; the API refuses them, 403):

| Rule | Permission |
|---|---|
| Invoice discount (`discountAmount` > 0) | `discount.access` |
| Any shipping field (`shippingCharges`, `shippingDetails`, `shippingAddress`, `shippingStatus`, `deliveredTo`, `deliveryPerson`) | `access_shipping` |
| Changing a line's `unitPrice` away from the catalogue price (after selling price group + customer group) | POS screen: `edit_product_price_from_pos_screen`; Add sale screen (`isDirectSale: true`): `edit_product_price_from_sale_screen` |
| A line discount | POS: `edit_product_discount_from_pos_screen`; Add sale: `edit_product_discount_from_sale_screen` |
| Selling from a location | `access_all_locations` or `location.<id>` |
| Sale list/detail scoping | `view_own_sell_only` (own sales only; ignored when the user also has `direct_sell.view`), `view_commission_agent_sell` (also sales where the user is the commission agent), `location.<id>` |
| Sales list restricted to some payment statuses (non-admin) | `view_paid_sells_only`, `view_due_sells_only`, `view_partial_sells_only`, `view_overdue_sells_only` (as Laravel) |

When *editing* a sale, a discount/price/shipping value that is **unchanged** from what is stored is always accepted, so a cashier can re-save an old sale.
`edit_sell_payment` and `delete_sell_payment` exist in Laravel code but are **not in this database's `permissions` table** yet: only Admin has them until they are added.

## 3. How to build each kind of sale (`POST /sales`)

`status` is one of `final`, `draft`, `quotation`, `proforma`. `quotation` = a draft with `subStatus: "quotation"`; `proforma` = a draft with `subStatus: "proforma"`.
`isDirectSale: false/omitted` = POS screen (needs an **open cash register**, writes register rows); `true` = Add sale screen (no register needed, no register rows).

| Sale | Send |
|---|---|
| POS sale paid now | `status:"final"`, `lines`, `payments` (what the customer handed over, one row per method), `changeReturn` (cash given back) |
| POS express checkout | same with a single `cash` payment of the total |
| POS sale on credit ("credit sale") | `status:"final"`, `isCreditSale:true` (any `payments` are ignored; the sale is `due`) |
| Suspend a POS sale | `status:"final"`, `isSuspend:true` (stock is taken, no payments, `paymentStatus:"due"`); later `PUT` with `isSuspend:false` and `payments` to finish it |
| POS draft | `status:"draft"` (no stock, no payments, no invoice-scheme number: a draft number such as `2026/0003`) |
| Quotation | `status:"quotation"` (stored as draft/quotation) |
| Add sale, final | `isDirectSale:true`, `status:"final"`; `payments` optional (then `paymentStatus` is `due`/`partial`/`paid`) |
| Add sale, draft / quotation / proforma | `isDirectSale:true`, `status:"draft" | "quotation" | "proforma"` |
| Sale with shipping | `shippingCharges`, `shippingDetails`, `shippingAddress`, `shippingStatus` (`ordered|packed|shipped|delivered|cancelled`), `deliveredTo`, `deliveryPerson` |

Request body (`SaleDto`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `status` | `final \| draft \| quotation \| proforma` | yes | |
| `isDirectSale` | boolean | no | default false (POS). Cannot be changed on update (the stored value is used). |
| `isSuspend` | boolean | no | |
| `isCreditSale` | boolean | no | payments are ignored |
| `locationId` | int | yes | cannot be changed on update |
| `contactId` | int | yes | the customer (walk-in customer id comes from `pos-settings.walkInCustomer`) |
| `transactionDate` | ISO date-time | no | default now; on update, omitted = unchanged |
| `invoiceSchemeId` | int \| null | no | only used for a final sale; default = the location's scheme |
| `invoiceNo` | string \| null | no | a custom number; must be unique (`409 INVOICE_NO_TAKEN`). Normally omit. |
| `sellingPriceGroupId` | int \| null | no | |
| `commissionAgentId` | int \| null | no | ignored when the business uses "logged in user" as agent (then the saving user) |
| `payTermNumber`, `payTermType` (`days \| months`) | | no | default = the customer's pay term |
| `lines` | `SaleLine[]` (1..500) | yes | see below |
| `discountType` (`fixed \| percentage`), `discountAmount` | | no | invoice discount |
| `taxRateId` | int \| null | no | order tax |
| `shippingCharges` | amount | no | |
| `shippingDetails`, `shippingAddress`, `shippingStatus`, `deliveredTo`, `deliveryPerson` | | no | |
| `shippingCustomFields` | string[] (max 5) | no | `shipping_custom_field_1..5` |
| `customFields` | string[] (max 4) | no | `custom_field_1..4` |
| `additionalExpenses` | `{key, value}[]` (max 4) | no | named extra charges added to the total |
| `typesOfServiceId`, `packingCharge`, `packingChargeType` (`fixed \| percent`) | | no | only when the *types of service* module is enabled |
| `resTableId`, `resWaiterId`, `isKitchenOrder` | | no | only stored when the tables / service staff / kitchen modules are enabled |
| `saleNote` | string | no | printed on the invoice (`additional_notes`) |
| `staffNote` | string | no | internal |
| `exchangeRate` | amount | no | 0/omitted = 1 |
| `rpRedeemed`, `rpRedeemedAmount` | int, amount | no | reward points the customer spends (business must have reward points on) |
| `payments` | `SalePayment[]` (max 30) | no | see section 5 |
| `changeReturn` | amount | no | change handed back (stored as a payment with `isReturn: true`) |
| `changeReturnPaymentId` | int | no | on update: the existing change payment to edit |
| `changeReturnMethod` | string | no | default `cash` |
| `changeReturnAccountId` | int | no | |

`SaleLine`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | int | update only | existing line (`lines[].id` from the detail). Omit for a new line. |
| `productId`, `variationId` | int | yes | |
| `quantity` | amount > 0 | yes | **in the unit you chose** (`subUnitId`); whole numbers only when the unit does not allow decimals |
| `unitPrice` | amount >= 0 | yes | price **excluding tax, before the line discount**, per chosen unit. Start from `product-row.unitPrice` |
| `lineDiscountType` (`fixed \| percentage`), `lineDiscountAmount` | | no | `fixed` is per unit |
| `taxId` | int \| null | no | the line tax. Ignored when `enableInlineTax` is false |
| `subUnitId` | int \| null | no | a sub-unit of the product's unit (`product-row.subUnits`) |
| `sellLineNote` | string | no | |
| `lotNoLineId` | int \| null | no | `purchase_lines.id` to sell from (lot/expiry businesses; `product-row.lots`) |
| `secondaryUnitQuantity`, `resServiceStaffId` | | no | |

Do **not** send combo component lines; the server creates them from the combo product.

### 3.1 Totals: what the server computes (use this for the live preview)

The server **ignores any total sent by the client** and computes everything with the formulas below (Laravel's `pos.js` + `calculateInvoiceTotal`).
`cp` = `business.currencyPrecision`. "round" = round half up. Use a decimal library.

```
per line:
  discounted     = discountType == 'fixed'      ? unitPrice - discountAmount
                 : discountType == 'percentage' ? unitPrice * (100 - discountAmount) / 100
                 : unitPrice
  unitPriceIncTax = round(discounted + discounted * lineTaxRate / 100, cp)
  itemTax         = round(unitPriceIncTax_unrounded - discounted, cp)
  lineTotal       = quantity * unitPriceIncTax

invoice:
  totalBeforeTax = sum(lineTotal)                       // already contains line taxes
  discount       = discountType == 'fixed' ? discountAmount
                 : discountType == 'percentage' ? discountAmount / 100 * totalBeforeTax : 0
  rp             = rpRedeemedAmount                      // reward points value, 0 normally
  tax            = orderTaxRate / 100 * (totalBeforeTax - discount - rp)
  packing        = packingChargeType == 'fixed' ? packingCharge
                 : packingChargeType == 'percent' ? packingCharge / 100 * totalBeforeTax : 0
  payable        = totalBeforeTax + tax - discount - rp + shippingCharges + packing + sum(additionalExpenses.value)
  rounded        = posSettings.amount_rounding_method (e.g. "0.05", "1") ? payable rounded to the nearest multiple : payable
  roundOff       = rounded - payable
  finalTotal     = round(rounded, cp)
```

Rates (`lineTaxRate`, `orderTaxRate`) are `taxRates[].rate` (percent) from `pos-settings`. Stored: `total_before_tax` = `totalBeforeTax`,
`tax_amount` = order tax only, `discount_amount` = the amount you sent (a percent for `percentage`), `final_total` = `finalTotal`.
With a sub-unit the server stores quantity and prices per base unit (`quantity x multiplier`, price / multiplier); the detail endpoint converts back.

### 3.2 Payment status

`totalPaid = sum(payments) - sum(change given back)`. `paymentStatus = paid` when `finalTotal <= totalPaid` (also for a 0 total), `partial` when `0 < totalPaid < finalTotal`, else `due`.
Drafts/quotations have `paymentStatus: null` and take no payments. Lists show `displayPaymentStatus`, which turns `due`/`partial` into `overdue`/`partial-overdue` after the pay term.

### 3.3 Example: POS sale

```json
POST /sales
{
  "status": "final",
  "locationId": 4,
  "contactId": 6,
  "taxRateId": 1,
  "discountType": "percentage", "discountAmount": 25,
  "lines": [
    { "productId": 52, "variationId": 52, "quantity": 2, "unitPrice": 1700 },
    { "productId": 12, "variationId": 12, "quantity": 1, "unitPrice": 1250, "lineDiscountType": "fixed", "lineDiscountAmount": 50 }
  ],
  "payments": [ { "method": "cash", "amount": 5000 } ],
  "changeReturn": 1205
}
```
Computation: lines 2 x 1700 = 3400 and 1 x (1250 - 50) = 1200, so `totalBeforeTax` 4600; 25% discount = 1150; tax 10% of (4600 - 1150) = 345;
`finalTotal` = 4600 + 345 - 1150 = 3795. The customer hands over 5000, so the UI sends `changeReturn = max(0, tendered - finalTotal)` = 1205 and the sale is `paid`.
Response: the full sale detail (section 4.9) with `invoiceNo` and `paymentStatus`.

## 4. Endpoints

### 4.1 `GET /sales/pos-settings?locationId=`

Loads everything a sale screen needs at start. Response (abridged):

```
{
  business: { id, name, timeZone, currency:{symbol,code,thousandSeparator,decimalSeparator}, currencySymbolPlacement, currencyPrecision, quantityPrecision,
              sellPriceTax, enableInlineTax, itemAdditionMethod, enableSubUnits, enableLotNumber, enableProductExpiry, onProductExpiry, stopSellingBefore,
              accountingMethod, salesCmsnAgnt, defaultSalesTaxId, defaultSalesDiscount, transactionEditDays, enabledModules[], dateFormat, timeFormat,
              rewardPoints:{ enabled, name, amountForUnitRp, minOrderTotalForRp, maxRpPerOrder, redeemAmountPerUnitRp, minOrderTotalForRedeem, minRedeemPoint, maxRedeemPoint } },
  posSettings: { ...Laravel business.pos_settings keys (disable_pay_checkout, disable_draft, disable_express_checkout, hide_product_suggestion, hide_recent_trans,
                 disable_discount, disable_order_tax, is_pos_subtotal_editable, enable_transaction_date, enable_weighing_scale, amount_rounding_method, ...),
                 allow_overselling: boolean },
  keyboardShortcuts: object | null,
  permissions: { canSell, canDirectSell, canUpdate, canDelete, canTakePayments, canDiscount, canShip, canPrint, canListDrafts, canListQuotations,
                 canViewRegister, canCloseRegister, canEditPrice:{pos,direct}, canEditLineDiscount:{pos,direct}, canSeeDefaultSellingPrice },
  locations: [{ id, name, invoiceSchemeId, saleInvoiceSchemeId, sellingPriceGroupId, printReceiptOnInvoice, receiptPrinterType,
                paymentMethods:[{key,label,accountId}] }],      // only locations the user may use
  defaultLocationId,
  paymentMethods: [{key,label}],                                // all methods incl. custom_pay_1..7 with the business' custom labels; also "advance" (customer advance balance) is a valid method
  taxRates: [{id,name,rate,isTaxGroup}],                       // rate = percent as string
  sellingPriceGroups: [{id,name}], invoiceSchemes: [{id,name,isDefault}],
  walkInCustomer: {id,name,mobile,creditLimit} | null,
  accounts: [{id,name}],                                        // when the account module is on
  commissionAgents: [{id,name}],                                // when business.salesCmsnAgnt is 'user' or 'cmsn_agnt'
  shippingStatuses: ["ordered","packed","shipped","delivered","cancelled"],
  cashRegister: { known: boolean, open: boolean, registerId: number | null }   // known=false until the register module is live
}
```
Use `posSettings.disable_*` to hide POS controls. `posSettings.is_pos_subtotal_editable`: when on, the cashier edits the line total and the **quantity** becomes `lineTotal / unitPriceIncTax`.

### 4.2 `GET /sales/product-row?variationId=&locationId=&contactId=&priceGroupId=&quantity=&isDraft=&isDirectSale=`

Defaults for adding a variation (found with `GET /products/search`) to a sale. `isDraft=true` skips the stock check. Response:

```
{ productId, variationId, productName, variationName|null, label, sku, subSku, productType, enableStock,
  qtyAvailable: "933" | null,            // base unit, at the location (combos: how many combos the components allow)
  unit:{id,shortName,allowDecimal}, subUnits:[{id,name,multiplier,allowDecimal}],
  taxId|null, taxRate,                   // taxId is null when the business has inline tax off
  unitPrice,                             // excl. tax: selling price group price, else catalogue price, moved by the customer group percentage
  sellPriceIncTax, quantity, lineDiscountType:"fixed", lineDiscountAmount:"0",
  unitPriceIncTax, itemTax, lineTotal,   // the line maths already applied (section 3.1)
  customerGroupId, appliedPriceGroupId,
  components:[{productId,variationId,name,enableStock,quantityRequired}],   // combo products
  lots:[{purchaseLineId,lotNumber,expDate,qtyAvailable}],                   // lot / expiry businesses
  warrantyId, canEditPrice, canEditDiscount }
```
Errors: `400 OUT_OF_STOCK` when overselling is off, the product tracks stock and none is available (not for drafts). Quantity above `qtyAvailable` is allowed only when `posSettings.allow_overselling`.
When the sub-unit changes, recompute the line: `unitPrice x multiplier`, `quantity / multiplier`.

### 4.3 `GET /sales/recent?status=final|draft|quotation&limit=10`

The user's own latest POS records (`is_direct_sale = 0`). Array of `{id, invoiceNo, transactionDate, status, subStatus, paymentStatus, isSuspend, finalTotal, contactId, contactName, resTableId}`.

### 4.4 `GET /sales` (final sales, includes suspended)

Query: `page`, `perPage` (max 100), `search` (invoice no, customer name, business name, mobile, contact id), `sortBy`, `sortDir`, `locationId`, `contactId`,
`paymentStatus` (`paid|due|partial|overdue`), `status` (`final`), `shippingStatus`, `createdBy`, `commissionAgentId`, `startDate`, `endDate` (local days),
`paymentMethod`, `isDirectSale` (true = Add sale only, false = POS only), `isSuspend` (true = only suspended: the POS "suspended sales" list), `typesOfServiceId`, `resWaiterId`, `onlyShipments`.
`sortBy`: `transaction_date` (default, newest first when no sortBy), `invoice_no`, `customer`, `mobile`, `location`, `payment_status`, `final_total`, `total_paid`, `total_remaining`, `shipping_status`, `added_by`, `total_items`, `id`.

```
{ data: [{ id, invoiceNo, transactionDate, status, subStatus, paymentStatus, displayPaymentStatus, finalTotal, totalBeforeTax, taxAmount, discountType, discountAmount,
           shippingStatus, shippingCharges, isDirectSale, isSuspend, locationId, locationName, contactId, contactName, supplierBusinessName, contactMobile, contactCode,
           createdBy, addedBy, commissionAgent, typesOfServiceId, resTableId, rpEarned, rpRedeemed, saleNote, staffNote,
           totalPaid, totalRemaining, totalItems, hasReturn, returnTotal, returnDue }],
  meta: { page, perPage, total, totalPages, totals: { finalTotal, totalPaid, totalRemaining } } }   // totals over the WHOLE filtered set, not just the page
```

### 4.5 `GET /sales/drafts`, `GET /sales/quotations`

Same row shape (no `totals`). Query: `page, perPage, search, sortBy, sortDir, locationId, contactId, createdBy, startDate, endDate`.
`/drafts` returns every draft (quotations and proformas included; use `subStatus` to tell them apart), `/quotations` only `subStatus = quotation`.

### 4.6 `GET /sales/check-invoice-no?invoiceNo=&excludeId=` -> `{ "available": true }`

### 4.7 `POST /sales` -> **201**, body = sale detail (4.9). Request: `SaleDto` (section 3).

Order of effects (all-or-nothing): validate and price the lines on the server -> credit limit -> open register (POS) -> lock stock rows and the invoice scheme row ->
invoice number -> header + lines (+ combo components) -> payments -> stock decrease -> register rows -> payment status -> reward points -> FIFO purchase mapping.
Final sales that cannot be covered by purchases fail with `PURCHASE_SELL_MISMATCH` unless `posSettings.allow_overselling`.

### 4.8 `PUT /sales/:id` -> body = sale detail. Request: `SaleDto` (the **whole** sale; it replaces the stored one).

* Allowed transitions: draft -> final (new invoice-scheme number, stock taken), final -> draft (new draft number, stock and FIFO mapping released, register told), final -> final, draft -> draft.
* Lines: send **all** lines. A line with `id` is edited; a line without `id` is added; stored lines not listed are removed (stock and mapping come back).
  Quantity changes adjust stock and the FIFO mapping by the difference only. The product of an existing line cannot change. Combo component lines are rebuilt (their ids change).
* `locationId` and `isDirectSale` cannot change. `transactionDate` omitted = unchanged.
* **Payments**: if `payments` is present it **replaces** the payment list: rows with `id` are edited, rows without are added, existing payments not listed are **deleted**
  (advance payments cannot be edited, `ADVANCE_PAYMENT_LOCKED`). If `payments` is absent (and no `changeReturn`) payments are untouched. Not applied to suspended or credit sales.
  On the Add sale screen the user needs `sell.payments` for payments to be applied; otherwise they are silently skipped (as Laravel).
* Refused: a sale that has a return (`RETURN_EXISTS`), a sale older than `business.transactionEditDays` (`EDIT_NOT_ALLOWED`), no open register on a POS sale (`REGISTER_NOT_OPEN`).
* Loading a sale into the edit form from the detail: lines -> `id, productId, variationId, quantity, unitPriceBeforeDiscount as unitPrice, lineDiscountType, lineDiscountAmount, taxId, subUnitId, sellLineNote, lotNoLineId`
  (skip lines with `parentSellLineId != null`); `totals.orderTaxId` -> `taxRateId`; `totals.discountType/discountAmount`; `shipping.*`; `additionalExpenses`; `saleNote`; `staffNote`;
  `payments` (with `id`; the one with `isReturn: true` becomes `changeReturn` + `changeReturnPaymentId`).

### 4.9 `GET /sales/:id` (sale detail; also the response of create / update / convert / duplicate)

```
{ id, invoiceNo, type, status, subStatus, isQuotation, isDirectSale, isSuspend, paymentStatus, displayPaymentStatus, transactionDate,
  locationId, location:{id,name}, contactId, customer:{ id,name,supplierBusinessName,mobile,contactCode,email,addressLine1,city,isDefault,balance,totalRp,creditLimit } | null,
  customerGroupId, sellingPriceGroupId, commissionAgentId, createdBy, addedBy, payTermNumber, payTermType,
  lines: [{ id, parentSellLineId, childrenType:"" | "combo", productId, variationId, productName, variationName, productType, sku, subSku, label, enableStock,
            unit:{id,shortName,allowDecimal}, subUnitId, subUnitName, subUnits:[{id,name,multiplier,allowDecimal}], multiplier,
            quantity, baseQuantity,                                  // quantity is in the unit sold; baseQuantity in the product unit
            unitPriceBeforeDiscount, unitPrice, lineDiscountType, lineDiscountAmount, taxId, taxRate, itemTax, unitPriceIncTax, lineTotal,   // all in the unit sold
            sellLineNote, lotNoLineId, secondaryUnitQuantity, quantityReturned, resServiceStaffId, qtyAvailable }],
  payments: [{ id, method, amount, isReturn, paidOn, paymentRefNo, note, cardTransactionNumber, cardNumber, cardType, cardHolderName, cardMonth, cardYear,
               chequeNumber, bankAccountNumber, transactionNo, accountId }],
  totals: { subTotal, totalBeforeTax, discountType, discountAmount, discountValue, rpRedeemed, rpRedeemedAmount, orderTaxId, orderTaxName, orderTaxRate, taxAmount,
            shippingCharges, packingCharge, packingChargeType, additionalExpenses:[{key,value}], roundOffAmount, finalTotal, totalPaid, totalDue, rpEarned },
  shipping: { details, address, status, deliveredTo, deliveryPerson, customFields[5] },
  saleNote, staffNote, customFields[4], exchangeRate, typesOfServiceId, resTableId, resWaiterId, isKitchenOrder,
  returns: [{ id, invoiceNo, finalTotal, transactionDate }] }
```
`404` when the sale is not in the user's business, not in a permitted location, or (view-own-only users) not theirs.

### 4.10 `DELETE /sales/:id` -> `{ "success": true }`

Laravel `deleteSale`. Draft: removed. Final: stock restored, FIFO mapping released, reward points reversed, register rows and payments removed
(advance payments return to the customer's advance balance, account ledger rows are soft-deleted), then the sale and its lines are **deleted for good**
(`transactions` has no soft-delete column; Laravel does the same). Refused when a sell return exists (`RETURN_EXISTS`).

### 4.11 `POST /sales/:id/convert-to-invoice` -> sale detail

Draft/quotation -> final: new invoice-scheme number, `transactionDate` = now, `subStatus` null, stock taken, FIFO mapping, payment status `due`. Credit limit and open register (POS sale) are checked. `404` when the sale is not a draft.

### 4.12 `POST /sales/:id/convert-to-proforma` -> sale detail (`subStatus: "proforma"`; drafts/quotations only)

### 4.13 `POST /sales/:id/duplicate` -> **201**, sale detail of the new draft

Copies header and lines into a new draft (draft number, date now, current user, no payments, stock untouched).

## 5. Payments

`SalePayment` (inside a sale) and `PaymentDto` (standalone) share these fields:

| Field | Type | Notes |
|---|---|---|
| `id` | int | only inside `PUT /sales/:id`: the existing payment to edit |
| `method` | string | `cash`, `card`, `cheque`, `bank_transfer`, `other`, `custom_pay_1`..`custom_pay_7`, `advance` |
| `amount` | amount | `0` rows are dropped (new rows); negative is refused |
| `paidOn` | ISO date-time | default now |
| `note` | string | |
| `cardTransactionNumber`, `cardNumber`, `cardType`, `cardHolderName`, `cardMonth`, `cardYear`, `cardSecurity` | string | for `card` |
| `chequeNumber` | string | for `cheque` |
| `bankAccountNumber` | string | for `bank_transfer` |
| `transactionNo` | string | the reference of `custom_pay_N` |
| `accountId` | int | the account the money goes to (account module); ignored for `advance` |

* When a payment is **edited** (inside `PUT /sales/:id` or `PUT /sale-payments/:id`), `method` and `amount` are always applied; the optional detail fields (`note`, card, cheque, bank, `transactionNo`, `accountId`, `paidOn`) stay as stored when omitted and are cleared when sent as `null` or `""`.
* Each new payment gets a number `payment_ref_no` from the `sell_payment` counter (e.g. `SP2026/1115`).
* `advance` spends the customer's advance balance (`customer.balance`); more than the balance gives `ADVANCE_BALANCE_NOT_AVAILABLE`. Deleting an advance payment gives the money back.
* A payment that names `accountId` creates an `account_transactions` row (credit; change given back is a debit) when the account module is on.
* Change given back is a payment with `isReturn: true`; it is subtracted from the paid total.

### `GET /sales/:id/payments` -> `{ saleId, finalTotal, totalPaid, due, paymentStatus, payments:[...] }`
### `GET /sales/:id/payment-defaults` -> `{ saleId, invoiceNo, status:"due"|"closed", finalTotal, totalPaid, amount (the due), method:"cash", paidOn }`
### `POST /sales/:id/payments` (`PaymentDto`) -> 201, same body as `GET /sales/:id/payments`

Only for **final** sales that still have a balance. `400 ALREADY_PAID` when nothing is due, `400 PAYMENT_EXCEEDS_DUE` when `amount` is more than the due amount (Laravel enforces the same limit in its dialog).
Payment status is recalculated. No register row is written (as in Laravel, only the POS screen writes register rows).

### `GET /sale-payments/:id` -> payment + `sale:{id,invoiceNo,finalTotal}`
### `PUT /sale-payments/:id` (`PaymentDto`) -> payments body. `advance` payments cannot be edited (`ADVANCE_PAYMENT_LOCKED`).
### `DELETE /sale-payments/:id` -> payments body (after deletion; status recalculated)

The contact "pay due" flow (`payContactDue`, one payment spread over invoices) is **not** implemented here.

## 6. Stock, FIFO and numbering rules (for reference)

* A sale holds stock only while `status = final`. `variation_location_details.qty_available` goes down by the base-unit quantity of every line of a product with `enableStock`
  (combo component lines included; the combo parent only if it tracks stock itself). Rows are locked `FOR UPDATE` first, ordered by id (no deadlocks).
  A location that never had the product gets a stock row created (can go negative when overselling is allowed).
* FIFO: for each stock-tracked final line the server maps the quantity to `purchase_lines` of received purchases / opening stock / transfers at that location, oldest first
  (`accountingMethod = lifo`: newest first), writing `transaction_sell_lines_purchase_lines` and `purchase_lines.quantity_sold`. `lotNoLineId` restricts to one purchase line.
  When `stop_selling` expiry is on, purchase lines expiring within `stopSellingBefore` days are skipped.
  Uncovered quantity: refused (`PURCHASE_SELL_MISMATCH`) unless `allow_overselling`, then mapped to purchase line 0 and later settled by a purchase.
  Editing releases or adds only the difference (newest mapping rows are released first). Verified invariant on the real data: every final stock line is mapped for exactly its quantity.
* Invoice numbers: final = the invoice scheme (`blank`: prefix + zero-padded counter; `year`: prefix + `YYYY-` + counter; counter = `start_number + invoice_count`, `invoice_count` incremented under `FOR UPDATE`);
  draft / quotation / proforma = the business `draft` counter (`2026/0003`, prefix from `ref_no_prefixes.draft`).
* Customer credit limit: for a final sale, `open invoices total - paid + this sale's due` must not exceed `contact.creditLimit` (`null` = unlimited, `0` = no credit). Drafts are not checked.
* Reward points (when enabled): a final sale earns `floor(finalTotal / amountForUnitRp)` (min order total, max per order apply); redeemed points are spent; the walk-in customer never collects points.
  Edits and deletes adjust the customer's balance by the difference.

## 7. Notes for the screens

* Always send `unitPrice` excluding tax and let the server add tax. If `enableInlineTax` is false do not send `taxId` on lines.
* After any create/update, replace local state with the response (`totals.finalTotal` is authoritative, e.g. after rounding).
* POS flow: `pos-settings` -> pick location -> `GET /products/search?locationId=...&checkQty=...` -> `product-row` per added item -> `POST /sales`. Show `REGISTER_NOT_OPEN` as "open a register" (link to the register screen).
* Suspend list = `GET /sales?isSuspend=true&isDirectSale=false`; resume = `GET /sales/:id` -> edit form -> `PUT` with `isSuspend:false` and `payments`.
* Recent transactions panel = `GET /sales/recent?status=final|draft|quotation`.
* Disable the buttons the user cannot use with `pos-settings.permissions`; the API enforces the same rules.

## 8. Error codes

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `REGISTER_NOT_OPEN` | POS sale without an open cash register |
| 400 | `CREDIT_LIMIT_EXCEEDED` | the customer's credit limit would be exceeded |
| 400 | `PURCHASE_SELL_MISMATCH` | not enough stock (purchases) for a line and overselling is off |
| 400 | `ADVANCE_BALANCE_NOT_AVAILABLE` | advance payment above the customer's advance balance |
| 400 | `RETURN_EXISTS` | the sale has a sell return: it cannot be edited or deleted |
| 400 | `EDIT_NOT_ALLOWED` | older than `transactionEditDays` |
| 400 | `OUT_OF_STOCK` | `product-row` for a product with no stock |
| 400 | `ALREADY_PAID`, `PAYMENT_EXCEEDS_DUE` | add payment |
| 400 | `ADVANCE_PAYMENT_LOCKED` | edit of an advance payment |
| 400 | `NO_INVOICE_SCHEME` | the business has no usable invoice scheme |
| 409 | `INVOICE_NO_TAKEN` | custom `invoiceNo` already used |
| 400 | (message only) | `Quantity must be greater than 0`, `Customer not found`, `Business location not found`, `... quantity must be a whole number for unit ...`, `Unit ... cannot be used for ...`, `The sale total cannot be negative`, `The location of a sale cannot be changed`, `Sell line N does not belong to this sale`, ... |
| 403 | (message only) | `You cannot change the price of ...`, `You cannot give a discount`, `You cannot add shipping details`, `You cannot sell from this location` |
| 404 | | sale / payment / product not found |

## 9. Golden data check (real sales of the local database)

`node src/modules/sales/golden/golden-check.cjs` (run from `apps/api`; read-only SELECTs) recomputes every stored `sell` transaction with the production rules.
Result on the local database (1,099 sell transactions in businesses 1 and 4, 3,189 lines, 1,101 payments):

| Field | Match |
|---|---|
| line `unit_price` | 3189 / 3189 (100%) |
| line `unit_price_inc_tax` | 3189 / 3189 (100%) |
| line `item_tax` | 3189 / 3189 (100%) |
| `total_before_tax` | 1099 / 1099 (100%) |
| `tax_amount` | 1099 / 1099 (100%) |
| `final_total` (parts + stored `round_off_amount`) | 1098 / 1099 (99.91%) |
| `payment_status` (final sales) | 1097 / 1097 (100%) |

The single mismatch is sale **896**: Laravel stored `final_total 4180` while its own parts give 3600 + 360 tax = 3960 (it was paid 4180). Laravel trusts the browser's total, so such
stored values exist; the API computes the total itself and cannot produce them. Data covered: order tax 10%, 25% invoice discounts, change given back (5 payments), drafts.
Not covered by real data (no examples stored): line tax, line discounts, sub-units, combos, shipping, additional expenses, round-off, reward points: these are covered by unit tests with hand-checked values.
Further invariants verified read-only on the real data: all 3,184 final stock-tracked lines are mapped to purchases for exactly their quantity, and all 116 `variation_location_details` rows equal the remaining quantity of their purchase lines.

## 10. Differences from Laravel (deliberate)

1. **Server-side maths.** Laravel stores `final_total`, `unit_price_inc_tax`, `item_tax` posted by the browser. The API recomputes them from price, quantity, discount and tax ids (same formulas, section 3.1) and ignores any client total.
2. **Permissions enforced on the server** (discount, shipping, price/discount editing, location). Laravel only hides the controls. Unchanged stored values are accepted on edit.
3. **Mapping bugs not copied.** Laravel's `mapDecrementPurchaseQuantity` credits a purchase line with the whole remaining decrement when it deletes a row, and `adjustMappingPurchaseSell` unions arrays so deleted-line mappings can be lost, and processes multi-row mappings twice. The API releases exactly the quantity taken from each row, once per line.
4. **Sub-unit stock on update.** Laravel decreases stock on draft->final updates without the sub-unit multiplier. The API always uses base-unit quantities.
5. **Combo components** are rebuilt on every update (ids change); Laravel keeps and reprices them.
6. **Drafts keep `paymentStatus: null`** after edits (Laravel stores `due` after an edit).
7. **Delete = Laravel delete.** The sale row is removed (no soft delete exists on `transactions`); stock/mapping/register/payments are reversed first.
8. **Add payment** refuses an amount above the due amount and payments on non-final sales (Laravel only limits it in the dialog).
9. **Reward points redeemed:** the order tax is computed after subtracting the redeemed amount and stored consistently (Laravel stores a tax that ignores it).
10. **Editing is refused** after a return exists and after `transactionEditDays` for every status (Laravel checks both only when opening the edit screen).
11. `convertToInvoice` decreases each component line once (Laravel's extra combo decrease uses the parent product id and is not reproduced). Region-specific modules (ZATCA, Woocommerce, repair, restaurant modifiers) are not implemented.

## 11. Not implemented (report)

* Sales orders (`sales_order` type), recurring invoices / subscriptions, modifiers (restaurant), warranties on lines, serial numbers, automatic `discounts` (price rules), weighing scale barcodes.
* Documents/media upload, cash denominations on payments, activity log, notifications (SMS/email/WhatsApp), invoice printing/receipts (a separate stream).
* Contact "pay due" (`payContactDue`) and opening-balance payments.
* `edit_pos_payment` (payment-only edit of a POS sale): use `PUT /sale-payments/:id` instead.
