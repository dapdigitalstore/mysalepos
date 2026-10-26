// Prisma cannot represent MySQL enums whose values are numbers (e.g. ENUM('12','24')): introspection
// emits an enum with every value commented out, which fails validation. This script rewrites such
// enums to plain String fields. It runs automatically after `pnpm db:pull`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'api', 'prisma', 'schema.prisma');
let schema = readFileSync(file, 'utf8');

const emptyEnums = [...schema.matchAll(/^enum (\w+) \{([^}]*)\}/gm)]
  .filter(([, , body]) => body.split('\n').every((l) => l.trim() === '' || l.trim().startsWith('//')))
  .map(([full, name]) => ({ full, name }));

for (const { full, name } of emptyEnums) {
  schema = schema.replace(full, '');
  schema = schema.replace(new RegExp(`(\\s)${name}(\\??)(\\s)`, 'g'), '$1String$2$3');
  console.log(`patched empty enum ${name} -> String`);
}
schema = schema.replace(/\n{3,}/g, '\n\n');
writeFileSync(file, schema);
