import { setRequestLocale } from 'next-intl/server';
import { RegisterDetailsView } from '../register-details-view';

/** Details of the signed-in user's open register. */
export default function CurrentRegisterDetailsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <RegisterDetailsView />;
}
