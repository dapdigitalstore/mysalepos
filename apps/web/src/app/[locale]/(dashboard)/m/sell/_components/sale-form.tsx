'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { useCan } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/page-header';
import { useToast } from '@/components/ui/toast';
import { useDebounced } from '@/hooks/use-debounced';
import { Link, useRouter } from '@/i18n/routing';
import { formatMoney } from '@/lib/utils';
import {
  buildSaleBody,
  calcCart,
  defaultHeader,
  headerFromSale,
  lineFromSaleLine,
  lineIssues,
  newPaymentRow,
  paymentRowFromDetail,
  type CartLine,
  type PaymentRow,
  type SaleHeader,
} from '../_lib/cart';
import { isPos, toFixed } from '../_lib/decimal';
import { saleApi } from '../_lib/sale-api';
import { summarizePayments } from '../_lib/sale-math';
import type { CustomerOption, SaleBody, SaleDetail, SaleSettings, SaleStatusInput } from '../_lib/sale-types';
import { instantToLocalInput } from '../_lib/time';
import { CartLines } from './cart-lines';
import { CustomerPicker } from './customer-picker';
import { ExtraFields } from './extra-fields';
import { PaymentRows } from './payment-rows';
import { ProductSearch } from './product-search';
import { TotalsPanel } from './totals-panel';
import { useSaleCart } from './use-sale-cart';
import { useSaleError } from './use-sale-error';
import { useSaleSettings } from './use-sale-settings';

const STATUSES: SaleStatusInput[] = ['final', 'draft', 'quotation', 'proforma'];

interface Props {
  /** Edit this sale; omit for a new sale. */
  saleId?: number;
}

/** Laravel "Add sale" / "Edit sale": the full table style form for sales, drafts, quotations and proformas. */
export function SaleForm({ saleId }: Props) {
  const t = useTranslations('saleForm');
  const c = useTranslations('common');
  const router = useRouter();
  const settings = useSaleSettings();
  const sale = useQuery({
    queryKey: ['sales', 'form-detail', saleId],
    queryFn: () => saleApi<SaleDetail>(`/sales/${saleId}`),
    enabled: saleId !== undefined,
    staleTime: 0,
    gcTime: 0,
  });

  // POS sales are edited on the POS screen (it takes the register rows and the suspend state into account)
  const goesToPos = sale.data !== undefined && !sale.data.isDirectSale;
  useEffect(() => {
    if (goesToPos && saleId !== undefined) router.replace(`/m/sell/pos?sale=${saleId}`);
  }, [goesToPos, saleId, router]);

  const title = saleId === undefined ? t('addTitle') : t('editTitle');
  const loading = settings.isLoading || (saleId !== undefined && sale.isLoading) || goesToPos;
  const failed = settings.isError || !settings.data || (saleId !== undefined && (sale.isError || !sale.data));

  if (loading) {
    return (
      <div aria-busy="true">
        <PageHeader title={title} />
        <Card>
          <div className="h-5 w-1/3 animate-pulse rounded bg-slate-100" />
          <p className="mt-3 text-sm text-slate-500">{goesToPos ? t('openingPos') : c('loading')}</p>
        </Card>
      </div>
    );
  }
  if (failed || !settings.data) {
    return (
      <div>
        <PageHeader title={title} />
        <Card>
          <p role="alert" className="text-sm text-red-700">
            {t('loadError')}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              void settings.refetch();
              void sale.refetch();
            }}
          >
            {c('retry')}
          </Button>
        </Card>
      </div>
    );
  }
  if (settings.data.locations.length === 0) {
    return (
      <div>
        <PageHeader title={title} />
        <Card>
          <p className="text-sm text-slate-700">{t('noLocations')}</p>
        </Card>
      </div>
    );
  }
  return <SaleFormInner settings={settings.data} sale={sale.data ?? null} title={title} />;
}

