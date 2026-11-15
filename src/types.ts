export type ViewName = 'inventory' | 'expiring' | 'scanner' | 'add';

export type ExpiryStatus = 'expired' | 'today' | 'urgent' | 'soon' | 'ok' | 'none';

export interface InventoryItem {
  id: number;
  serial_number: string;
  name: string;
  brand: string;
  ean: string;
  category: string;
  location: string;
  quantity: number;
  initial_quantity: number;
  unit: string;
  expiry_date: string | null;
  effective_expiry_date: string | null;
  opened_expiry_date: string | null;
  days_remaining: number | null;
  expiry_status: ExpiryStatus;
  percent_remaining: number;
  is_opened: boolean;
  opened_at: string | null;
  days_after_opening: number | null;
  image_url: string;
  notes: string;
  ingredients_text: string;
  printed_at: string | null;
  created_at: string;
  updated_at: string;
  qr_svg?: string;
}

export interface StatsResponse {
  total_items: number;
  expired_count: number;
  expiring_3d_count: number;
  expiring_7d_count: number;
  attention_count: number;
  opened_count: number;
  warning_days: number;
  next_serial: string;
  today: string;
  locations: string[];
  categories: string[];
  by_location: Record<string, number>;
  by_category: Record<string, number>;
}

export interface AppSettings {
  serial_seq: string;
  printer_api_url: string;
  printer_auto_print: string;
  printer_qr_mode: 'serial' | 'url';
  printer_qr_base_url: string;
  expiry_warning_days: string;
  locations: string[];
  categories: string[];
}

export interface CatalogProduct {
  ean: string;
  name: string;
  brand: string;
  category: string;
  default_location: string;
  default_quantity: number;
  default_unit: string;
  default_shelf_life_days: number | null;
  ingredients_text: string;
  image_url?: string;
  nutriscore?: string;
  is_polish_ean?: boolean;
}

export interface LabelStickerItem {
  serial_number: string;
  name: string;
  qr_svg: string;
  print_result?: {
    ok: boolean;
    printer_url?: string;
    error?: string;
  } | null;
}

export interface ActivityEntry {
  id: number;
  action: string;
  serial_number: string;
  item_name: string;
  details: {
    snapshot?: InventoryItem;
    [key: string]: unknown;
  };
  created_at: string;
}

export interface ToastMessage {
  id: number;
  text: string;
  undoActivityId?: number | null;
}

