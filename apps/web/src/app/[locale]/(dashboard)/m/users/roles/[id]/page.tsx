import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { RoleEditor } from '../role-editor';

export default function EditRolePage({ params: { locale, id } }: { params: { locale: string; id: string } }) {
  setRequestLocale(locale);
  const roleId = Number(id);
  if (!Number.isInteger(roleId) || roleId < 1) notFound();
  return <RoleEditor roleId={roleId} />;
}
