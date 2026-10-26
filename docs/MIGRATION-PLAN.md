# UltimatePOS (Laravel) → Next.js + NestJS සංක්‍රමණ සැලැස්ම

මූලාශ්‍රය: `../pos.dapdigitalit.com` (Laravel 9.52, PHP 8.2, UltimatePOS v6.8)
ඉලක්කය: `pos-next/` — **NestJS API + Next.js UI + Prisma + MariaDB**, සියලු අංග සහ සියලු මොඩියුල, භාවිතයට පහසුවන ලෙස.

තීරණ (පරිශීලකයා තහවුරු කළ): NestJS + Next.js; මුල් පද්ධතියේ සියලු අංග නොවෙනස්ව නැවත ලිවීම; Accounting, CRM, Essentials, Manufacturing, Repair, Superadmin, WooCommerce, Project, HMS ආදී සියලු මොඩියුල මොඩියුල ලෙසම.

## 1. මුල් පද්ධතියේ ප්‍රමාණය (මැනුවා)

| අංගය | ප්‍රමාණය |
|---|---|
| PHP කේතය (`app/`) | ~58,900 පේළි |
| Controllers / Models / Utils | 61 / 48 / 12 |
| Routes (`routes/web.php`) | ~325 |
| Blade views | 653 |
| Migrations / DB වගු | 298 / 123 |
| දත්ත | transactions 1,245 · sell lines 3,161 · products 117 · contacts 24 · businesses 21 |

**වැදගත්:** `modules_statuses.json` හි මොඩියුල 21ක් සක්‍රීය ලෙස ඇතත්, repo හි **Superadmin සහ Woocommerce හි කේතය පමණක්** ඇත. අනෙක් මොඩියුල (Accounting, CRM, Essentials, Manufacturing, Repair, Project, HMS ...) වල **වගු DB හි ඇත** (`crm_*`, `essentials_*`, `repair_*`, `gym_*` ...) නමුත් **කේතය ඇතුළත් නැත**. ඒවා දත්ත සමඟ ගැළපෙන ලෙස, වගු ව්‍යුහය සහ UltimatePOS හි ප්‍රසිද්ධ ක්‍රියාකාරිත්වය අනුව නැවත ගොඩනැගිය යුතුයි (මූලාශ්‍ර කේතය පිටපත් කිරීමක් නොවේ). එබැවින් එම මොඩියුල වල "නොවෙනස්" සමානතාව වගු/ක්ෂේත්‍ර මට්ටමින් පමණි; නිශ්චිත UI හැසිරීම් ඔබ සමඟ තහවුරු කර ගත යුතුයි.

## 2. ගෘහනිර්මාණය

```
pos-next/
├─ apps/api/        NestJS 10: REST + Swagger, JWT (access+refresh) + RBAC, class-validator
│  └─ src/
│     ├─ auth/ permissions/ prisma/ common/   (ගොඩනගා ඇත)
│     ├─ registry/  මොඩියුල manifest (core + add-on 21) → GET /api/modules
│     ├─ dashboard/
│     └─ modules/<id>/  එක් එක් මොඩියුලය (module/controller/service/dto) — අදියර අනුව
├─ apps/web/        Next.js 14 App Router, Tailwind, next-intl (en/si)
│  └─ src/app/[locale]/(dashboard)/m/<id>/   මොඩියුල පිටු
├─ packages/shared/ Zod schemas + shared types (අදියර 1 සිට)
└─ prisma/schema.prisma   ඇති DB එකෙන් `prisma db pull`
```

