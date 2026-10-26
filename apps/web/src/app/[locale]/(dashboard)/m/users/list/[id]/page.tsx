import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { UserForm } from '../user-form';

export default function EditUserPage({ params: { locale, id } }: { params: { locale: string; id: string } }) {
  setRequestLocale(locale);
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId < 1) notFound();
  return <UserForm userId={userId} />;
}
