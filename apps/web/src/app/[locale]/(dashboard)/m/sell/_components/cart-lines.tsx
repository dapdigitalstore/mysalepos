'use client';

import { Minus, Plus, StickyNote, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/form-field';
import { cn, formatMoney } from '@/lib/utils';
import { allowsDecimal, availableIn, lineIssues, type CartLine, type CartTotals, type LineIssue } from '../_lib/cart';
import { add, cmp, dec, isPos, mulDiv, ONE, toFixed, toText } from '../_lib/decimal';
import type { SaleSettings } from '../_lib/sale-types';
import { flag } from './use-sale-settings';

interface Props {
  lines: CartLine[];
  settings: SaleSettings;
  totals: CartTotals;
  /** `pos`: stacked rows for the narrow cart pane. `table`: a classic table for the add / edit sale form. */
  variant: 'pos' | 'table';
  /** Drafts and quotations skip the stock check. */
  checkStock: boolean;
  onUpdate: (key: string, patch: Partial<CartLine>) => void;
  onRemove: (key: string) => void;
  onUnit: (key: string, subUnitId: number | null) => void;
}

const numeric = (v: string): string => v.replace(/[^\d.]/g, '');

export function CartLines({ lines, settings, totals, variant, checkStock, onUpdate, onRemove, onUnit }: Props) {
  const t = useTranslations('pos');
  const cp = settings.business.currencyPrecision;
  const allowOverselling = !!settings.posSettings.allow_overselling;
  const editableSubtotal = variant === 'pos' && flag(settings.posSettings.is_pos_subtotal_editable);

  if (lines.length === 0) {
    return (
      <div className="flex min-h-[160px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 p-6 text-center">
        <p className="text-sm font-medium text-slate-700">{t('cartEmpty')}</p>
        <p className="mt-1 text-xs text-slate-500">{t('cartEmptyHint')}</p>
      </div>
    );
  }

  if (variant === 'pos') {
    return (
      <ul className="space-y-2" aria-label={t('cart')}>
        {lines.map((l, i) => {
          const math = totals.lines[i];
          const issues = lineIssues(l, { checkStock, allowOverselling });
          return (
            <li key={l.key} className={cn('rounded-lg border bg-white p-2.5', issues.length ? 'border-red-300' : 'border-slate-200')}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900" title={l.name}>
                    {l.name}
                  </p>
                  <StockInfo line={l} />
                </div>
                {editableSubtotal ? (
                  <SubtotalInput line={l} value={toFixed(math.lineTotal, cp)} unitIncTax={math.unitPriceIncTax} onUpdate={onUpdate} />
                ) : (
                  <p className="shrink-0 text-sm font-semibold text-slate-900">{formatMoney(toFixed(math.lineTotal, cp))}</p>
                )}
                <button
                  type="button"
                  onClick={() => onRemove(l.key)}
                  className="-me-1 -mt-1 rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  aria-label={t('removeLine', { name: l.name })}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <LabeledCell label={t('qty')}>
                  <QtyCell line={l} onUpdate={onUpdate} />
                </LabeledCell>
                <LabeledCell label={t('price')}>
                  <PriceCell line={l} onUpdate={onUpdate} incTax={l.taxId !== null ? formatMoney(toFixed(math.unitPriceIncTax, cp)) : undefined} />
                </LabeledCell>
                {l.canEditDiscount && (
                  <LabeledCell label={t('discount')}>
                    <DiscountCell line={l} onUpdate={onUpdate} />
                  </LabeledCell>
                )}
                {l.subUnits.length > 0 && settings.business.enableSubUnits && (
                  <LabeledCell label={t('unit')}>
                    <UnitCell line={l} onUnit={onUnit} />
                  </LabeledCell>
                )}
                {settings.business.enableInlineTax && (
                  <LabeledCell label={t('tax')}>
                    <TaxCell line={l} settings={settings} onUpdate={onUpdate} />
                  </LabeledCell>
                )}
                {l.lots.length > 0 && (
                  <LabeledCell label={t('lot')}>
                    <LotCell line={l} onUpdate={onUpdate} />
                  </LabeledCell>
                )}
              </div>
              <NoteRow line={l} onUpdate={onUpdate} />
              <Issues issues={issues} line={l} />
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-start text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-2 py-2 text-start font-semibold">#</th>
            <th scope="col" className="px-2 py-2 text-start font-semibold">{t('product')}</th>
            <th scope="col" className="w-36 px-2 py-2 text-start font-semibold">{t('qty')}</th>
            <th scope="col" className="w-24 px-2 py-2 text-start font-semibold">{t('unit')}</th>
            <th scope="col" className="w-28 px-2 py-2 text-start font-semibold">{t('unitPriceExcTax')}</th>
            <th scope="col" className="w-40 px-2 py-2 text-start font-semibold">{t('discount')}</th>
            {settings.business.enableInlineTax && <th scope="col" className="w-32 px-2 py-2 text-start font-semibold">{t('tax')}</th>}
            <th scope="col" className="px-2 py-2 text-end font-semibold">{t('subtotal')}</th>
            <th scope="col" className="w-10 px-2 py-2">
              <span className="sr-only">{t('remove')}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map((l, i) => {
            const math = totals.lines[i];
            const issues = lineIssues(l, { checkStock, allowOverselling });
            return (
              <tr key={l.key} className="align-top">
                <td className="px-2 py-3 text-slate-500">{i + 1}</td>
                <td className="px-2 py-3">
                  <p className="font-medium text-slate-900">{l.name}</p>
                  <StockInfo line={l} />
                  {l.lots.length > 0 && (
                    <div className="mt-1 max-w-[220px]">
                      <LotCell line={l} onUpdate={onUpdate} />
                    </div>
                  )}
                  <NoteRow line={l} onUpdate={onUpdate} />
                  <Issues issues={issues} line={l} />
                </td>
                <td className="px-2 py-3">
                  <QtyCell line={l} onUpdate={onUpdate} />
                </td>
                <td className="px-2 py-3">{l.subUnits.length > 0 && settings.business.enableSubUnits ? <UnitCell line={l} onUnit={onUnit} /> : <span className="text-slate-600">{l.unit.shortName}</span>}</td>
                <td className="px-2 py-3">
                  <PriceCell line={l} onUpdate={onUpdate} />
                </td>
                <td className="px-2 py-3">{l.canEditDiscount ? <DiscountCell line={l} onUpdate={onUpdate} /> : <span className="text-slate-500">-</span>}</td>
                {settings.business.enableInlineTax && (
                  <td className="px-2 py-3">
                    <TaxCell line={l} settings={settings} onUpdate={onUpdate} />
                  </td>
                )}
                <td className="whitespace-nowrap px-2 py-3 text-end font-semibold text-slate-900">{formatMoney(toFixed(math.lineTotal, cp))}</td>
                <td className="px-2 py-3">
                  <button type="button" onClick={() => onRemove(l.key)} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={t('removeLine', { name: l.name })}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ cells

type Update = (key: string, patch: Partial<CartLine>) => void;

function LabeledCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="mb-0.5 block text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </div>
  );
}

function StockInfo({ line }: { line: CartLine }) {
  const t = useTranslations('pos');
  const avail = availableIn(line);
  return (
    <p className="truncate text-xs text-slate-500">
      {line.sku}
      {avail !== null && (
        <span className="ms-2">
          {t('stockLeft', { qty: toText(avail), unit: line.subUnitId !== null ? (line.subUnits.find((s) => s.id === line.subUnitId)?.name ?? line.unit.shortName) : line.unit.shortName })}
        </span>
      )}
    </p>
  );
}

function QtyCell({ line, onUpdate }: { line: CartLine; onUpdate: Update }) {
  const t = useTranslations('pos');
  const step = (delta: 1 | -1) => {
    const q = dec(line.quantity);
    const next = add(q, delta === 1 ? ONE : { n: -1n, s: 0 });
    // never step below one unit; typing a smaller quantity by hand stays possible
    if (delta === -1 && cmp(q, ONE) <= 0) return;
    onUpdate(line.key, { quantity: toText(next) });
  };
  return (
    <div className="flex items-center">
      <button type="button" onClick={() => step(-1)} className="flex h-11 w-9 shrink-0 items-center justify-center rounded-s-lg border border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100" aria-label={t('decrease', { name: line.name })}>
        <Minus className="h-4 w-4" aria-hidden="true" />
      </button>
      <Input
        value={line.quantity}
        onChange={(e) => onUpdate(line.key, { quantity: allowsDecimal(line) ? numeric(e.target.value) : e.target.value.replace(/\D/g, '') })}
        inputMode={allowsDecimal(line) ? 'decimal' : 'numeric'}
        aria-label={t('quantityOf', { name: line.name })}
        className="h-11 min-w-0 rounded-none border-x-0 px-1 text-center"
        onFocus={(e) => e.currentTarget.select()}
      />
      <button type="button" onClick={() => step(1)} className="flex h-11 w-9 shrink-0 items-center justify-center rounded-e-lg border border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100" aria-label={t('increase', { name: line.name })}>
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function UnitCell({ line, onUnit }: { line: CartLine; onUnit: (key: string, subUnitId: number | null) => void }) {
  const t = useTranslations('pos');
  return (
    <Select
      value={line.subUnitId ?? ''}
      onChange={(e) => onUnit(line.key, e.target.value === '' ? null : Number(e.target.value))}
      aria-label={t('unitOf', { name: line.name })}
    >
      <option value="">{line.unit.shortName}</option>
      {line.subUnits.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </Select>
  );
}

function PriceCell({ line, onUpdate, incTax }: { line: CartLine; onUpdate: Update; incTax?: string }) {
  const t = useTranslations('pos');
  return (
    <div>
      {line.canEditPrice ? (
        <Input
          value={line.unitPrice}
          onChange={(e) => onUpdate(line.key, { unitPrice: numeric(e.target.value), priceEdited: true })}
          inputMode="decimal"
          aria-label={t('priceOf', { name: line.name })}
          onFocus={(e) => e.currentTarget.select()}
          className="text-end"
        />
      ) : (
        <p className="flex h-11 items-center justify-end rounded-lg bg-slate-50 px-3 text-sm text-slate-700">{formatMoney(line.unitPrice)}</p>
      )}
      {incTax && <p className="mt-0.5 text-end text-[11px] text-slate-500">{t('incTax', { amount: incTax })}</p>}
    </div>
  );
}

function DiscountCell({ line, onUpdate }: { line: CartLine; onUpdate: Update }) {
  const t = useTranslations('pos');
  return (
    <div className="flex">
      <Input
        value={line.discountAmount === '0' ? '' : line.discountAmount}
        onChange={(e) => onUpdate(line.key, { discountAmount: numeric(e.target.value) || '0' })}
        inputMode="decimal"
        placeholder="0"
        aria-label={t('discountOf', { name: line.name })}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 rounded-e-none text-end"
      />
      <Select
        value={line.discountType}
        onChange={(e) => onUpdate(line.key, { discountType: e.target.value === 'percentage' ? 'percentage' : 'fixed' })}
        aria-label={t('discountTypeOf', { name: line.name })}
        className="w-16 shrink-0 rounded-s-none border-s-0 px-1"
      >
        <option value="fixed">{t('fixedShort')}</option>
        <option value="percentage">%</option>
      </Select>
    </div>
  );
}

function TaxCell({ line, settings, onUpdate }: { line: CartLine; settings: SaleSettings; onUpdate: Update }) {
  const t = useTranslations('pos');
  return (
    <Select value={line.taxId ?? ''} onChange={(e) => onUpdate(line.key, { taxId: e.target.value === '' ? null : Number(e.target.value) })} aria-label={t('taxOf', { name: line.name })}>
      <option value="">{t('noTax')}</option>
      {settings.taxRates.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name} ({r.rate}%)
        </option>
      ))}
    </Select>
  );
}

function LotCell({ line, onUpdate }: { line: CartLine; onUpdate: Update }) {
  const t = useTranslations('pos');
  return (
    <Select value={line.lotNoLineId ?? ''} onChange={(e) => onUpdate(line.key, { lotNoLineId: e.target.value === '' ? null : Number(e.target.value) })} aria-label={t('lotOf', { name: line.name })}>
      <option value="">{t('anyLot')}</option>
      {line.lots.map((lot) => (
        <option key={lot.purchaseLineId} value={lot.purchaseLineId}>
          {lot.lotNumber ?? `#${lot.purchaseLineId}`} ({lot.qtyAvailable})
        </option>
      ))}
    </Select>
  );
}

function NoteRow({ line, onUpdate }: { line: CartLine; onUpdate: Update }) {
  const t = useTranslations('pos');
  const [open, setOpen] = useState(line.note !== '');
  return (
    <div className="mt-1">
      {open ? (
        <Input value={line.note} onChange={(e) => onUpdate(line.key, { note: e.target.value })} placeholder={t('lineNote')} aria-label={t('lineNoteOf', { name: line.name })} maxLength={500} className="h-9 text-xs" />
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-primary-dark">
          <StickyNote className="h-3 w-3" aria-hidden="true" />
          {t('addNote')}
        </button>
      )}
    </div>
  );
}

/** Laravel `is_pos_subtotal_editable`: typing the line total sets the quantity to total / unit price. */
function SubtotalInput({ line, value, unitIncTax, onUpdate }: { line: CartLine; value: string; unitIncTax: ReturnType<typeof dec>; onUpdate: Update }) {
  const t = useTranslations('pos');
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      value={draft ?? value}
      onChange={(e) => {
        const v = numeric(e.target.value);
        setDraft(v);
        if (isPos(unitIncTax) && v !== '') onUpdate(line.key, { quantity: toText(mulDiv(dec(v), ONE, unitIncTax, 4)) });
      }}
      onBlur={() => setDraft(null)}
      inputMode="decimal"
      aria-label={t('subtotalOf', { name: line.name })}
      className="h-9 w-28 shrink-0 text-end font-semibold"
    />
  );
}

function Issues({ issues, line }: { issues: LineIssue[]; line: CartLine }) {
  const t = useTranslations('pos');
  if (issues.length === 0) return null;
  const avail = availableIn(line);
  return (
    <ul className="mt-1 space-y-0.5" role="alert">
      {issues.map((i) => (
        <li key={i} className="text-xs text-red-600">
          {i === 'stock' ? t('issue.stock', { qty: avail ? toText(avail) : '0' }) : t(`issue.${i}`)}
        </li>
      ))}
    </ul>
  );
}
