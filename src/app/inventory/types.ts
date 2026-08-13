// ─────────────────────────────────────────────────────────────────────────────
// SUPPORTED VALUES (used for validation in actions.ts + UI dropdowns)
// ─────────────────────────────────────────────────────────────────────────────

export const SUPPORTED_UNITS = [
  'piece',
  'packet',
  'box',
  'bottle',
  'kg',
  'gram',
  'litre',
  'ml',
  'dozen',
] as const

export const SUPPORTED_PACK_SIZE_UNITS = [
  'gram',
  'kg',
  'ml',
  'litre',
  'piece',
] as const

export type SupportedUnit = typeof SUPPORTED_UNITS[number]
export type SupportedPackSizeUnit = typeof SUPPORTED_PACK_SIZE_UNITS[number]

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ProductAlias {
  id: string
  user_id: string
  product_id: string
  alias: string
  language: string | null
  created_at: string
}

export interface Product {
  id: string
  user_id: string
  name: string
  category: string
  current_stock: number
  price: number
  supplier_name: string
  supplier_lead_time_days: number
  shelf_life_days?: number | null
  // Phase 10A — Kirana catalog fields (all optional/nullable for backward compat)
  barcode?: string | null
  brand?: string | null
  unit?: string | null
  pack_size?: number | null
  pack_size_unit?: string | null
  created_at: string
  updated_at: string
  // Merged at page-load from product_aliases table
  aliases?: ProductAlias[]
}
