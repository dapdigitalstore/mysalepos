import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AbstractIntlMessages } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

type Messages = AbstractIntlMessages;

/**
 * Messages = messages/<locale>.json (core) + every messages/modules/<namespace>.<locale>.json.
 * Each module owns its own file, which becomes the namespace of the same name, so feature work
 * never touches a shared translation file.
 */
function loadMessages(locale: string): Messages {
  const root = join(process.cwd(), 'messages');
  const merged = JSON.parse(readFileSync(join(root, `${locale}.json`), 'utf8')) as Messages;
  const dir = join(root, 'modules');
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(`.${locale}.json`));
  } catch {
    // no module messages yet
  }
  for (const f of files) {
    const ns = f.slice(0, -`.${locale}.json`.length);
    merged[ns] = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Messages;
  }
  return merged;
}

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !routing.locales.includes(locale as (typeof routing.locales)[number])) {
    locale = routing.defaultLocale;
  }
  return { locale, messages: loadMessages(locale) };
});
