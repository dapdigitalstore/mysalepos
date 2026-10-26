export interface Option {
  id: number;
  label: string;
}

export interface UnitOption extends Option {
  allowDecimal: boolean;
}

export interface TaxOption extends Option {
  amount: number | string;
}

export interface TemplateOption extends Option {
  values: { id: number; label: string }[];
}

export interface SubUnit extends Option {
  multiplier: string;
  allowDecimal: boolean;
}

export interface FormMeta {
  defaultProfitPercent: number;
  skuPrefix: string;
  enableProductExpiry: boolean;
  enableLotNumber: boolean;
  enableBrand: boolean;
  enableCategory: boolean;
  enableSubCategory: boolean;
  enablePriceTax: boolean;
  enableSubUnits: boolean;
  currencyPrecision: number;
  quantityPrecision: number;
  permittedLocationIds: number[] | null;
  canViewPurchasePrice: boolean;
}

export type StockStatus = 'not_tracked' | 'out_of_stock' | 'low_stock' | 'in_stock';

export interface ProductRow {
  id: number;
  name: string;
  type: 'single' | 'variable' | 'combo';
  sku: string;
  image: string | null;
  enable_stock: boolean;
  is_inactive: boolean;
  not_for_selling: boolean;
  alert_quantity: string | null;
  unit: string | null;
  brand: string | null;
  category: string | null;
  sub_category: string | null;
  tax_name: string | null;
  variation_count: number;
  current_stock: string | null;
  stock_status: StockStatus;
  min_price: string | null;
  max_price: string | null;
  min_purchase_price: string | null;
  max_purchase_price: string | null;
  locations: { id: number; name: string }[];
}

export interface VariationDetail {
  id: number;
  name: string;
  sub_sku: string | null;
  variation_value_id: number | null;
  default_purchase_price: string | null;
  dpp_inc_tax: string | null;
  profit_percent: string | null;
  default_sell_price: string | null;
  sell_price_inc_tax: string | null;
  stock: { location_id: number; location_name: string; qty_available: string }[];
  group_prices: { price_group_id: number; price_inc_tax: string; price_type: string; calculated_price: string }[];
}

export interface VariationGroupDetail {
  id: number;
  name: string;
  is_dummy: boolean;
  variation_template_id: number | null;
  variations: VariationDetail[];
}

export interface ComboItemDetail {
  variation_id: number;
  product_id: number;
  product_name: string;
  variation_name: string | null;
  sub_sku: string | null;
  quantity: string;
  unit_id: number | null;
  product_unit_id: number | null;
  unit_name: string | null;
  multiplier: string;
  purchase_price: string | null;
}

export interface ProductDetail {
  id: number;
  name: string;
  type: 'single' | 'variable' | 'combo';
  sku: string;
  barcode_type: string | null;
  image: string | null;
  unit_id: number | null;
  unit: { id: number; actual_name: string; short_name: string; allow_decimal: boolean } | null;
  secondary_unit_id: number | null;
  sub_unit_ids: number[];
  brand_id: number | null;
  brand_name: string | null;
  category_id: number | null;
  category_name: string | null;
  sub_category_id: number | null;
  sub_category_name: string | null;
  tax: number | null;
  tax_name: string | null;
  tax_rate: string;
  tax_type: 'inclusive' | 'exclusive';
  enable_stock: boolean;
  alert_quantity: string | null;
  expiry_period: string | null;
  expiry_period_type: 'days' | 'months' | null;
  enable_sr_no: boolean;
  weight: string | null;
  product_description: string | null;
  warranty_id: number | null;
  warranty_name: string | null;
  is_inactive: boolean;
  not_for_selling: boolean;
  preparation_time_in_minutes: number | null;
  location_ids: number[];
  locations: { id: number; name: string }[];
  current_stock: string | null;
  stock_status: StockStatus;
  price_groups: { id: number; name: string }[];
  product_variations: VariationGroupDetail[];
  combo_items: ComboItemDetail[];
  created_at: string | null;
  updated_at: string | null;
}

export interface SearchHit {
  product_id: number;
  variation_id: number;
  name: string;
  variation: string;
  type: string;
  sub_sku: string | null;
  unit: string | null;
  unit_id: number | null;
  purchase_price: string | null;
  selling_price: string;
  label: string;
}

export interface OpeningStockData {
  product: { id: number; name: string; type: string; enable_stock: boolean; tax_rate: string; unit_name: string | null; allow_decimal: boolean };
  settings: { enableExpiry: boolean; enableLot: boolean };
  locations: { id: number; name: string }[];
  variations: { id: number; name: string; sub_sku: string | null; group_name: string | null }[];
  rows: {
    purchase_line_id: number;
    transaction_id: number;
    location_id: number;
    variation_id: number;
    quantity: string;
    used: string;
    purchase_price: string;
    transaction_date: string;
    note: string | null;
    exp_date: string | null;
    lot_number: string | null;
  }[];
}
