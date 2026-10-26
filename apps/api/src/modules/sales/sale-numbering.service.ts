import { BadRequestException, Injectable } from '@nestjs/common';
import type { TenantTx } from '../../common/tenant-db';
import { formatReferenceNumber, prefixFor } from '../../common/reference-number';
import { instantToWallClock } from '../../common/time';
import { formatInvoiceNumber, type InvoiceSchemeRow } from './sale.rules';

interface SchemeRaw {
  id: number | bigint;
  scheme_type: 'blank' | 'year';
  number_type: string;
  prefix: string | null;
  start_number: number | bigint | null;
  invoice_count: number | bigint;
  total_digits: number | bigint | null;
}

/** Invoice numbers and reference numbers, taken inside the caller's transaction under a row lock so two requests never get the same number. */
@Injectable()
export class SaleNumberingService {
  /**
   * `TransactionUtil::getInvoiceNumber`.
   *  - final: the invoice scheme (given scheme > the location's scheme > the business default), counter locked and incremented;
   *  - draft / quotation / proforma: the business "draft" reference counter, e.g. 2026/0001.
   */
  async nextInvoiceNumber(
    tx: TenantTx,
    businessId: number,
    timeZone: string,
    refNoPrefixes: string | null,
    status: 'final' | 'draft',
    locationId: number,
    schemeId?: number | null,
    useSaleScheme = false,
  ): Promise<string> {
    const year = instantToWallClock(new Date(), timeZone).getUTCFullYear();
    if (status === 'draft') {
      const count = await this.nextReferenceCount(tx, businessId, 'draft');
      return formatReferenceNumber('draft', count, prefixFor(refNoPrefixes, 'draft'), year);
    }

    const resolvedId = await this.resolveSchemeId(tx, businessId, locationId, schemeId, useSaleScheme);
    const rows = await tx.$queryRaw<SchemeRaw[]>`
      SELECT id, scheme_type, number_type, prefix, start_number, invoice_count, total_digits FROM invoice_schemes
      WHERE id = ${resolvedId} AND business_id = ${businessId} FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new BadRequestException('Invoice scheme not found');
    const scheme: InvoiceSchemeRow = {
      scheme_type: row.scheme_type,
      number_type: row.number_type,
      prefix: row.prefix,
      start_number: row.start_number === null ? null : Number(row.start_number),
      invoice_count: Number(row.invoice_count),
      total_digits: row.total_digits === null ? null : Number(row.total_digits),
    };
    const number = formatInvoiceNumber(scheme, year);
    await tx.invoice_schemes.update({ where: { id: resolvedId }, data: { invoice_count: { increment: 1 }, updated_at: new Date() } });
    return number;
  }

  /** `setAndGetReferenceCount` + `generateReferenceNumber` (sell_payment, draft, ...), e.g. SP2026/0001. */
  async nextReferenceNumber(tx: TenantTx, businessId: number, timeZone: string, refNoPrefixes: string | null, type: string): Promise<string> {
    const count = await this.nextReferenceCount(tx, businessId, type);
    const year = instantToWallClock(new Date(), timeZone).getUTCFullYear();
    return formatReferenceNumber(type, count, prefixFor(refNoPrefixes, type), year);
  }

  private async nextReferenceCount(tx: TenantTx, businessId: number, type: string): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ id: number | bigint; ref_count: number | bigint }>>`
      SELECT id, ref_count FROM reference_counts WHERE ref_type = ${type} AND business_id = ${businessId} FOR UPDATE`;
    const now = new Date();
    if (rows.length > 0) {
      const count = Number(rows[0].ref_count) + 1;
      await tx.reference_counts.update({ where: { id: Number(rows[0].id) }, data: { ref_count: count, updated_at: now } });
      return count;
    }
    await tx.reference_counts.create({ data: { ref_type: type, ref_count: 1, business_id: businessId, created_at: now, updated_at: now } });
    return 1;
  }

  private async resolveSchemeId(tx: TenantTx, businessId: number, locationId: number, schemeId: number | null | undefined, useSaleScheme: boolean): Promise<number> {
    if (schemeId) {
      const s = await tx.invoice_schemes.findFirst({ where: { id: schemeId }, select: { id: true } });
      if (!s) throw new BadRequestException('Invoice scheme not found');
      return s.id;
    }
    const location = await tx.business_locations.findFirst({ where: { id: locationId, deleted_at: null }, select: { invoice_scheme_id: true, sale_invoice_scheme_id: true } });
    const candidate = useSaleScheme && location?.sale_invoice_scheme_id ? location.sale_invoice_scheme_id : location?.invoice_scheme_id;
    if (candidate) {
      const s = await tx.invoice_schemes.findFirst({ where: { id: candidate }, select: { id: true } });
      if (s) return s.id;
    }
    const fallback = await tx.invoice_schemes.findFirst({ where: { is_default: true }, select: { id: true }, orderBy: { id: 'asc' } });
    if (!fallback) throw new BadRequestException({ message: `No invoice scheme found for business ${businessId}`, code: 'NO_INVOICE_SCHEME' });
    return fallback.id;
  }
}