- **එකම MariaDB schema** (`prisma db pull`). `prisma migrate` / `db push` **කිසිදා** මෙම DB එකට එරෙහිව ධාවනය නොකරන්න. දත්ත migrate කිරීමක් නැත; Laravel සහ අලුත් පද්ධතිය සමාන්තරව ධාවනය කළ හැක.
- **Multi-tenant:** `PrismaService.forTenant(businessId)` — `business_id` ඇති සියලු වගු වලට ස්වයංක්‍රීයව පෙරහන (unit tested).
- **Auth:** Laravel `$2y$` bcrypt මුරපද එලෙසම ක්‍රියා කරයි. Spatie roles/permissions වගු කියවයි; `Admin#<business_id>` = business admin; `ADMINISTRATOR_USERNAMES` = Superadmin.
- **Module registry:** සෑම මොඩියුලයක්ම `registry/manifest.ts` හි එක් වරක් ප්‍රකාශ කෙරේ (නම en/si, අවසර, feature toggle, අදියර, විෂය පථය). Web sidebar එක ස්වයංක්‍රීයව ගොඩනැගේ; ඉදිකර නොමැති මොඩියුල "ඉක්මනින්" පිටුවක් පෙන්වයි.
- **Money:** Prisma `Decimal` / decimal string; float කිසිදා නැත. දිනයන් UTC ගබඩා, Asia/Colombo පෙන්වීම.
- **PDF/Print:** Puppeteer HTML→PDF + 80mm thermal print; Excel `exceljs`; barcode `bwip-js`.
- **භාවිතයට පහසුව (UX):** පළමු දින සිට: responsive, මුල්/සිංහල භාෂාව, loading/empty/error states, keyboard-friendly POS, සරල ප්‍රධාන මෙනුව, කෙටි මග (quick actions).

## 3. අදියර (Phases)

| අදියර | විෂය පථය | තත්ත්වය |
|---|---|---|
| 0 | Monorepo, `prisma db pull`, auth + RBAC, tenant scope, layout (sidebar, en/si), module registry, dashboard summary | **ගොඩනගා ඇත** |
| 1 | Master data: Products (variations, units, brands, categories, warranties, price groups), Contacts, Users/Roles, Business settings & locations | **ගොඩනගා ඇත** |
| 2 | **Sales & POS**: POS screen, add sale, drafts, quotations, payments, cash register, sell return, discounts, invoices/receipts | **ගොඩනගා ඇත** |
| 3 | Purchases (orders, requisitions, returns), Stock transfer/adjustment, opening stock, FIFO (`transaction_sell_lines_purchase_lines`) | |
| 4 | Expenses, Payment accounts, account book | |
| 5 | Reports + Dashboard widgets (profit/loss, stock, tax, register, ...), Excel/PDF | |
| 6 | Import (products/contacts/sales/opening stock), labels/barcodes, invoice layouts, notifications (email/SMS), backup | |
| 7 | **Essentials/HRM**, **CRM**, **Accounting** | |
| 8 | **Manufacturing**, **Repair**, **Project** | |
| 9 | **Superadmin** (SaaS), **WooCommerce**, **HMS**, Asset Management, Field Force, E-commerce, Product Catalogue, CMS, Connector (API), Spreadsheet, AI Assistance, Inbox Report, Custom Dashboard, Gym, ZATCA | |
| 10 | Parity testing, security hardening, load test, Docker + Nginx deploy, cut-over | |

සෑම අදියරකටම පසු: lint + build + tests, සාරාංශය, ඔබේ තහවුරු කිරීම, ඉන්පසු ඊළඟ අදියර.

## 4. Cut-over උපාය

1. එකම DB එක; **එකවර එක පද්ධතියකින් පමණක් ලියන්න** (module එකකට).
2. Module එකින් එක අලුත් පද්ධතියට හරවන්න (Nginx route).
3. සෑම module එකකටම parity test: එකම input සඳහා Laravel සහ NestJS එකම totals (බදු, discount, stock, balance) — `transactions` දත්ත වලින් golden cases.
4. DB backup + rollback සැලැස්ම.

## 5. අවදානම්

- **ව්‍යාපාර තර්කනය** (`TransactionUtil`, `ProductUtil`): වඩාත්ම අවදානම්. පළමුව tests ලියා Laravel ප්‍රතිඵල සමඟ සංසන්දනය.
- **කේතය නොමැති මොඩියුල** (§1): ඒවා උපකල්පන මත ගොඩනැගෙන බැවින් අදියර 7–9 ට පෙර ඔබ සමඟ අවශ්‍යතා තහවුරු කළ යුතුයි.
- **බලපත්‍රය:** UltimatePOS වාණිජ (CodeCanyon) නිෂ්පාදනයකි. තමන්ගේම භාවිතයට පමණද, විකිණීමටද යන්න බලපත්‍ර නියමයන් අනුව පරීක්ෂා කරන්න.
- **Live සර්වර් ආරක්ෂාව:** පැරණි live සර්වර් එකේ අනිෂ්ට ෆයිල් ඉවත් කර මුරපද/යතුරු මාරු කරන්න.
- **කාලය:** සම්පූර්ණ සමානතාවට මාස ගණනක් (අදියර 0 දැන් අවසන්; ඉතිරි අදියර 1–10).

