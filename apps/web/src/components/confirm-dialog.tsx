'use client';

import { useTranslations } from 'next-intl';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  busy?: boolean;
  title?: string;
  body?: string;
}

export function ConfirmDialog({ open, onClose, onConfirm, busy, title, body }: Props) {
  const t = useTranslations('common');
  return (
    <Dialog open={open} onClose={onClose} title={title ?? t('confirmDeleteTitle')} className="max-w-sm">
      <p className="text-sm text-slate-600">{body ?? t('confirmDeleteBody')}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>
          {t('cancel')}
        </Button>
        <Button onClick={onConfirm} disabled={busy} className="bg-red-600 hover:bg-red-700">
          {t('delete')}
        </Button>
      </div>
    </Dialog>
  );
}
