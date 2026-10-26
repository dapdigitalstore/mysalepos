# Conventions for building modules (read before writing code)

Reference implementation to copy: **Units** —
API `apps/api/src/modules/master/units/*`, web `apps/web/src/app/[locale]/(dashboard)/m/products/units/*`,
messages `apps/web/messages/modules/units.{en,si}.json`.

The spec is the original Laravel app at `D:\Users\dap\Desktop\pos.dapdigitalit.com\pos.dapdigitalit.com`
(`app/Http/Controllers`, `app/Utils`, `app/*.php` models, `resources/views`, `routes/web.php`).
Keep the same business rules, validations, permission names and DB columns. Do not change the database.

## API (NestJS, `apps/api/src/modules/<module>/`)

- Per feature folder: `<name>.dto.ts` (class-validator), `<name>.rules.ts` (pure business logic) + `<name>.rules.spec.ts`,
  `<name>.service.ts`, `<name>.controller.ts`. Register controllers/providers in your module file only
  (`products.module.ts`, `contacts.module.ts`, `users.module.ts`). **Do not edit `app.module.ts`, `registry/manifest.ts`,
  `prisma/schema.prisma` or anything under `common/`, `prisma/`, `auth/`** - if you need a change there, say so in your final report.
- Data access: always `this.prisma.forTenant(user.businessId)` (forces `business_id`). Use `this.prisma` directly only for tables
  without business_id, and then filter by the user's business through a parent record.
- Creates must pass `business_id: user.businessId` (typed unchecked input) and `created_by: user.id`. Prisma does not fill
  `created_at`/`updated_at`: set both explicitly (`new Date()`).
- Soft delete: tables with `deleted_at` -> set it, and filter `deleted_at: null` on every read. Never hard-delete money, contacts, products.
- Money/quantities: Prisma `Decimal` columns come back as decimal strings. Never use floating point for totals; use `Prisma.Decimal`
  (`new Prisma.Decimal(x).mul(y)`) in services and rules.
- **`$queryRaw` returns UNSIGNED INT columns and `COUNT(*)` as `BigInt`** (not number). Wrap them with `Number(...)` before comparing
  with Prisma ids, putting them in JSON responses (BigInt cannot be serialised) or doing arithmetic. Type raw rows as `bigint`.
- Lists: `PageQueryDto` + `paginated()` + `skipTake()` + `orderBy()` from `common/pagination.ts`; return `{ data, meta }`.
- Dropdowns: `GET /<resource>/options` returning `[{ id, label, ... }]`, open to any signed-in user.
- Permissions: `@RequirePermissions('x.view', 'x.create')` (any-of). Use the exact Laravel permission names (`permissions` table).
- Errors: throw Nest exceptions (`BadRequestException`, `NotFoundException`, `ConflictException`) with a clear English message.
- Validation lives in DTOs; business rules in `*.rules.ts` with unit tests (jest). Write tests for every pricing/stock/balance rule.
- TypeScript strict, no `any`. Files `kebab-case`. API JSON is camelCase for request DTOs; responses may return DB rows as-is.

## Web (Next.js, `apps/web/src/app/[locale]/(dashboard)/m/<module>/...`)

- `page.tsx` is a server component that calls `setRequestLocale(locale)` and renders a client `*-manager.tsx`.
- Client data: `api()` from `@/lib/client-api` (goes through `/api/proxy`), TanStack Query (`useQuery`/`useMutation`),
  `react-hook-form` + `zod`. Show loading, empty and error states on every screen.
- Use the shared components: `DataTable`, `PageHeader`, `Dialog`, `ConfirmDialog`, `SubNav`, `Field/Select/Textarea/Checkbox`,
  `Button/Input/Card`, `useToast`, `useCan`. Do not edit them; compose them. Currency display: `formatMoney()` from `@/lib/utils`.
- Hide controls the user may not use with `useCan()('perm.name')` (the API still enforces it).
- Each module owns `m/<module>/layout.tsx` with a `SubNav` of its sections (labels from its messages, hrefs locale-less like `/m/products/units`).
  The `products` module layout must include tabs for Units, Brands and Categories (pages built elsewhere).
- Texts: no hard-coded UI strings. Put them in `apps/web/messages/modules/<namespace>.en.json` and `<namespace>.si.json`
  (the file name is the next-intl namespace; both languages required, natural Sinhala). Never edit `messages/en.json`/`si.json`.
- Responsive (mobile first), keyboard accessible, labels on every input, `aria-label` on icon buttons.
- Design: teal primary, white cards, soft shadow (already in the shared components and tailwind config).

## Verify before reporting done

```bash
pnpm --filter @pos/api lint && pnpm --filter @pos/api test     # type-check + unit tests
pnpm --filter @pos/web lint                                    # type-check web
```

Do not start servers, do not run `prisma migrate`/`db push`/`db pull`, do not write to the database except through the API code
you are building (and never in tests). Do not commit. Final report: files created, endpoints, permissions used, rules covered by
tests, anything skipped or needing a shared-file change.
