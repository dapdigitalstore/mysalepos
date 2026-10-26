'use client';

import { Suspense } from 'react';
import { RegisterGate } from '../register/register-gate';
import { PosScreen } from './pos-screen';

/** The POS needs an open cash register: until the user has one they see the "open register" form instead. */
export function PosEntry() {
  return (
    <Suspense fallback={null}>
      <RegisterGate>{(register) => <PosScreen register={register} />}</RegisterGate>
    </Suspense>
  );
}