## 6. අදියර 1 අවසන් (2026-10-27): දැන සිටිය යුතු දේ

- **ගොඩනගා ඇත:** Units, Brands, Categories, Tax rates + groups, Business locations, Business settings, Contacts + customer groups, Users, Roles + permission catalog, Commission agents, Products (single/variable/combo, price calculator, opening stock, duplicate, bulk actions), Variation templates, Warranties, Selling price groups. API tests 259, web + API build සාර්ථක.
- **Raw SQL හි BigInt:** `$queryRaw` මගින් unsigned INT සහ COUNT(*) BigInt ලෙස ලැබේ; Number() කරන්න (docs/CONVENTIONS.md).
- **Timestamp කලාපය:** Laravel DB හි timestamps ගබඩා වන්නේ APP_TIMEZONE (Asia/Kolkata) අනුව naive අගයන් ලෙසයි; Prisma ඒවා UTC ලෙස කියවයි. අදියර 2 (විකුණුම්, වාර්තා, මාසික පෙරහන්) ට පෙර business time zone අනුව ගැළපීමේ helper එකක් අවශ්‍යයි.
- **Product delete = hard delete** (products වගුවේ deleted_at නැත; Laravel ද එසේමයි). විකුණුමක් ඇත්නම් අවහිර වේ.
- **මඟ හැරි දේ:** product image/brochure upload, import, labels, stock history, Spatie activity log, Superadmin quota/subscription checks, selling price group Excel import.
- **PermissionsService** cache = තත්පර 30 (role වෙනස් කිරීම ක්‍රියාත්මක වීමට ඒ තරම් ගතවේ).

## 7. අදියර 2 අවසන් (2026-10-27)

- **ගොඩනගා ඇත:** Sales engine (POS, add sale, draft, quotation, proforma, suspended, credit sale; තොග FIFO; ඉන්වොයිස් අංක; ගෙවීම්), Cash register (විවෘත/වැසීම, විස්තර, වාර්තා), Sell return, POS තිරය (barcode, shortcuts, payment dialog, suspend), Add/Edit sale, විකුණුම් ලැයිස්තුව/විස්තර/ගෙවීම්, receipt (80mm) සහ A4 invoice මුද්‍රණය. API tests 491, web build සාර්ථක. docs/SALES-API.md බලන්න.
- **සත්‍යාපනය:** ව්‍යාපාර 4 හි සැබෑ විකුණුම් 1,099 න් 1,098ක් ගණනය හරියටම ගැළපේ (ඉන්වොයිස් 0754 පැරණි දත්ත දෝෂයක්). සැබෑ DB එකට එරෙහිව POS විකුණුම, ආංශික ගෙවීම, සංස්කරණය, ආපසු ලැබීම, quotation→invoice, තරග තත්ත්ව (race), register වසා තිබීම පරීක්ෂා කර ඇත; UI එකෙන් POS විකුණුමක් සම්පූර්ණ කර ඇත.
- **Timestamp:** forTenant දැන් DateTime අගයන් business time zone අනුව (Laravel හි naive අගයන්) පරිවර්තනය කරයි.
- **මඟ හැරි දේ:** contact pay-due ප්‍රවාහය, reward points UI, sales orders, recurring invoices, restaurant (tables/modifiers), serial numbers, සේවා වර්ග, ලාංඡනය මුද්‍රණය (file storage Phase 3 හි), QR/PDF (Phase 3).
- **අවසර:** edit_sell_payment, delete_sell_payment, access_sell_return, direct_sell.view/delete ආදිය permissions වගුවේ තවම නැත; role එකකට ලබා දුන් විට සෑදේ (Users මොඩියුලය), ඒ වන තුරු Admin ට පමණක් ක්‍රියා කරයි.
