'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, History, Loader2, Pause, PauseCircle, Receipt, Trash2, Wallet, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form-field';
import { useToast } from '@/components/ui/toast';
import { Link, useRouter } from '@/i18n/routing';
import { cn, formatMoney } from '@/lib/utils';
import {
  buildSaleBody,
  calcCart,
  defaultHeader,
  headerFromSale,
  lineFromSaleLine,
  lineIssues,
  newPaymentRow,
  paymentRowFromDetail,
  type PaymentRow,
  type PaymentsInput,
  type SaleHeader,
} from '../_lib/cart';
import { toFixed, toText, ZERO } from '../_lib/decimal';
import { isPos } from '../_lib/decimal';
import { saleApi } from '../_lib/sale-api';
import type { CustomerOption, SaleBody, SaleDetail, SaleSettings } from '../_lib/sale-types';
import { SCREEN_SHORTCUTS, shortcutFor } from '../_lib/shortcuts';
import { formatInstant } from '../_lib/time';
import { CartLines } from '../_components/cart-lines';
import { ConfirmBox } from '../_components/confirm-box';
import { CustomerPicker } from '../_components/customer-picker';
import { ExtraFields } from '../_components/extra-fields';
import { ProductSearch } from '../_components/product-search';
import { TotalsPanel } from '../_components/totals-panel';
import { useSaleCart } from '../_components/use-sale-cart';
import { isRegisterError, useSaleError } from '../_components/use-sale-error';
import { flag, useSaleSettings } from '../_components/use-sale-settings';
import type { CurrentRegister } from '../register/register-types';
import { methodsFor, PaymentDialog } from './payment-dialog';
import { RecentDialog } from './recent-dialog';
import { ShortcutsHelp } from './shortcuts-help';
import { SuspendedDialog } from './suspended-dialog';

type SubmitKind = 'pay' | 'express' | 'credit' | 'suspend' | 'draft' | 'quotation';

/** A stored sale loaded into the cart (resumed suspended sale, draft, quotation, or a sale being edited). */
interface EditState {
  id: number;
  status: 'final' | 'draft';
  isSuspend: boolean;
  invoiceNo: string | null;
  rows: PaymentRow[];
  changePaymentId: number | null;
}

interface Banner {
  message: string;
  register?: boolean;
}

export function PosScreen({ register }: { register: CurrentRegister }) {
  const t = useTranslations('pos');
  const c = useTranslations('common');
  const settings = useSaleSettings();

  if (settings.isLoading) {
    return (
      <Card aria-busy="true" className="mx-auto max-w-xl">
        <div className="h-5 w-1/3 animate-pulse rounded bg-slate-100" />
        <p className="mt-3 text-sm text-slate-500">{t('loadingSettings')}</p>
      </Card>
    );
  }
  if (settings.isError || !settings.data) {
    return (
      <Card className="mx-auto max-w-xl">
        <p role="alert" className="text-sm text-red-700">
          {t('settingsError')}
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void settings.refetch()}>
          {c('retry')}
        </Button>
      </Card>
    );
  }
  if (settings.data.locations.length === 0) {
    return (
      <Card className="mx-auto max-w-xl">
        <p className="text-sm text-slate-700">{t('noLocations')}</p>
      </Card>
    );
  }
  return <PosWorkspace settings={settings.data} register={register} />;
}

