import { setRequestLocale } from 'next-intl/server';
import { RoleEditor } from '../role-editor';

export default function NewRolePage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <RoleEditor />;
}
