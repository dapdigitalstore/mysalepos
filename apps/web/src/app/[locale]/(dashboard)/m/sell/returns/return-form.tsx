'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { Link, useRouter } from '@/i18n/routing';
import { api, ApiError } from '@/lib/client-api';
import { cn, formatMoney } from '@/lib/utils';
import { cmp, parseDec, previewTotals, toFixed } from './decimal-math';
import { customerLabel, formatDateTime, type Lookup, type LookupLine } from './return-types';

type QtyError = 'number' | 'decimal' | 'max';

/** The quantity rules of the API (`resolveReturnQuantities`), checked while typing. */
function quantityError(value: string, line: LookupLine): QtyError | null {
  const v = value.trim();
  if (v === '') return null;
  const q = parseDec(v);
  if (!q || q.n < BigInt(0) || q.s > 4) return 'number';
  if (!line.allowDecimal && q.n % BigInt(10) ** BigInt(q.s) !== BigInt(0)) return 'decimal';
  const sold = parseDec(line.quantity);
  if (sold && cmp(q, sold) > 0) return 'max';
  return null;
}

function buildSchema(lines: LookupLine[]) {
  return z
    .object({
      invoiceNo: z.string().trim().max(191),
      discountType: z.enum(['', 'fixed', 'percentage']),
      discountAmount: z.string().trim(),
      quantities: z.array(z.string()),
    })
    .superRefine((v, ctx) => {
      v.quantities.forEach((q, i) => {
        const err = quantityError(q, lines[i]);
        if (err) ctx.addIssue({ code: 'custom', path: ['quantities', i], message: err });
      });
      if (v.discountType !== '') {
        const a = parseDec(v.discountAmount === '' ? '0' : v.discountAmount);
        if (!a || a.n < BigInt(0)) ctx.addIssue({ code: 'custom', path: ['discountAmount'], message: 'number' });
        else if (v.discountType === 'percentage' && cmp(a, { n: BigInt(100), s: 0 }) > 0) ctx.addIssue({ code: 'custom', path: ['discountAmount'], message: 'percent' });
      }
    });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

/** Laravel: sell_return/add. Set the returned quantity per line; the discount and the tax follow the sale. */
export function ReturnForm({ data }: { data: Lookup }) {
  const t = useTranslations('sellReturns');
  const c = useTranslations('common');
  const locale = useLocale();
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const { sale, existingReturn, form: defaults, lines } = data;

  const schema = useMemo(() => buildSchema(lines), [lines]);
  const {
    register,
    handleSubmit,
    control,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      invoiceNo: defaults.invoiceNo ?? '',
      discountType: defaults.discountType === 'fixed' || defaults.discountType === 'percentage' ? defaults.discountType : '',
      discountAmount: defaults.discountAmount === '0' ? '' : defaults.discountAmount,
      quantities: lines.map((l) => (existingReturn && l.quantityReturned !== '0' ? l.quantityReturned : '')),
    },
  });

  const watched = useWatch({ control });
  const totals = previewTotals(
    lines.map((l, i) => ({ quantity: watched.quantities?.[i] ?? '', unitPrice: l.unitPriceIncTax })),
    watched.discountType ?? '',
    watched.discountAmount ?? '',
    defaults.taxRate,
  );
  const anyQty = (watched.quantities ?? []).some((q) => {
    const d = parseDec(q);
    return d !== null && d.n > BigInt(0);
  });

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body = {
        saleId: sale.id,
        products: lines.map((l, i) => {
          const q = parseDec(v.quantities[i] === '' ? '0' : v.quantities[i]);
          return { sellLineId: l.sellLineId, quantity: Number(toFixed(q ?? { n: BigInt(0), s: 0 }, 4)) };
        }),
        discountType: v.discountType,
        discountAmount: v.discountType === '' ? 0 : Number(toFixed(parseDec(v.discountAmount === '' ? '0' : v.discountAmount) ?? { n: BigInt(0), s: 0 }, 4)),
        invoiceNo: v.invoiceNo || undefined,
      };
      return existingReturn
        ? api<{ id: number }>(`/sell-returns/${existingReturn.id}`, { method: 'PUT', body })
        : api<{ id: number }>('/sell-returns', { method: 'POST', body });
    },
    onSuccess: (r) => {
      toast.success(t('saved'));
      void qc.invalidateQueries({ queryKey: ['sell-returns'] });
      router.push(`/m/sell/returns/${r.id}`);
    },
    onError: (e) => toast.error(e instanceof ApiError && e.messages[0] ? e.messages[0] : c('somethingWrong')),
  });

  const onValid = (v: FormValues) => {
    if (!v.quantities.some((q) => (parseDec(q)?.n ?? BigInt(0)) > BigInt(0)) && !existingReturn) {
      toast.error(t('nothingToReturn'));
      return;
    }
    save.mutate(v);
  };

  const fillAll = () => lines.forEach((l, i) => setValue(`quantities.${i}`, l.quantity, { shouldDirty: true, shouldValidate: true }));
  const clearAll = () => lines.forEach((_, i) => setValue(`quantities.${i}`, '', { shouldDirty: true, shouldValidate: true }));
  const hasErrors = Object.keys(errors).length > 0;

  const qtyMessage = (e: string | undefined, line: LookupLine) =>
    e === 'max' ? t('errMax', { qty: line.quantity, unit: line.unitName }) : e === 'decimal' ? t('errDecimal') : e ? t('errNumber') : undefined;

  return (
    <form onSubmit={handleSubmit(onValid)} noValidate>
      <Card className="mb-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">{t('parentSale')}</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Info label={t('saleInvoice')} value={sale.invoiceNo ?? `#${sale.id}`} />
          <Info label={t('saleDate')} value={formatDateTime(sale.transactionDate, data.timeZone, locale)} />
          <Info label={t('customer')} value={customerLabel(sale) || t('walkIn')} />
          <Info label={t('location')} value={sale.locationName ?? '-'} />
        </dl>
      </Card>

      {existingReturn && <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{t('editNote')}</p>}

      <Card className="mb-4">
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <Field label={t('returnInvoiceNo')} htmlFor="return-invoice-no" hint={t('returnInvoiceHint')} error={errors.invoiceNo ? c('required') : undefined}>
            <Input id="return-invoice-no" {...register('invoiceNo')} autoComplete="off" />
          </Field>
          <Field label={t('returnDate')} htmlFor="return-date">
            <Input id="return-date" value={formatDateTime(defaults.transactionDate, data.timeZone, locale)} readOnly />
          </Field>
        </div>

        <div className="mb-2 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={fillAll}>
            {t('returnAll')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
            {t('clearAll')}
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-start text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-semibold">#</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold">{t('product')}</th>
                <th scope="col" className="px-3 py-2 text-end font-semibold">{t('unitPrice')}</th>
                <th scope="col" className="px-3 py-2 text-end font-semibold">{t('sold')}</th>
                <th scope="col" className="w-44 px-3 py-2 text-start font-semibold">{t('returnQty')}</th>
                <th scope="col" className="px-3 py-2 text-end font-semibold">{t('returnSubtotal')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l, i) => {
                const err = (errors.quantities?.[i] as { message?: string } | undefined)?.message;
                return (
                  <tr key={l.sellLineId} className="align-top">
                    <td className="px-3 py-3 text-slate-500">{i + 1}</td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-slate-900">
                        {l.productName}
                        {l.variationName && <span className="font-normal text-slate-600"> - {l.variationName}</span>}
                      </div>
                      <div className="text-xs text-slate-500">{l.sku}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-end">{formatMoney(l.unitPriceIncTax)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-end">
                      {l.quantity} {l.unitName}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <Input
                          {...register(`quantities.${i}`)}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="0"
                          aria-label={`${t('returnQty')}: ${l.productName}`}
                          aria-invalid={err ? true : undefined}
                          className={cn('text-end', err && 'border-red-500 focus:border-red-500 focus:ring-red-200')}
                        />
                        <span className="text-xs text-slate-500">{l.unitName}</span>
                      </div>
                      {err ? (
                        <p role="alert" className="mt-1 text-xs text-red-600">
                          {qtyMessage(err, l)}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-slate-400">{t('maxQty', { qty: l.quantity, unit: l.unitName })}</p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-end font-medium">{formatMoney(totals.lines[i] ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mb-4">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="grid gap-4 sm:grid-cols-2 md:content-start">
            <Field label={t('discountType')} htmlFor="return-discount-type">
              <Select
                id="return-discount-type"
                {...register('discountType', {
                  onChange: () => {
                    if (getValues('discountType') === '') setValue('discountAmount', '');
                  },
                })}
              >
                <option value="">{t('discountNone')}</option>
                <option value="fixed">{t('discountFixed')}</option>
                <option value="percentage">{t('discountPercentage')}</option>
              </Select>
            </Field>
            <Field
              label={t('discountAmount')}
              htmlFor="return-discount-amount"
              error={errors.discountAmount ? (errors.discountAmount.message === 'percent' ? t('errMax', { qty: '100', unit: '%' }) : t('errNumber')) : undefined}
            >
              <Input id="return-discount-amount" {...register('discountAmount')} inputMode="decimal" autoComplete="off" disabled={watched.discountType === ''} className="text-end" />
            </Field>
          </div>

          <dl className="space-y-2 text-sm" aria-live="polite">
            <Row label={t('netTotal')} value={formatMoney(totals.totalBeforeTax)} />
            <Row label={`${t('totalDiscount')}${watched.discountType === 'percentage' && watched.discountAmount ? ` (${watched.discountAmount}%)` : ''}`} value={`(-) ${formatMoney(totals.discount)}`} />
            <Row label={`${t('totalTax')}${defaults.taxName ? ` - ${defaults.taxName} (${defaults.taxRate}%)` : ''}`} value={`(+) ${formatMoney(totals.tax)}`} />
            <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900">
              <dt>{t('returnTotal')}</dt>
              <dd>{formatMoney(totals.finalTotal)}</dd>
            </div>
          </dl>
        </div>
      </Card>

      {sale.locationName && <p className="mb-4 text-xs text-slate-500">{t('stockNote', { location: sale.locationName })}</p>}
      {hasErrors && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {t('fixErrors')}
        </p>
      )}
      {!anyQty && !existingReturn && <p className="mb-4 text-sm text-slate-500">{t('nothingToReturn')}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/m/sell/returns" className="text-sm text-slate-500 hover:text-slate-800 hover:underline">
          {t('backToList')}
        </Link>
        <Button type="submit" size="lg" disabled={save.isPending}>
          {save.isPending ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-slate-700">
      <dt>{label}</dt>
      <dd className="whitespace-nowrap">{value}</dd>
    </div>
  );
}
