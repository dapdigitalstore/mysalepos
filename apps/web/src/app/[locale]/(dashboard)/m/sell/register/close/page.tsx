import { setRequestLocale } from 'next-intl/server';
import { CloseRegisterView } from '../close-register-view';

/** Close the signed-in user's open register. */
export default function CloseCurrentRegisterPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <CloseRegisterView />;
}
