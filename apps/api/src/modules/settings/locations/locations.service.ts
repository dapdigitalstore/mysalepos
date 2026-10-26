import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ReferenceService } from '../../../common/reference.service';
import type { AuthUser } from '../../../common/types';
import { PrismaService } from '../../../prisma/prisma.service';
import { permittedLocationIds } from './location-access';
import { LocationDto } from './location.dto';

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService, private readonly reference: ReferenceService) {}

  async list(user: AuthUser, search?: string) {
    return this.prisma.forTenant(user.businessId).business_locations.findMany({
      where: {
        deleted_at: null,
        ...(search ? { OR: [{ name: { contains: search } }, { location_id: { contains: search } }, { city: { contains: search } }] } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  /** Active locations the user may work with (what product, purchase and sale forms show). */
  async options(user: AuthUser) {
    const permitted = permittedLocationIds(user);
    const rows = await this.prisma.forTenant(user.businessId).business_locations.findMany({
      where: { deleted_at: null, is_active: true, ...(permitted === 'all' ? {} : { id: { in: permitted } }) },
      orderBy: { name: 'asc' },
    });
    return rows.map((l) => ({ id: l.id, label: l.name, code: l.location_id, sellingPriceGroupId: l.selling_price_group_id }));
  }

  async get(user: AuthUser, id: number) {
    const loc = await this.prisma.forTenant(user.businessId).business_locations.findFirst({ where: { id, deleted_at: null } });
    if (!loc) throw new NotFoundException('Location not found');
    return loc;
  }

  /**
   * What a printed receipt/invoice header needs (address, contacts, tax numbers, layout texts). Open to every signed-in user
   * with access to the location, because cashiers print too (the full location/settings endpoints need business_settings.access).
   */
  async printInfo(user: AuthUser, id: number) {
    const permitted = permittedLocationIds(user);
    if (permitted !== 'all' && !permitted.includes(id)) throw new NotFoundException('Location not found');
    const db = this.prisma.forTenant(user.businessId);
    const loc = await db.business_locations.findFirst({ where: { id, deleted_at: null } });
    if (!loc) throw new NotFoundException('Location not found');
    const [business, layout] = await Promise.all([
      this.prisma.business.findUnique({ where: { id: user.businessId }, select: { name: true, tax_label_1: true, tax_number_1: true, tax_label_2: true, tax_number_2: true } }),
      db.invoice_layouts.findFirst({ where: { id: loc.invoice_layout_id }, select: { header_text: true, footer_text: true } }),
    ]);
    return {
      location: {
        name: loc.name, landmark: loc.landmark, city: loc.city, state: loc.state, country: loc.country, zipCode: loc.zip_code.trim(),
        mobile: loc.mobile, alternateNumber: loc.alternate_number, email: loc.email, website: loc.website,
      },
      business: {
        name: business?.name ?? '',
        taxLabel1: business?.tax_label_1 ?? null, taxNumber1: business?.tax_number_1 ?? null,
        taxLabel2: business?.tax_label_2 ?? null, taxNumber2: business?.tax_number_2 ?? null,
      },
      layout: { headerText: layout?.header_text ?? null, footerText: layout?.footer_text ?? null },
    };
  }

  async checkLocationId(user: AuthUser, locationId: string, exceptId?: number) {
    const count = await this.prisma.forTenant(user.businessId).business_locations.count({
      where: { location_id: locationId, deleted_at: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    return { available: count === 0 };
  }

  async create(user: AuthUser, dto: LocationDto) {
    await this.assertLookups(user, dto);
    const code = dto.locationId?.trim() || (await this.reference.next(user.businessId, 'business_location')).number;
    await this.assertCodeFree(user, code);
    const now = new Date();
    const location = await this.prisma.forTenant(user.businessId).business_locations.create({
      data: { business_id: user.businessId, location_id: code, ...this.columns(dto), created_at: now, updated_at: now },
    });
    // Laravel keeps one permission per location (location.<id>) so roles can grant access to it.
    await this.prisma.$executeRaw`
      INSERT INTO permissions (name, guard_name, created_at, updated_at)
      SELECT ${`location.${location.id}`}, 'web', NOW(), NOW() FROM DUAL
      WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = ${`location.${location.id}`})`;
    return location;
  }

  async update(user: AuthUser, id: number, dto: LocationDto) {
    await this.get(user, id);
    await this.assertLookups(user, dto);
    const code = dto.locationId?.trim();
    if (code) await this.assertCodeFree(user, code, id);
    return this.prisma.forTenant(user.businessId).business_locations.update({
      where: { id },
      data: { ...(code ? { location_id: code } : {}), ...this.columns(dto), updated_at: new Date() },
    });
  }

  async toggleActive(user: AuthUser, id: number) {
    const loc = await this.get(user, id);
    return this.prisma.forTenant(user.businessId).business_locations.update({
      where: { id },
      data: { is_active: !loc.is_active, updated_at: new Date() },
    });
  }

  private columns(dto: LocationDto) {
    return {
      name: dto.name,
      landmark: dto.landmark ?? null,
      country: dto.country,
      state: dto.state,
      city: dto.city,
      zip_code: dto.zipCode,
      invoice_scheme_id: dto.invoiceSchemeId,
      invoice_layout_id: dto.invoiceLayoutId,
      sale_invoice_scheme_id: dto.saleInvoiceSchemeId ?? null,
      sale_invoice_layout_id: dto.saleInvoiceLayoutId ?? null,
      selling_price_group_id: dto.sellingPriceGroupId ?? null,
      mobile: dto.mobile ?? null,
      alternate_number: dto.alternateNumber ?? null,
      email: dto.email ?? null,
      website: dto.website ?? null,
      custom_field1: dto.customField1 ?? null,
      custom_field2: dto.customField2 ?? null,
      custom_field3: dto.customField3 ?? null,
      custom_field4: dto.customField4 ?? null,
    };
  }

  private async assertCodeFree(user: AuthUser, code: string, exceptId?: number) {
    if (!(await this.checkLocationId(user, code, exceptId)).available) throw new ConflictException('This location id is already in use');
  }

  /** Invoice scheme/layout must belong to this business (they are tenant tables). */
  private async assertLookups(user: AuthUser, dto: LocationDto) {
    const db = this.prisma.forTenant(user.businessId);
    const schemeIds = [dto.invoiceSchemeId, dto.saleInvoiceSchemeId].filter((x): x is number => !!x);
    const layoutIds = [dto.invoiceLayoutId, dto.saleInvoiceLayoutId].filter((x): x is number => !!x);
    const [schemes, layouts] = await Promise.all([
      db.invoice_schemes.count({ where: { id: { in: schemeIds } } }),
      db.invoice_layouts.count({ where: { id: { in: layoutIds } } }),
    ]);
    if (schemes !== new Set(schemeIds).size) throw new BadRequestException('Invoice scheme not found');
    if (layouts !== new Set(layoutIds).size) throw new BadRequestException('Invoice layout not found');
  }
}
