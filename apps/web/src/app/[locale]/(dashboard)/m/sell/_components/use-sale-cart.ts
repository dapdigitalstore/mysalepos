'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { add as addDec, dec, ONE, toText } from '../_lib/decimal';
import { increasesExisting, lineFromRow, mergeIntoCart, withSubUnit, type CartLine, type SaleHeader } from '../_lib/cart';
import { saleApi } from '../_lib/sale-api';
import type { ProductRow, SaleSettings } from '../_lib/sale-types';

interface Options {
  settings: SaleSettings;
  isDirectSale: boolean;
  header: Pick<SaleHeader, 'locationId' | 'customer' | 'priceGroupId'>;
  /** Drafts and quotations may hold products that are out of stock. */
  draftLike: boolean;
  onError: (e: unknown) => void;
  /** Lines to start with (a stored sale being edited). */
  initialLines?: CartLine[];
}

/** Cart state + the calls that fill it (product-row defaults, price refresh on customer / price group change). */
export function useSaleCart({ settings, isDirectSale, header, draftLike, onError, initialLines }: Options) {
  const [lines, setLines] = useState<CartLine[]>(() => initialLines ?? []);
  const [pending, setPending] = useState(0);
  const linesRef = useRef(lines);
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  const flags = useCallback(
    () => ({
      canEditPrice: isDirectSale ? settings.permissions.canEditPrice.direct : settings.permissions.canEditPrice.pos,
      canEditDiscount: isDirectSale ? settings.permissions.canEditLineDiscount.direct : settings.permissions.canEditLineDiscount.pos,
      inlineTax: settings.business.enableInlineTax,
    }),
    [settings, isDirectSale],
  );

  /** Adds one unit of a variation. Resolves true when the cart changed. */
  const add = useCallback(
    async (variationId: number): Promise<boolean> => {
      if (header.locationId === null) return false;
      const existing = linesRef.current.find((l) => l.variationId === variationId && l.subUnitId === null && l.lotNoLineId === null);
      if (existing && increasesExisting(settings)) {
        setLines((cur) => cur.map((l) => (l.key === existing.key ? { ...l, quantity: toText(addDec(dec(l.quantity), ONE)) } : l)));
        return true;
      }
      setPending((n) => n + 1);
      try {
        const row = await saleApi<ProductRow>('/sales/product-row', {
          query: {
            variationId,
            locationId: header.locationId,
            contactId: header.customer?.id,
            priceGroupId: header.priceGroupId,
            quantity: '1',
            isDraft: draftLike,
            isDirectSale,
          },
        });
        const line = lineFromRow(row, { quantity: '1', ...flags() });
        setLines((cur) => mergeIntoCart(cur, line, increasesExisting(settings)));
        return true;
      } catch (e) {
        onError(e);
        return false;
      } finally {
        setPending((n) => n - 1);
      }
    },
    [header.locationId, header.customer?.id, header.priceGroupId, settings, draftLike, isDirectSale, flags, onError],
  );

  const update = useCallback((key: string, patch: Partial<CartLine>) => {
    setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }, []);

  const remove = useCallback((key: string) => setLines((cur) => cur.filter((l) => l.key !== key)), []);

  const changeUnit = useCallback((key: string, subUnitId: number | null) => {
    setLines((cur) => cur.map((l) => (l.key === key ? withSubUnit(l, subUnitId) : l)));
  }, []);

  /**
   * After the customer or the selling price group changed: ask the API for the catalogue price again and apply it to every new line
   * whose price the cashier did not type in. Failures leave the line as it is.
   */
  const reprice = useCallback(
    async (next: Pick<SaleHeader, 'locationId' | 'customer' | 'priceGroupId'>) => {
      const current = linesRef.current.filter((l) => !l.priceEdited && l.id === undefined);
      if (current.length === 0 || next.locationId === null) return;
      setPending((n) => n + 1);
      try {
        const rows = await Promise.all(
          current.map(async (l) => {
            try {
              const row = await saleApi<ProductRow>('/sales/product-row', {
                query: {
                  variationId: l.variationId,
                  locationId: next.locationId,
                  contactId: next.customer?.id,
                  priceGroupId: next.priceGroupId,
                  quantity: l.quantity,
                  isDraft: true,
                  isDirectSale,
                },
              });
              return [l.key, row] as const;
            } catch {
              return null;
            }
          }),
        );
        const byKey = new Map(rows.filter((r): r is readonly [string, ProductRow] => r !== null));
        setLines((cur) =>
          cur.map((l) => {
            const row = byKey.get(l.key);
            if (!row || l.priceEdited) return l;
            // `withSubUnit` rescales from the base price, so keep the unit the cashier chose
            const base: CartLine = { ...l, unitPrice: row.unitPrice, basePrice: row.unitPrice, subUnitId: null };
            return withSubUnit(base, l.subUnitId);
          }),
        );
      } finally {
        setPending((n) => n - 1);
      }
    },
    [isDirectSale],
  );

  const clear = useCallback(() => setLines([]), []);

  return { lines, setLines, add, update, remove, changeUnit, reprice, clear, adding: pending > 0 };
}
