'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/client-api';
import { OpenRegisterForm } from './open-register-form';
import { REGISTER_KEYS, type CurrentRegister, type CurrentRegisterResponse } from './register-types';

/** The signed-in user's open register (null when none), refreshed whenever a register is opened or closed. */
export function useCurrentRegister() {
  return useQuery({
    queryKey: REGISTER_KEYS.current,
    queryFn: () => api<CurrentRegisterResponse>('/cash-registers/current'),
    staleTime: 0,
  });
}

interface Props {
  /** Rendered once the user has an open register. A function receives the register. */
  children: React.ReactNode | ((register: CurrentRegister) => React.ReactNode);
  /** Called after the user opened a register from the prompt. */
  onOpened?: (register: CurrentRegister) => void;
}

/**
 * Wrap any screen that needs an open cash register (POS, sell returns, ...). While there is none the user sees the
 * "open register" form instead of the children - the Laravel redirect to cash-register/create, in place.
 *
 *   import { RegisterGate } from '../register/register-gate';        (from m/sell/<screen>/)
 *   <RegisterGate>{(register) => <PosScreen registerId={register.id} />}</RegisterGate>
 */
export function RegisterGate({ children, onOpened }: Props) {
  const t = useTranslations('cashRegister');
  const c = useTranslations('common');
  const current = useCurrentRegister();

  if (current.isLoading) {
    return (
      <Card className="mx-auto max-w-lg" aria-busy="true">
        <div className="h-5 w-1/2 animate-pulse rounded bg-slate-100" />
        <p className="mt-3 text-sm text-slate-500">{t('checking')}</p>
      </Card>
    );
  }

  if (current.isError || !current.data) {
    return (
      <Card className="mx-auto max-w-lg">
        <p role="alert" className="text-sm text-red-700">
          {t('checkError')}
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void current.refetch()}>
          {c('retry')}
        </Button>
      </Card>
    );
  }

  const register = current.data.register;
  if (current.data.open && register) {
    return <>{typeof children === 'function' ? children(register) : children}</>;
  }

  return (
    <div className="mx-auto max-w-lg">
      <h2 className="text-lg font-semibold text-slate-900">{t('gateTitle')}</h2>
      <p className="mb-4 mt-1 text-sm text-slate-500">{t('gateHelp')}</p>
      <OpenRegisterForm onOpened={onOpened} />
    </div>
  );
}
