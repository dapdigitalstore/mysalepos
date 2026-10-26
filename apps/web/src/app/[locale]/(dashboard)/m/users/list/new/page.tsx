import { setRequestLocale } from 'next-intl/server';
import { UserForm } from '../user-form';

export default function NewUserPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <UserForm />;
}
