/**
 * Module registry. Every feature area of the system (the core POS and each UltimatePOS add-on module)
 * is declared here once. The API serves it at GET /api/modules, filtered by what the signed-in user
 * may see, and the web sidebar is built from it. A module's NestJS code lives in src/modules/<id>/
 * when its phase is built; until then it is listed as "planned" with its scope.
 */
export type ModuleStatus = 'done' | 'in-progress' | 'planned';

export interface ModuleManifest {
  id: string;
  kind: 'core' | 'addon';
  icon: string; // lucide-react icon name
  name: { en: string; si: string };
  phase: number;
  status: ModuleStatus;
  /** Any one of these permissions makes the module visible (Admin/Superadmin always see it). */
  permissions: string[];
  /** Core feature toggle stored in business.enabled_modules; the module is hidden when it is absent. */
  featureKey?: string;
  /** Add-on modules are sold/enabled per subscription package (Superadmin); core modules are always on. */
  dependsOn?: string[];
  features: string[];
}

export const MODULES: ModuleManifest[] = [
  // ---------------- core ----------------
  { id: 'dashboard', kind: 'core', icon: 'LayoutDashboard', name: { en: 'Dashboard', si: 'උපකරණ පුවරුව' }, phase: 0, status: 'done', permissions: [], features: ['Sales, purchase and profit summary', 'Stock alerts', 'Quick links'] },
  { id: 'products', kind: 'core', icon: 'Package', name: { en: 'Products', si: 'නිෂ්පාදන' }, phase: 1, status: 'done', permissions: ['product.view', 'product.create'], features: ['Products with variations, SKU and barcode', 'Categories, brands, units, warranties', 'Selling price groups', 'Opening stock', 'Import products (CSV/Excel)', 'Print labels and barcodes'] },
  { id: 'contacts', kind: 'core', icon: 'Users', name: { en: 'Contacts', si: 'සම්බන්ධතා' }, phase: 1, status: 'done', permissions: ['supplier.view', 'customer.view'], features: ['Suppliers and customers', 'Customer groups', 'Opening balance and ledger', 'Import contacts'] },
  { id: 'sell', kind: 'core', icon: 'ShoppingCart', name: { en: 'Sales & POS', si: 'විකුණුම් සහ POS' }, phase: 2, status: 'done', permissions: ['sell.view', 'direct_sell.access', 'sell.create'], featureKey: 'pos_sale', features: ['Touch-friendly POS screen', 'Add sale, drafts, quotations', 'Hold / suspended sales', 'Multiple payment methods and cash register', 'Sell return', 'Discounts and shipping', 'Receipt and invoice printing'] },
  { id: 'purchase', kind: 'core', icon: 'Truck', name: { en: 'Purchases', si: 'මිලදී ගැනීම්' }, phase: 3, status: 'planned', permissions: ['purchase.view', 'purchase.create'], featureKey: 'purchases', features: ['Purchase orders and requisitions', 'Purchase and purchase return', 'Supplier payments'] },
  { id: 'stock', kind: 'core', icon: 'Boxes', name: { en: 'Stock', si: 'තොග' }, phase: 3, status: 'planned', permissions: ['purchase.view', 'stock_transfers', 'stock_adjustment'], featureKey: 'stock_adjustment', features: ['Stock transfer between locations', 'Stock adjustment', 'FIFO cost tracking', 'Low-stock alerts'] },
  { id: 'expenses', kind: 'core', icon: 'Receipt', name: { en: 'Expenses', si: 'වියදම්' }, phase: 4, status: 'planned', permissions: ['all_expense.access', 'view_own_expense'], featureKey: 'expenses', features: ['Expense categories', 'Recurring expenses', 'Attach receipts'] },
  { id: 'payment-accounts', kind: 'core', icon: 'Landmark', name: { en: 'Payment Accounts', si: 'ගෙවීම් ගිණුම්' }, phase: 4, status: 'planned', permissions: ['account.access'], featureKey: 'account', features: ['Cash and bank accounts', 'Fund transfer and deposit', 'Account book and reports'] },
  { id: 'reports', kind: 'core', icon: 'BarChart3', name: { en: 'Reports', si: 'වාර්තා' }, phase: 5, status: 'planned', permissions: ['profit_loss_report.view', 'purchase_n_sell_report.view', 'stock_report.view'], features: ['Profit / loss', 'Sales, purchase, stock, tax, expense, register reports', 'Customer and supplier reports', 'Export to Excel and PDF'] },
  { id: 'users', kind: 'core', icon: 'UserCog', name: { en: 'Users & Roles', si: 'පරිශීලකයින් සහ භූමිකා' }, phase: 1, status: 'done', permissions: ['user.view', 'roles.view'], features: ['Users', 'Roles and permissions', 'Sales commission agents'] },
  { id: 'settings', kind: 'core', icon: 'Settings', name: { en: 'Settings', si: 'සැකසුම්' }, phase: 1, status: 'done', permissions: ['business_settings.access'], features: ['Business settings', 'Business locations', 'Invoice layouts and schemes', 'Tax rates', 'Barcode and printer settings', 'Notification templates', 'Types of service', 'Restaurant: tables, modifiers, kitchen, bookings'] },

  // ---------------- add-on modules ----------------
  { id: 'essentials', kind: 'addon', icon: 'Briefcase', name: { en: 'Essentials & HRM', si: 'අත්‍යවශ්‍ය සහ මානව සම්පත්' }, phase: 7, status: 'planned', permissions: ['essentials.view_all_attendance', 'essentials.crud_leave'], features: ['Employees, departments, designations', 'Attendance and shifts', 'Leave management and holidays', 'Payroll and payslips', 'To-do, documents, memos, reminders', 'Knowledge base and messages'] },
  { id: 'crm', kind: 'addon', icon: 'Handshake', name: { en: 'CRM', si: 'පාරිභෝගික සබඳතා' }, phase: 7, status: 'planned', permissions: ['crm.access_all_schedule', 'crm.access_own_schedule'], features: ['Leads and life stages', 'Follow-ups and schedules', 'Campaigns (email/SMS)', 'Proposals and templates', 'Call logs', 'Contact login and commissions'] },
  { id: 'accounting', kind: 'addon', icon: 'Calculator', name: { en: 'Accounting', si: 'ගිණුම්කරණය' }, phase: 7, status: 'planned', permissions: ['accounting.access_accounting_module'], features: ['Chart of accounts', 'Journal entries', 'Transfers and budget', 'Trial balance, balance sheet, cash flow', 'Auto-mapping of sales/purchases'] },
  { id: 'manufacturing', kind: 'addon', icon: 'Factory', name: { en: 'Manufacturing', si: 'නිෂ්පාදනය' }, phase: 8, status: 'planned', permissions: ['manufacturing.access_recipe', 'manufacturing.access_production'], features: ['Recipes / bill of materials', 'Production runs and ingredient stock', 'Wastage and yield', 'Manufacturing report'] },
  { id: 'repair', kind: 'addon', icon: 'Wrench', name: { en: 'Repair', si: 'අලුත්වැඩියා' }, phase: 8, status: 'planned', permissions: ['job_sheet.view_assigned', 'job_sheet.view_all'], features: ['Job sheets and statuses', 'Devices, brands and models', 'Parts used, invoice and warranty', 'Customer SMS/email updates', 'Public job status page'] },
  { id: 'project', kind: 'addon', icon: 'KanbanSquare', name: { en: 'Project', si: 'ව්‍යාපෘති' }, phase: 8, status: 'planned', permissions: ['project.create_project', 'project.edit_project'], features: ['Projects and tasks (kanban/list/gantt)', 'Time logs', 'Invoices from timesheets', 'Project activities and reports'] },
  { id: 'superadmin', kind: 'addon', icon: 'ShieldCheck', name: { en: 'Superadmin (SaaS)', si: 'ප්‍රධාන පරිපාලක' }, phase: 9, status: 'planned', permissions: ['superadmin'], features: ['Businesses management', 'Packages and subscriptions', 'Coupons and payment gateways', 'Landing page and frontend pages', 'Communicator (email/SMS to businesses)', 'Superadmin settings'] },
  { id: 'woocommerce', kind: 'addon', icon: 'Store', name: { en: 'WooCommerce', si: 'WooCommerce' }, phase: 9, status: 'planned', permissions: ['woocommerce.access_woocommerce_api_settings'], features: ['Sync products, categories, stock', 'Sync orders and customers', 'Webhooks', 'Sync log'] },
  { id: 'hms', kind: 'addon', icon: 'Hotel', name: { en: 'Hotel Management (HMS)', si: 'හෝටල් කළමනාකරණය' }, phase: 9, status: 'planned', permissions: ['hms.access_hms_module'], features: ['Rooms and room types', 'Bookings and check-in/out', 'Extras and pricing', 'Housekeeping', 'Hotel reports'] },
  { id: 'asset-management', kind: 'addon', icon: 'HardDrive', name: { en: 'Asset Management', si: 'වත්කම් කළමනාකරණය' }, phase: 9, status: 'planned', permissions: ['asset.view'], features: ['Assets', 'Allocation and revocation', 'Maintenance', 'Warranty tracking'] },
  { id: 'field-force', kind: 'addon', icon: 'MapPin', name: { en: 'Field Force', si: 'ක්ෂේත්‍ර කාර්ය මණ්ඩලය' }, phase: 9, status: 'planned', permissions: ['superadmin'], features: ['Visits and check-ins', 'Sales targets', 'Field staff tracking'] },
  { id: 'ecommerce', kind: 'addon', icon: 'ShoppingBag', name: { en: 'E-commerce', si: 'ඊ-වාණිජ්‍ය' }, phase: 9, status: 'planned', permissions: ['superadmin'], features: ['Online storefront', 'Cart and checkout', 'Order management'] },
  { id: 'product-catalogue', kind: 'addon', icon: 'BookOpen', name: { en: 'Product Catalogue', si: 'නිෂ්පාදන නාමාවලිය' }, phase: 9, status: 'planned', permissions: ['product.view'], features: ['Public catalogue and QR', 'Share per location'] },
  { id: 'cms', kind: 'addon', icon: 'FileText', name: { en: 'CMS', si: 'අන්තර්ගත කළමනාකරණය' }, phase: 9, status: 'planned', permissions: ['superadmin'], features: ['Pages and blog', 'Site details'] },
  { id: 'connector', kind: 'addon', icon: 'Plug', name: { en: 'Connector (API)', si: 'සම්බන්ධක (API)' }, phase: 9, status: 'planned', permissions: ['superadmin', 'access_connector_module'], features: ['REST API clients and tokens', 'Mobile app support'] },
  { id: 'spreadsheet', kind: 'addon', icon: 'Table', name: { en: 'Spreadsheet', si: 'පැතුරුම්පත' }, phase: 9, status: 'planned', permissions: ['access.spreadsheet'], features: ['Shared spreadsheets', 'Share with users/roles'] },
  { id: 'ai-assistance', kind: 'addon', icon: 'Sparkles', name: { en: 'AI Assistance', si: 'AI සහාය' }, phase: 9, status: 'planned', permissions: ['aiassistance.access_aiassistance_module'], features: ['Content/report assistance', 'Prompt history'] },
  { id: 'inbox-report', kind: 'addon', icon: 'Inbox', name: { en: 'Inbox Report', si: 'ලිපි වාර්තා' }, phase: 9, status: 'planned', permissions: ['superadmin'], features: ['Scheduled report emails/WhatsApp'] },
  { id: 'custom-dashboard', kind: 'addon', icon: 'PanelsTopLeft', name: { en: 'Custom Dashboard', si: 'අභිරුචි උපකරණ පුවරුව' }, phase: 9, status: 'planned', permissions: ['superadmin'], features: ['Build dashboards from widgets'] },
  { id: 'gym', kind: 'addon', icon: 'Dumbbell', name: { en: 'Gym', si: 'ජිම්' }, phase: 9, status: 'planned', permissions: ['gym.access_gym_module'], features: ['Members and packages', 'Attendance and renewals'] },
  { id: 'zatca', kind: 'addon', icon: 'QrCode', name: { en: 'ZATCA (KSA e-invoicing)', si: 'ZATCA (KSA ඉන්වොයිස්)' }, phase: 9, status: 'planned', permissions: ['superadmin'], features: ['KSA e-invoice QR and XML', 'ZATCA onboarding'] },
];
