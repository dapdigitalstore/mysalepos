/**
 * The permissions a role can hold, grouped like Laravel's "Add role" screen (resources/views/role/create.blade.php).
 * Names are the exact strings of the Spatie `permissions` table, so roles written here keep working in Laravel.
 *
 * Not part of the catalog on purpose (never granted through a role):
 *  - `access_all_locations` and `location.<id>`: granted per user (see user location access).
 *  - `superadmin`: only the configured administrators.
 *  - legacy rows (`expense.access`, `list_drafts`, `list_quotations`) and module rows (`woocommerce.*`, `essentials.*`, ...):
 *    roles that already hold them keep them (see mergeRolePermissions) but they cannot be newly granted here.
 */

export interface CatalogItem {
  /** Permission name stored in `permissions.name`. */
  name: string;
  /** English label (Laravel wording). The web app translates by permission name and falls back to this. */
  label: string;
  /** Items sharing a radio key are mutually exclusive (Laravel renders them as radio buttons). */
  radio?: string;
  /** Pre-ticked on the "add role" form. */
  default?: boolean;
  /** Item is shown only when the business has ANY of these modules enabled (business.enabled_modules). */
  modules?: string[];
}

export interface CatalogGroup {
  key: string;
  label: string;
  /** Group is shown only when the business has ANY of these modules enabled. */
  modules?: string[];
  /** Group is shown only when this business setting is truthy. */
  setting?: { in: 'common' | 'pos'; key: string };
  items: CatalogItem[];
}

