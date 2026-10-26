# pos-next

UltimatePOS (Laravel) පද්ධතියේ **NestJS + Next.js** නැවත ලිවීම. මුල් Laravel ව්‍යාපෘතිය (`../pos.dapdigitalit.com`) වෙනස් කර නැත.

- සැලැස්ම සහ අදියර: [docs/MIGRATION-PLAN.md](docs/MIGRATION-PLAN.md)
- තත්ත්වය: **අදියර 0, 1 සහ 2 අවසන්** (auth, RBAC, tenant scope, layout en/si, module registry; products, contacts, users/roles, settings, master data; sales, POS, cash register, sell return)

## ධාවනය (ලෝකල්)

පෙරවිධාන: Node 22, pnpm 9, WAMP MariaDB (`dapdigitalit_pos2026` import කර ඇති).

```bash
cp .env.example .env            # DATABASE_URL, JWT secrets, ADMINISTRATOR_USERNAMES සකසන්න
cp .env apps/api/.env
pnpm install
pnpm db:generate                # Prisma client
pnpm --filter @pos/api build && pnpm --filter @pos/api start     # API  :4400  (Swagger: /api/docs)
pnpm --filter @pos/web build && pnpm --filter @pos/web start     # Web  :3400
pnpm test                       # unit tests
```

`apps/web/.env.local` හි `API_URL=http://127.0.0.1:4400`.

## වැදගත් නීති

- **`prisma migrate` / `prisma db push` කිසිදා ධාවනය නොකරන්න** — මෙම DB එක Laravel සමඟ බෙදාගන්නා නිසා schema වෙනස් විය හැක. schema නැවත ගැනීමට `pnpm db:pull` (එය `scripts/patch-schema.mjs` ද ධාවනය කරයි: ඉලක්කම් අගයන් ඇති MySQL enum Prisma ට අවලංගු නිසා String බවට හරවයි).
- සියලු ව්‍යාපාර දත්ත ප්‍රවේශය `prisma.forTenant(businessId)` හරහා (business_id ස්වයංක්‍රීය පෙරහන).
- Money: decimal string / Prisma Decimal, float නැත.
- `.env` ෆයිල් commit නොකරන්න.

## ව්‍යුහය

```
apps/api/   NestJS (prisma/schema.prisma ඇතුළුව)
apps/web/   Next.js (messages/en.json, messages/si.json)
packages/shared/  (අදියර 1 සිට)
scripts/    patch-schema.mjs
docs/       MIGRATION-PLAN.md
```