function SaleFormInner({ settings, sale, title }: { settings: SaleSettings; sale: SaleDetail | null; title: string }) {
  const t = useTranslations('saleForm');
  const p = useTranslations('pos');
  const c = useTranslations('common');
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const describe = useSaleError();
  const isEdit = sale !== null;
  const tz = settings.business.timeZone;
  const cp = settings.business.currencyPrecision;

  const initialDate = useMemo(() => (sale ? instantToLocalInput(sale.transactionDate, tz) : instantToLocalInput(new Date(), tz)), [sale, tz]);
  const [header, setHeader] = useState<SaleHeader>(() => (sale ? headerFromSale(sale, settings) : { ...defaultHeader(settings, false), transactionDate: initialDate }));
  const patch = (x: Partial<SaleHeader>) => setHeader((h) => ({ ...h, ...x }));
  const [error, setError] = useState<string | null>(null);

  const initialLines = useMemo<CartLine[]>(
    () =>
      sale
        ? sale.lines
            .filter((l) => l.parentSellLineId === null)
            .map((l) =>
              lineFromSaleLine(l, {
                canEditPrice: settings.permissions.canEditPrice.direct,
                canEditDiscount: settings.permissions.canEditLineDiscount.direct,
                inlineTax: settings.business.enableInlineTax,
                heldBase: sale.status === 'final',
              }),
            )
        : [],
    // the sale is loaded once; edits live in the cart state
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const draftLike = header.status !== 'final';
  const cart = useSaleCart({
    settings,
    isDirectSale: true,
    header,
    draftLike,
    onError: (e) => setError(describe(e)),
    initialLines,
  });
  const totals = useMemo(() => calcCart(cart.lines, header, settings), [cart.lines, header, settings]);

  // ---------------------------------------------------------------------------- payments
  const advanceLocked = isEdit && sale.payments.some((x) => x.method === 'advance');
  const canPay = settings.permissions.canTakePayments && header.status === 'final' && !advanceLocked;
  const [rows, setRows] = useState<PaymentRow[]>(() => {
    if (sale && sale.status === 'final') return sale.payments.filter((x) => !x.isReturn).map(paymentRowFromDetail);
    return sale ? [] : [newPaymentRow('cash', '')];
  });
  const changePaymentId = sale?.payments.find((x) => x.isReturn)?.id ?? null;
  const location = settings.locations.find((l) => l.id === header.locationId) ?? null;
  const methods = location && location.paymentMethods.length > 0 ? location.paymentMethods : settings.paymentMethods;
  const summary = summarizePayments(totals.finalTotal, rows.map((r) => r.amount));
  const advance = header.customer && !header.customer.isDefault ? header.customer.balance : null;
  const money = (d: Parameters<typeof toFixed>[0]) => formatMoney(toFixed(d, cp));

  // ---------------------------------------------------------------------------- invoice number check
  const invoiceTyped = header.invoiceNo.trim();
  const invoiceDebounced = useDebounced(invoiceTyped, 400);
  const storedInvoice = sale?.invoiceNo ?? '';
  const invoiceCheck = useQuery({
    queryKey: ['sales', 'check-invoice-no', invoiceDebounced, sale?.id],
    queryFn: () => saleApi<{ available: boolean }>('/sales/check-invoice-no', { query: { invoiceNo: invoiceDebounced, excludeId: sale?.id } }),
    enabled: invoiceDebounced !== '' && invoiceDebounced !== storedInvoice,
    staleTime: 10_000,
  });
  const invoiceTaken = invoiceCheck.data?.available === false && invoiceDebounced === invoiceTyped;

  // ---------------------------------------------------------------------------- location / customer / price group
  const onLocation = (id: number) => {
    cart.clear();
    const loc = settings.locations.find((l) => l.id === id);
    patch({ locationId: id, priceGroupId: loc?.sellingPriceGroupId ?? null });
  };
  const onCustomer = (customer: CustomerOption) => {
    const next = { ...header, customer, payTermNumber: customer.payTermNumber ? String(customer.payTermNumber) : header.payTermNumber, payTermType: (customer.payTermType === 'days' || customer.payTermType === 'months' ? customer.payTermType : header.payTermType) as SaleHeader['payTermType'] };
    setHeader(next);
    void cart.reprice(next);
  };
  const onPriceGroup = (id: number | null) => {
    const next = { ...header, priceGroupId: id };
    setHeader(next);
    void cart.reprice(next);
  };

  // ---------------------------------------------------------------------------- save
  const hasReturn = isEdit && sale.returns.length > 0;

  const done = (saved: SaleDetail) => {
    void qc.invalidateQueries({ queryKey: ['sales'] });
    toast.success(t('saved'));
    if (saved.status === 'final') router.push(`/m/sell/sales/${saved.id}`);
    else if (saved.subStatus === 'quotation' && can('list_quotations')) router.push('/m/sell/quotations');
    else if (can('list_drafts')) router.push('/m/sell/drafts');
    else router.push(`/m/sell/sales/${saved.id}`);
  };

  const save = useMutation({
    mutationFn: (body: SaleBody) => (sale ? saleApi<SaleDetail>(`/sales/${sale.id}`, { method: 'PUT', body }) : saleApi<SaleDetail>('/sales', { method: 'POST', body })),
    onSuccess: done,
    onError: (e) => setError(describe(e)),
  });

  const validate = (): string | null => {
    if (header.locationId === null) return t('errLocation');
    if (!header.customer) return t('errCustomer');
    if (!header.transactionDate) return t('errDate');
    if (cart.lines.length === 0) return t('errNoLines');
    const checkStock = header.status === 'final';
    const allowOverselling = !!settings.posSettings.allow_overselling;
    if (cart.lines.some((l) => lineIssues(l, { checkStock, allowOverselling }).length > 0)) return t('errLines');
    if (invoiceTaken) return t('errInvoiceTaken');
    if (header.payTermNumber.trim() !== '' && header.payTermType === '') return t('errPayTerm');
    if (canPay && rows.some((r) => r.amount.trim() !== '' && !/^\d*\.?\d*$/.test(r.amount))) return t('errPayment');
    return null;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (save.isPending || hasReturn) return;
    const problem = validate();
    setError(problem);
    if (problem) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const body = buildSaleBody({
      settings,
      header,
      lines: cart.lines,
      status: header.status,
      isDirectSale: true,
      payments: canPay ? { rows, change: summary.change, changePaymentId } : undefined,
      initialDate: isEdit ? initialDate : undefined,
      initialInvoiceNo: sale?.invoiceNo ?? '',
      isUpdate: isEdit,
    });
    save.mutate(body);
  };

  const showInvoiceScheme = header.status === 'final' && settings.invoiceSchemes.length > 1 && (!isEdit || sale.status === 'draft');

  return (
    <form
      onSubmit={submit}
      noValidate
      onKeyDown={(e) => {
        // Enter inside a field (quantity, price, search) must never save the whole sale
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault();
      }}
    >
      <PageHeader title={title} description={isEdit ? sale.invoiceNo ?? undefined : undefined} />

      {hasReturn && (
        <p role="alert" className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {p('errors.RETURN_EXISTS')}
        </p>
      )}
      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <Card className="mb-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">{t('details')}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={p('location')} htmlFor="sf-location" required>
            <Select id="sf-location" value={header.locationId ?? ''} onChange={(e) => onLocation(Number(e.target.value))} disabled={isEdit}>
              {settings.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={p('customer')} htmlFor="sf-customer" required className="sm:col-span-1 lg:col-span-2">
            <CustomerPicker id="sf-customer" value={header.customer} onChange={onCustomer} />
          </Field>
          <Field label={t('saleDate')} htmlFor="sf-date" required>
            <Input id="sf-date" type="datetime-local" value={header.transactionDate} onChange={(e) => patch({ transactionDate: e.target.value })} />
          </Field>
          <Field label={t('status')} htmlFor="sf-status" required>
            <Select id="sf-status" value={header.status} onChange={(e) => patch({ status: e.target.value as SaleStatusInput })}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`statuses.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          {settings.sellingPriceGroups.length > 0 && (
            <Field label={p('priceGroup')} htmlFor="sf-price-group">
              <Select id="sf-price-group" value={header.priceGroupId ?? ''} onChange={(e) => onPriceGroup(e.target.value === '' ? null : Number(e.target.value))}>
                <option value="">{p('defaultPrice')}</option>
                {settings.sellingPriceGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t('payTerm')} htmlFor="sf-pay-term-number">
            <div className="flex gap-2">
              <Input id="sf-pay-term-number" value={header.payTermNumber} onChange={(e) => patch({ payTermNumber: e.target.value.replace(/\D/g, '') })} inputMode="numeric" className="w-24" />
              <Select aria-label={t('payTermType')} value={header.payTermType} onChange={(e) => patch({ payTermType: e.target.value as SaleHeader['payTermType'] })}>
                <option value="">{t('payTermNone')}</option>
                <option value="days">{t('days')}</option>
                <option value="months">{t('months')}</option>
              </Select>
            </div>
          </Field>
          {showInvoiceScheme && (
            <Field label={t('invoiceScheme')} htmlFor="sf-scheme">
              <Select id="sf-scheme" value={header.invoiceSchemeId ?? ''} onChange={(e) => patch({ invoiceSchemeId: e.target.value === '' ? null : Number(e.target.value) })}>
                <option value="">{t('defaultScheme')}</option>
                {settings.invoiceSchemes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t('invoiceNo')} htmlFor="sf-invoice-no" hint={t('invoiceNoHint')} error={invoiceTaken ? t('errInvoiceTaken') : undefined}>
            <Input id="sf-invoice-no" value={header.invoiceNo} onChange={(e) => patch({ invoiceNo: e.target.value })} maxLength={191} autoComplete="off" />
          </Field>
        </div>
      </Card>

      <Card className="mb-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">{t('products')}</h2>
        <div className="mb-4">
          <ProductSearch
            locationId={header.locationId}
            priceGroupId={header.priceGroupId}
            checkQty={false}
            layout="dropdown"
            suggestWhenEmpty={false}
            onAdd={cart.add}
            adding={cart.adding}
            autoFocus={!isEdit}
          />
        </div>
        <CartLines
          lines={cart.lines}
          settings={settings}
          totals={totals}
          variant="table"
          checkStock={header.status === 'final'}
          onUpdate={cart.update}
          onRemove={cart.remove}
          onUnit={cart.changeUnit}
        />
      </Card>

      <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">{t('moreInfo')}</h2>
          <ExtraFields settings={settings} header={header} onHeader={patch} idPrefix="sf" />
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">{t('totals')}</h2>
          <TotalsPanel settings={settings} header={header} onHeader={patch} totals={totals} variant="form" />
        </Card>
      </div>

      {advanceLocked && (
        <p className="mb-4 rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-700">{t('advanceLocked')}</p>
      )}
      {canPay && (
        <Card className="mb-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">{t('payments')}</h2>
          <PaymentRows rows={rows} onChange={setRows} methods={methods} accounts={settings.accounts} total={totals.finalTotal} currencyPrecision={cp} advanceBalance={advance} idPrefix="sf-pay" />
          <div className="mt-4 grid gap-2 rounded-lg border border-slate-200 p-3 text-sm sm:grid-cols-3" aria-live="polite">
            <Cell label={p('tendered')} value={money(summary.tendered)} />
            <Cell label={p('balanceDue')} value={money(summary.balance)} tone={isPos(summary.balance) ? 'bad' : 'plain'} />
            <Cell label={p('changeDue')} value={money(summary.change)} tone={isPos(summary.change) ? 'good' : 'plain'} />
          </div>
          {!isPos(summary.tendered) && header.status === 'final' && <p className="mt-2 text-xs text-slate-500">{t('noPaymentNote')}</p>}
        </Card>
      )}

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div>
          <p className="text-xs text-slate-500">{p('totalPayable')}</p>
          <p className="text-xl font-bold text-primary-dark">{money(totals.finalTotal)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/m/sell/sales" className="inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium text-slate-600 hover:bg-slate-100">
            {c('cancel')}
          </Link>
          <Button type="submit" size="lg" disabled={save.isPending || hasReturn}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {save.isPending ? c('saving') : t('save')}
          </Button>
        </div>
      </div>
    </form>
  );
}

function Cell({ label, value, tone = 'plain' }: { label: string; value: string; tone?: 'plain' | 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-600' : 'text-slate-800';
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-base font-semibold ${color}`}>{value}</p>
    </div>
  );
}