const c = (name: string, label: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({ name, label, ...extra });
const r = (radio: string, name: string, label: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({ name, label, radio, ...extra });

export const PERMISSION_GROUPS: readonly CatalogGroup[] = [
  { key: 'others', label: 'Others', items: [c('view_export_buttons', 'View export to buttons (csv/excel/print/pdf) on tables')] },
  {
    key: 'user',
    label: 'User',
    items: [c('user.view', 'View user'), c('user.create', 'Add user'), c('user.update', 'Edit user'), c('user.delete', 'Delete user')],
  },
  {
    key: 'roles',
    label: 'Roles',
    items: [c('roles.view', 'View role'), c('roles.create', 'Add role'), c('roles.update', 'Edit role'), c('roles.delete', 'Delete role')],
  },
  {
    key: 'supplier',
    label: 'Supplier',
    items: [
      r('supplier_view', 'supplier.view', 'View all supplier'),
      r('supplier_view', 'supplier.view_own', 'View own supplier'),
      c('supplier.create', 'Add supplier'),
      c('supplier.update', 'Edit supplier'),
      c('supplier.delete', 'Delete supplier'),
    ],
  },
  {
    key: 'customer',
    label: 'Customer',
    items: [
      r('customer_view', 'customer.view', 'View all customer'),
      r('customer_view', 'customer.view_own', 'View own customer'),
      r('customer_view_by_sell', 'customer_with_no_sell_one_month', 'View customers with no sell from one month only'),
      r('customer_view_by_sell', 'customer_with_no_sell_three_month', 'View customers with no sell from three months only'),
      r('customer_view_by_sell', 'customer_with_no_sell_six_month', 'View customers with no sell from six months only'),
      r('customer_view_by_sell', 'customer_with_no_sell_one_year', 'View customers with no sell from one year only'),
      r('customer_view_by_sell', 'customer_irrespective_of_sell', 'View customers irrespective of their sell'),
      c('customer.create', 'Add customer'),
      c('customer.update', 'Edit customer'),
      c('customer.delete', 'Delete customer'),
    ],
  },
  {
    key: 'product',
    label: 'Product',
    items: [
      c('product.view', 'View product'),
      c('product.create', 'Add product'),
      c('product.update', 'Edit product'),
      c('product.delete', 'Delete product'),
      c('product.opening_stock', 'Add opening stock'),
      c('view_purchase_price', 'View purchase price'),
    ],
  },
  {
    key: 'purchase',
    label: 'Purchase & stock adjustment',
    modules: ['purchases', 'stock_adjustment'],
    items: [
      r('purchase_view', 'purchase.view', 'View all purchase & stock adjustment'),
      r('purchase_view', 'view_own_purchase', 'View own purchase & stock adjustment'),
      c('purchase.create', 'Add purchase & stock adjustment'),
      c('purchase.update', 'Edit purchase & stock adjustment'),
      c('purchase.delete', 'Delete purchase & stock adjustment'),
      c('purchase.payments', 'Add purchase payment'),
      c('edit_purchase_payment', 'Edit purchase payment'),
      c('delete_purchase_payment', 'Delete purchase payment'),
      c('purchase.update_status', 'Update status'),
    ],
  },
  {
    key: 'purchase_requisition',
    label: 'Purchase requisition',
    setting: { in: 'common', key: 'enable_purchase_requisition' },
    items: [
      r('purchase_requisition_view', 'purchase_requisition.view_all', 'View all purchase requisition'),
      r('purchase_requisition_view', 'purchase_requisition.view_own', 'View own purchase requisition'),
      c('purchase_requisition.create', 'Create purchase requisition'),
      c('purchase_requisition.delete', 'Delete purchase requisition'),
    ],
  },
  {
    key: 'purchase_order',
    label: 'Purchase order',
    setting: { in: 'common', key: 'enable_purchase_order' },
    items: [
      r('purchase_order_view', 'purchase_order.view_all', 'View all purchase order'),
      r('purchase_order_view', 'purchase_order.view_own', 'View own purchase order'),
      c('purchase_order.create', 'Create purchase order'),
      c('purchase_order.update', 'Edit purchase order'),
      c('purchase_order.delete', 'Delete purchase order'),
    ],
  },
  {
    key: 'pos_sale',
    label: 'POS',
    items: [
      c('sell.view', 'View POS sell', { modules: ['pos_sale'] }),
      c('sell.create', 'Add POS sell', { modules: ['pos_sale'] }),
      c('sell.update', 'Edit POS sell'),
      c('sell.delete', 'Delete POS sell'),
      c('edit_product_price_from_pos_screen', 'Edit product price from POS screen'),
      c('edit_product_discount_from_pos_screen', 'Edit product discount from POS screen'),
      c('edit_pos_payment', 'Add/Edit payment'),
      c('print_invoice', 'Print invoice'),
      c('disable_pay_checkout', 'Disable multiple pay'),
      c('disable_draft', 'Disable draft'),
      c('disable_express_checkout', 'Disable express checkout'),
      c('disable_discount', 'Disable discount'),
      c('disable_suspend_sale', 'Disable suspend sale'),
      c('disable_credit_sale', 'Disable credit sale button'),
      c('disable_quotation', 'Disable quotation'),
      c('disable_card', 'Disable card'),
    ],
  },
  {
    key: 'sale',
    label: 'Sell',
    items: [
      r('sell_view', 'direct_sell.view', 'View all sell', { modules: ['add_sale'] }),
      r('sell_view', 'view_own_sell_only', 'View own sell only', { modules: ['add_sale'] }),
      c('view_paid_sells_only', 'View paid sells only', { modules: ['add_sale'] }),
      c('view_due_sells_only', 'View due sells only', { modules: ['add_sale'] }),
      c('view_partial_sells_only', 'View partially paid sells only', { modules: ['add_sale'] }),
      c('view_overdue_sells_only', 'View overdue sells only', { modules: ['add_sale'] }),
      c('direct_sell.access', 'Add sell', { modules: ['add_sale'] }),
      c('direct_sell.update', 'Update sell', { modules: ['add_sale'] }),
      c('direct_sell.delete', 'Delete sell', { modules: ['add_sale'] }),
      c('view_commission_agent_sell', 'Commission agent can view their own sell'),
      c('sell.payments', 'Add sell payment'),
      c('edit_sell_payment', 'Edit sell payment'),
      c('delete_sell_payment', 'Delete sell payment'),
      c('edit_product_price_from_sale_screen', 'Edit product price from sales screen'),
      c('edit_product_discount_from_sale_screen', 'Edit product discount from sale screen'),
      c('discount.access', 'Add/Edit/Delete discount'),
      c('access_types_of_service', 'Access types of service', { modules: ['types_of_service'] }),
      c('access_sell_return', 'Access all sell return'),
      c('access_own_sell_return', 'Access own sell return'),
      c('edit_invoice_number', 'Add/edit invoice number'),
    ],
  },
  {
    key: 'sales_order',
    label: 'Sales order',
    setting: { in: 'pos', key: 'enable_sales_order' },
    items: [
      r('so_view', 'so.view_all', 'View all sales order'),
      r('so_view', 'so.view_own', 'View own sales order'),
      c('so.create', 'Create sales order'),
      c('so.update', 'Edit sales order'),
      c('so.delete', 'Delete sales order'),
    ],
  },
  {
    key: 'draft',
    label: 'Draft',
    items: [
      r('draft_view', 'draft.view_all', 'View all drafts'),
      r('draft_view', 'draft.view_own', 'View own drafts'),
      c('draft.update', 'Edit draft'),
      c('draft.delete', 'Delete draft'),
    ],
  },
  {
    key: 'quotation',
    label: 'Quotation',
    items: [
      r('quotation_view', 'quotation.view_all', 'View all quotations'),
      r('quotation_view', 'quotation.view_own', 'View own quotations'),
      c('quotation.update', 'Edit quotation'),
      c('quotation.delete', 'Delete quotation'),
    ],
  },
  {
    key: 'shipments',
    label: 'Shipments',
    items: [
      r('shipping_view', 'access_shipping', 'Access all shipments'),
      r('shipping_view', 'access_own_shipping', 'Access own shipments'),
      c('access_pending_shipments_only', 'Access pending shipments only'),
      c('access_commission_agent_shipping', 'Commission agent can access their own shipments'),
    ],
  },
  {
    key: 'cash_register',
    label: 'Cash register',
    items: [c('view_cash_register', 'View cash register'), c('close_cash_register', 'Close cash register')],
  },
  {
    key: 'brand',
    label: 'Brand',
    items: [c('brand.view', 'View brand'), c('brand.create', 'Add brand'), c('brand.update', 'Edit brand'), c('brand.delete', 'Delete brand')],
  },
  {
    key: 'tax_rate',
    label: 'Tax rate',
    items: [c('tax_rate.view', 'View tax rate'), c('tax_rate.create', 'Add tax rate'), c('tax_rate.update', 'Edit tax rate'), c('tax_rate.delete', 'Delete tax rate')],
  },
  {
    key: 'unit',
    label: 'Unit',
    items: [c('unit.view', 'View unit'), c('unit.create', 'Add unit'), c('unit.update', 'Edit unit'), c('unit.delete', 'Delete unit')],
  },
  {
    key: 'category',
    label: 'Category',
    items: [
      c('category.view', 'View category'),
      c('category.create', 'Add category'),
      c('category.update', 'Edit category'),
      c('category.delete', 'Delete category'),
    ],
  },
  {
    key: 'report',
    label: 'Report',
    items: [
      c('purchase_n_sell_report.view', 'View purchase & sell report', { modules: ['purchases', 'add_sale', 'pos_sale'] }),
      c('tax_report.view', 'View tax report'),
      c('contacts_report.view', 'View supplier & customer report'),
      c('expense_report.view', 'View expense report', { modules: ['expenses'] }),
      c('profit_loss_report.view', 'View profit/loss report'),
      c('stock_report.view', 'View stock report, stock adjustment report & stock expiry report'),
      c('trending_product_report.view', 'View trending product report'),
      c('register_report.view', 'View register report'),
      c('sales_representative.view', 'View sales representative report'),
      c('view_product_stock_value', 'View product stock value'),
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    items: [
      c('business_settings.access', 'Access business settings'),
      c('barcode_settings.access', 'Access barcode settings'),
      c('invoice_settings.access', 'Access invoice settings'),
      c('access_printers', 'Access printers'),
    ],
  },
  {
    key: 'expense',
    label: 'Expense',
    modules: ['expenses'],
    items: [
      r('expense_view', 'all_expense.access', 'Access all expenses'),
      r('expense_view', 'view_own_expense', 'View own expense only'),
      c('expense.add', 'Add expense'),
      c('expense.edit', 'Edit expense'),
      c('expense.delete', 'Delete expense'),
    ],
  },
  { key: 'dashboard', label: 'Home', items: [c('dashboard.data', 'View home data', { default: true })] },
  {
    key: 'account',
    label: 'Account',
    items: [
      c('account.access', 'Access accounts'),
      c('edit_account_transaction', 'Edit account transaction'),
      c('delete_account_transaction', 'Delete account transaction'),
    ],
  },
  {
    key: 'bookings',
    label: 'Bookings',
    modules: ['booking'],
    items: [
      r('bookings_view', 'crud_all_bookings', 'Add/Edit/View all bookings'),
      r('bookings_view', 'crud_own_bookings', 'Add/Edit/View own bookings'),
    ],
  },
  {
    key: 'restaurant',
    label: 'Restaurant',
    modules: ['tables'],
    items: [c('access_tables', 'Access tables')],
  },
];

/** Permissions that are not listed in the catalog but are still valid for a role (per business: selling price groups). */
export const SELLING_PRICE_GROUP_PREFIX = 'selling_price_group.';
export const DEFAULT_SELLING_PRICE_PERMISSION = 'access_default_selling_price';

/** What decides which parts of the catalog a business sees (Laravel reads these from the session business). */
export interface CatalogContext {
  enabledModules: string[];
  commonSettings: Record<string, unknown>;
  posSettings: Record<string, unknown>;
  /** Active selling price groups of the business. */
  sellingPriceGroups: { id: number; name: string }[];
}

export interface CatalogItemView {
  name: string;
  label: string;
  radio?: string;
  default?: boolean;
  /** True for per-business permissions (selling price groups) whose label is user data, not a translatable text. */
  dynamic?: boolean;
}

export interface CatalogGroupView {
  key: string;
  label: string;
  items: CatalogItemView[];
}

function hasAny(enabled: string[], required?: string[]): boolean {
  return !required || required.length === 0 || required.some((m) => enabled.includes(m));
}

function settingOn(ctx: CatalogContext, s?: CatalogGroup['setting']): boolean {
  if (!s) return true;
  const v = (s.in === 'common' ? ctx.commonSettings : ctx.posSettings)[s.key];
  return !(v === undefined || v === null || v === '' || v === 0 || v === '0' || v === false);
}

/** The catalog as one business sees it: disabled modules/settings hide their groups and items, like Laravel. */
export function buildCatalog(ctx: CatalogContext): CatalogGroupView[] {
  const groups: CatalogGroupView[] = [];
  for (const g of PERMISSION_GROUPS) {
    // Laravel lists the selling price groups after bookings and before the restaurant section
    if (g.key === 'restaurant') groups.push(sellingPriceGroup(ctx));
    if (!hasAny(ctx.enabledModules, g.modules) || !settingOn(ctx, g.setting)) continue;
    const items = g.items
      .filter((i) => hasAny(ctx.enabledModules, i.modules))
      .map<CatalogItemView>((i) => ({ name: i.name, label: i.label, ...(i.radio ? { radio: i.radio } : {}), ...(i.default ? { default: true } : {}) }));
    if (items.length > 0) groups.push({ key: g.key, label: g.label, items });
  }
  return groups;
}

function sellingPriceGroup(ctx: CatalogContext): CatalogGroupView {
  return {
    key: 'selling_price_groups',
    label: 'Access selling price groups',
    items: [
      { name: DEFAULT_SELLING_PRICE_PERMISSION, label: 'Default selling price', default: true },
      ...ctx.sellingPriceGroups.map<CatalogItemView>((g) => ({ name: `${SELLING_PRICE_GROUP_PREFIX}${g.id}`, label: g.name, dynamic: true })),
    ],
  };
}

/** Every permission name a role may be given for this business (used to reject unknown names). */
export function grantablePermissionNames(ctx: CatalogContext): Set<string> {
  const names = new Set<string>();
  for (const g of PERMISSION_GROUPS) for (const i of g.items) names.add(i.name);
  names.add(DEFAULT_SELLING_PRICE_PERMISSION);
  for (const g of ctx.sellingPriceGroups) names.add(`${SELLING_PRICE_GROUP_PREFIX}${g.id}`);
  return names;
}

/** Permission names the business sees in its role editor (what the user can tick or untick). */
export function visiblePermissionNames(ctx: CatalogContext): Set<string> {
  return new Set(buildCatalog(ctx).flatMap((g) => g.items.map((i) => i.name)));
}

/** permission name -> radio group key, for the whole static catalog. */
export function radioGroupsByPermission(): Map<string, string> {
  const m = new Map<string, string>();
  for (const g of PERMISSION_GROUPS) for (const i of g.items) if (i.radio) m.set(i.name, i.radio);
  return m;
}