function PosWorkspace({ settings, register }: { settings: SaleSettings; register: CurrentRegister }) {
  const t = useTranslations('pos');
  const c = useTranslations('common');
  const locale = useLocale();
  const can = useCan();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const describe = useSaleError();
  const searchParams = useSearchParams();

  const [header, setHeader] = useState<SaleHeader>(() => defaultHeader(settings, true));
  const patchHeader = useCallback((p: Partial<SaleHeader>) => setHeader((h) => ({ ...h, ...p })), []);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadingSale, setLoadingSale] = useState(false);

  const [payOpen, setPayOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [suspendedOpen, setSuspendedOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [pendingLocation, setPendingLocation] = useState<number | null>(null);
  const [pendingLoad, setPendingLoad] = useState<number | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const customerRef = useRef<HTMLInputElement>(null);
  const discountRef = useRef<HTMLInputElement>(null);

  const onCartError = useCallback((e: unknown) => setBanner({ message: describe(e), register: isRegisterError(e) }), [describe]);
  const cart = useSaleCart({ settings, isDirectSale: false, header, draftLike: false, onError: onCartError });

  const location = settings.locations.find((l) => l.id === header.locationId) ?? null;
  const totals = useMemo(() => calcCart(cart.lines, header, settings), [cart.lines, header, settings]);
  const allowOverselling = !!settings.posSettings.allow_overselling;
  const hasLines = cart.lines.length > 0;
  const stockIssue = cart.lines.some((l) => lineIssues(l, { checkStock: true, allowOverselling }).length > 0);
  const otherIssue = cart.lines.some((l) => lineIssues(l, { checkStock: false, allowOverselling }).length > 0);
  const isWalkIn = header.customer?.isDefault ?? true;
  const editingPaid = editing !== null && editing.status === 'final' && !editing.isSuspend;
  const money = (d: typeof totals.finalTotal) => formatMoney(toFixed(d, settings.business.currencyPrecision));
  const modalOpen = payOpen || moreOpen || recentOpen || suspendedOpen || clearOpen || pendingLocation !== null || pendingLoad !== null;

  // ---------------------------------------------------------------------------- reset / load

  const focusSearch = () => setTimeout(() => searchRef.current?.focus(), 50);

  const resetCart = useCallback(
    (keepLocation: number | null) => {
      cart.clear();
      setEditing(null);
      setHeader((h) => {
        const base = defaultHeader(settings, true);
        const locId = keepLocation ?? h.locationId;
        const loc = settings.locations.find((l) => l.id === locId);
        return { ...base, locationId: locId, priceGroupId: loc?.sellingPriceGroupId ?? null };
      });
      setBanner(null);
      setSaveError(null);
      if (searchParams.get('sale')) router.replace('/m/sell/pos');
      focusSearch();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cart.clear, settings, searchParams, router],
  );

  const loadSale = useCallback(
    async (id: number) => {
      setLoadingSale(true);
      setBanner(null);
      try {
        const sale = await saleApi<SaleDetail>(`/sales/${id}`);
        if (sale.isDirectSale) {
          router.push(`/m/sell/sales/${id}/edit`);
          return;
        }
        if (sale.returns.length > 0) {
          setBanner({ message: t('errors.RETURN_EXISTS') });
          return;
        }
        const flags = {
          canEditPrice: settings.permissions.canEditPrice.pos,
          canEditDiscount: settings.permissions.canEditLineDiscount.pos,
          inlineTax: settings.business.enableInlineTax,
          heldBase: sale.status === 'final',
        };
        cart.setLines(sale.lines.filter((l) => l.parentSellLineId === null).map((l) => lineFromSaleLine(l, flags)));
        setHeader({ ...headerFromSale(sale, settings), transactionDate: '' });
        const keepPayments = sale.status === 'final' && !sale.isSuspend;
        setEditing({
          id: sale.id,
          status: sale.status,
          isSuspend: sale.isSuspend,
          invoiceNo: sale.invoiceNo,
          rows: keepPayments ? sale.payments.filter((p) => !p.isReturn).map(paymentRowFromDetail) : [],
          changePaymentId: keepPayments ? (sale.payments.find((p) => p.isReturn)?.id ?? null) : null,
        });
        setSuspendedOpen(false);
        setRecentOpen(false);
        focusSearch();
      } catch (e) {
        setBanner({ message: describe(e), register: isRegisterError(e) });
      } finally {
        setLoadingSale(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings, cart.setLines, describe, router, t],
  );

  const requestLoad = (id: number) => (hasLines ? setPendingLoad(id) : void loadSale(id));

  // `/m/sell/pos?sale=<id>`: edit a POS sale / draft / quotation from the lists
  const saleParam = searchParams.get('sale');
  const loadedParam = useRef<string | null>(null);
  useEffect(() => {
    if (saleParam && loadedParam.current !== saleParam && Number.isInteger(Number(saleParam))) {
      loadedParam.current = saleParam;
      void loadSale(Number(saleParam));
    }
  }, [saleParam, loadSale]);

  // ---------------------------------------------------------------------------- customer / location / price group

  const onCustomer = (customer: CustomerOption) => {
    const next = { ...header, customer };
    setHeader(next);
    void cart.reprice(next);
  };
  const onPriceGroup = (id: number | null) => {
    const next = { ...header, priceGroupId: id };
    setHeader(next);
    void cart.reprice(next);
  };
  const applyLocation = (id: number) => {
    cart.clear();
    const loc = settings.locations.find((l) => l.id === id);
    setHeader((h) => ({ ...h, locationId: id, priceGroupId: loc?.sellingPriceGroupId ?? null }));
    setPendingLocation(null);
    focusSearch();
  };
  const onLocation = (id: number) => {
    if (id === header.locationId) return;
    if (hasLines) setPendingLocation(id);
    else applyLocation(id);
  };

  // ---------------------------------------------------------------------------- saving

  const save = useMutation({
    mutationFn: (v: { kind: SubmitKind; body: SaleBody }) =>
      editing ? saleApi<SaleDetail>(`/sales/${editing.id}`, { method: 'PUT', body: v.body }) : saleApi<SaleDetail>('/sales', { method: 'POST', body: v.body }),
    onSuccess: (sale, v) => {
      void qc.invalidateQueries({ queryKey: ['sales'] });
      void qc.invalidateQueries({ queryKey: ['cash-register'] });
      setPayOpen(false);
      resetCart(null);
      if (sale.status === 'final' && !sale.isSuspend) {
        toast.success(t('saleSaved', { invoice: sale.invoiceNo ?? `#${sale.id}` }));
        if (settings.permissions.canPrint && location?.printReceiptOnInvoice !== false) router.push(`/m/sell/sales/${sale.id}/print?auto=1`);
      } else {
        toast.success(v.kind === 'suspend' ? t('suspendedSaved') : v.kind === 'quotation' ? t('quotationSaved') : t('draftSaved'));
      }
    },
    onError: (e) => {
      const message = describe(e);
      setSaveError(message);
      setBanner({ message, register: isRegisterError(e) });
    },
  });

  const submit = (kind: SubmitKind, payments?: PaymentsInput) => {
    if (!header.customer || header.locationId === null || save.isPending) return;
    setSaveError(null);
    setBanner(null);
    const status = kind === 'draft' ? 'draft' : kind === 'quotation' ? 'quotation' : 'final';
    const body = buildSaleBody({
      settings,
      header,
      lines: cart.lines,
      status,
      isDirectSale: false,
      isSuspend: kind === 'suspend',
      isCreditSale: kind === 'credit',
      payments,
      isUpdate: editing !== null,
    });
    // a resumed suspended sale must say it is no longer suspended
    if (editing) body.isSuspend = kind === 'suspend';
    save.mutate({ kind, body });
  };

  /** Checks the cart before a final sale (stock is enforced) or a draft / quotation (it is not). */
  const ready = (final: boolean): boolean => {
    if (!hasLines) {
      setBanner({ message: t('errors.emptyCart') });
      return false;
    }
    if (final ? stockIssue : otherIssue) {
      setBanner({ message: t('errors.fixLines') });
      return false;
    }
    if (!header.customer) {
      setBanner({ message: t('errors.noCustomer') });
      return false;
    }
    return true;
  };

  const openPay = () => {
    if (!ready(true)) return;
    setSaveError(null);
    setPayOpen(true);
  };

  const express = () => {
    if (!ready(true)) return;
    const cash = methodsFor(settings, location).find((m) => m.key === 'cash');
    const row = newPaymentRow('cash', toText(totals.finalTotal), cash?.accountId ?? null);
    submit('express', { rows: isPos(totals.finalTotal) ? [row] : [], change: ZERO, changePaymentId: null });
  };

  const holdOrDraft = (kind: 'suspend' | 'draft' | 'quotation') => {
    if (!ready(kind === 'suspend')) return;
    submit(kind);
  };

  // ---------------------------------------------------------------------------- keyboard shortcuts

  const actions = useRef<Record<string, () => void>>({});
  actions.current = {
    help: () => setHelpOpen((o) => !o),
    search: () => searchRef.current?.focus(),
    customer: () => customerRef.current?.focus(),
    discount: () => discountRef.current?.focus(),
    pay: () => !flag(settings.posSettings.disable_pay_checkout) && openPay(),
    express: () => !flag(settings.posSettings.disable_express_checkout) && !editingPaid && express(),
    suspend: () => !editingPaid && holdOrDraft('suspend'),
    draft: () => !editingPaid && !flag(settings.posSettings.disable_draft) && holdOrDraft('draft'),
    quotation: () => !editingPaid && holdOrDraft('quotation'),
    clear: () => hasLines && setClearOpen(true),
    recent: () => setRecentOpen(true),
  };
  const modalRef = useRef(modalOpen);
  modalRef.current = modalOpen;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = shortcutFor(e, SCREEN_SHORTCUTS);
      if (!id) return;
      if (modalRef.current && id !== 'help') return;
      e.preventDefault();
      actions.current[id]?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // leaving the page with items in the cart loses them: ask the browser to confirm
  useEffect(() => {
    if (!hasLines) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasLines]);

  // ---------------------------------------------------------------------------- render

  const checkQty = !allowOverselling;
  const customerName = header.customer?.label ?? '';
  const advance = header.customer && !header.customer.isDefault ? header.customer.balance : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="me-auto text-xl font-semibold text-slate-900">{t('title')}</h1>

        {settings.locations.length > 1 ? (
          <div className="flex items-center gap-2">
            <label htmlFor="pos-location" className="text-sm text-slate-600">
              {t('location')}
            </label>
            <Select id="pos-location" value={header.locationId ?? ''} onChange={(e) => onLocation(Number(e.target.value))} disabled={editing !== null} className="h-10 w-48">
              {settings.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <span className="text-sm text-slate-600">{location?.name}</span>
        )}

        <span className="hidden items-center gap-1 text-xs text-slate-500 md:inline-flex" title={t('registerOpenedAt', { time: formatInstant(register.openedAt, settings.business.timeZone, locale) })}>
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          {t('registerNo', { id: register.id })}
        </span>
        {settings.permissions.canViewRegister && (
          <Link href="/m/sell/register/details" className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Wallet className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t('registerSummary')}</span>
          </Link>
        )}
        <Button variant="outline" size="sm" onClick={() => setSuspendedOpen(true)}>
          <PauseCircle className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">{t('suspendedSales')}</span>
        </Button>
        {!flag(settings.posSettings.hide_recent_trans) && (
          <Button variant="outline" size="sm" onClick={() => setRecentOpen(true)}>
            <History className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t('recentTransactions')}</span>
          </Button>
        )}
        <ShortcutsHelp open={helpOpen} onToggle={setHelpOpen} />
      </div>

      {banner && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          <div>
            <p>{banner.message}</p>
            {banner.register && (
              <Link href="/m/sell/register" target="_blank" className="mt-1 inline-block font-medium underline">
                {t('openRegisterLink')}
              </Link>
            )}
          </div>
          <button type="button" onClick={() => setBanner(null)} aria-label={t('dismiss')} className="rounded p-1 hover:bg-red-100">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {editing && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <span>
            {editing.isSuspend ? t('editingSuspended') : editing.status === 'draft' ? t('editingDraft') : t('editingSale')}
            {editing.invoiceNo && <strong className="ms-1">{editing.invoiceNo}</strong>}
          </span>
          <Button variant="outline" size="sm" onClick={() => resetCart(null)}>
            {t('stopEditing')}
          </Button>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section aria-label={t('cart')} className="order-2 space-y-3 lg:order-1">
          <Card className="space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Field label={t('customer')} htmlFor="pos-customer" className="min-w-0">
                <CustomerPicker id="pos-customer" inputRef={customerRef} value={header.customer} onChange={onCustomer} />
              </Field>
              {settings.sellingPriceGroups.length > 0 && (
                <Field label={t('priceGroup')} htmlFor="pos-price-group">
                  <Select id="pos-price-group" value={header.priceGroupId ?? ''} onChange={(e) => onPriceGroup(e.target.value === '' ? null : Number(e.target.value))} className="sm:w-44">
                    <option value="">{t('defaultPrice')}</option>
                    {settings.sellingPriceGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
          </Card>

          <Card className="p-3">
            {loadingSale ? (
              <p className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {t('loadingSale')}
              </p>
            ) : (
              <CartLines
                lines={cart.lines}
                settings={settings}
                totals={totals}
                variant="pos"
                checkStock
                onUpdate={cart.update}
                onRemove={cart.remove}
                onUnit={cart.changeUnit}
              />
            )}
          </Card>

          <Card className="p-4">
            <TotalsPanel settings={settings} header={header} onHeader={patchHeader} totals={totals} variant="pos" discountRef={discountRef} />
            <Button type="button" variant="ghost" size="sm" className="mt-3" onClick={() => setMoreOpen(true)}>
              <Receipt className="h-4 w-4" aria-hidden="true" />
              {t('moreOptions')}
            </Button>
          </Card>

          <div className="sticky bottom-0 z-10 -mx-4 border-t border-slate-200 bg-white/95 p-3 backdrop-blur sm:-mx-6 lg:static lg:mx-0 lg:rounded-xl lg:border lg:shadow-card">
            <div className="mb-2 flex flex-wrap gap-2">
              {!editingPaid && (
                <Button variant="outline" size="sm" onClick={() => holdOrDraft('suspend')} disabled={save.isPending}>
                  <Pause className="h-4 w-4" aria-hidden="true" />
                  {t('suspend')}
                </Button>
              )}
              {!editingPaid && !flag(settings.posSettings.disable_draft) && (
                <Button variant="outline" size="sm" onClick={() => holdOrDraft('draft')} disabled={save.isPending}>
                  {t('saveDraft')}
                </Button>
              )}
              {!editingPaid && (
                <Button variant="outline" size="sm" onClick={() => holdOrDraft('quotation')} disabled={save.isPending}>
                  {t('saveQuotation')}
                </Button>
              )}
              <Button variant="ghost" size="sm" className="ms-auto text-red-600 hover:bg-red-50" onClick={() => setClearOpen(true)} disabled={!hasLines || save.isPending}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {t('clearCart')}
              </Button>
            </div>
            <div className="flex gap-2">
              {!flag(settings.posSettings.disable_express_checkout) && !editingPaid && (
                <Button variant="outline" size="lg" className="flex-1" onClick={express} disabled={save.isPending || !hasLines}>
                  {save.isPending && save.variables?.kind === 'express' ? c('saving') : t('expressCheckout')}
                </Button>
              )}
              {!flag(settings.posSettings.disable_pay_checkout) && (
                <Button size="lg" className="flex-[2]" onClick={openPay} disabled={save.isPending || !hasLines}>
                  {editingPaid ? t('updateSale') : t('pay')}
                  <span className="ms-1 opacity-90">{money(totals.finalTotal)}</span>
                </Button>
              )}
            </div>
          </div>
        </section>

        <section aria-label={t('products')} className={cn('order-1 lg:order-2 lg:sticky lg:top-20')}>
          <Card className="p-3">
            <ProductSearch
              locationId={header.locationId}
              priceGroupId={header.priceGroupId}
              checkQty={checkQty}
              layout="grid"
              suggestWhenEmpty={!flag(settings.posSettings.hide_product_suggestion)}
              onAdd={cart.add}
              inputRef={searchRef}
              autoFocus
              adding={cart.adding}
            />
          </Card>
        </section>
      </div>

      <PaymentDialog
        open={payOpen}
        onClose={() => setPayOpen(false)}
        settings={settings}
        location={location}
        customerName={customerName}
        isWalkIn={isWalkIn}
        advanceBalance={advance}
        totals={totals}
        initialRows={editing?.rows ?? []}
        changePaymentId={editing?.changePaymentId ?? null}
        busy={save.isPending}
        error={saveError}
        onSubmit={(input) => submit('pay', input)}
        onCredit={() => submit('credit')}
      />

      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title={t('moreOptions')} className="max-w-3xl">
        <ExtraFields settings={settings} header={header} onHeader={patchHeader} idPrefix="pos-more" />
        <div className="mt-4 flex justify-end">
          <Button onClick={() => setMoreOpen(false)}>{t('done')}</Button>
        </div>
      </Dialog>

      <SuspendedDialog open={suspendedOpen} onClose={() => setSuspendedOpen(false)} timeZone={settings.business.timeZone} onResume={requestLoad} />
      <RecentDialog open={recentOpen} onClose={() => setRecentOpen(false)} timeZone={settings.business.timeZone} canPrint={settings.permissions.canPrint || can('print_invoice')} onOpenDraft={requestLoad} />

      <ConfirmBox
        open={clearOpen}
        title={t('clearTitle')}
        body={t('clearBody')}
        confirmLabel={t('clearCart')}
        onClose={() => setClearOpen(false)}
        onConfirm={() => {
          setClearOpen(false);
          resetCart(null);
        }}
      />
      <ConfirmBox
        open={pendingLocation !== null}
        title={t('locationChangeTitle')}
        body={t('locationChangeBody')}
        confirmLabel={t('locationChangeConfirm')}
        onClose={() => setPendingLocation(null)}
        onConfirm={() => pendingLocation !== null && applyLocation(pendingLocation)}
      />
      <ConfirmBox
        open={pendingLoad !== null}
        title={t('replaceCartTitle')}
        body={t('replaceCartBody')}
        confirmLabel={t('replaceCartConfirm')}
        onClose={() => setPendingLoad(null)}
        onConfirm={() => {
          const id = pendingLoad;
          setPendingLoad(null);
          if (id !== null) void loadSale(id);
        }}
      />
    </div>
  );
}
