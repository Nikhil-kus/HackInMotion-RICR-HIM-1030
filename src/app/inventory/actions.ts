'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { SUPPORTED_UNITS, SUPPORTED_PACK_SIZE_UNITS } from './types'
import type { Product, ProductAlias } from './types'

// Re-export types for convenience (type-only re-exports are allowed from 'use server' files)
export type { Product, ProductAlias, SupportedUnit, SupportedPackSizeUnit } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCT ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchProducts() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('name', { ascending: true })

  if (error) {
    console.error('Error fetching products:', error)
    return { error: 'Failed to load products. Please try again.' }
  }

  return { data: data as Product[] }
}

/**
 * Parses and validates the new Phase 10A optional fields from FormData.
 * Returns the validated values or an error string.
 */
function parseKiranaFields(formData: FormData): {
  barcode: string | null
  brand: string | null
  unit: string | null
  pack_size: number | null
  pack_size_unit: string | null
  error?: string
} {
  const barcodeRaw = (formData.get('barcode') as string | null)?.trim() || null
  const brandRaw = (formData.get('brand') as string | null)?.trim() || null
  const unitRaw = (formData.get('unit') as string | null)?.trim() || null
  const packSizeRaw = (formData.get('pack_size') as string | null)?.trim() || null
  const packSizeUnitRaw = (formData.get('pack_size_unit') as string | null)?.trim() || null

  // barcode: optional; empty string → null
  const barcode = barcodeRaw && barcodeRaw.length > 0 ? barcodeRaw : null

  // brand: optional
  const brand = brandRaw && brandRaw.length > 0 ? brandRaw : null

  // unit: optional; if provided must be a known unit
  let unit: string | null = null
  if (unitRaw && unitRaw.length > 0) {
    if (!(SUPPORTED_UNITS as readonly string[]).includes(unitRaw)) {
      return { barcode, brand, unit: null, pack_size: null, pack_size_unit: null, error: `Invalid unit "${unitRaw}". Must be one of: ${SUPPORTED_UNITS.join(', ')}.` }
    }
    unit = unitRaw
  }

  // pack_size: optional; if provided must be positive; pack_size_unit is then required
  let pack_size: number | null = null
  let pack_size_unit: string | null = null

  if (packSizeRaw && packSizeRaw.length > 0) {
    const ps = parseFloat(packSizeRaw)
    if (isNaN(ps) || ps <= 0) {
      return { barcode, brand, unit, pack_size: null, pack_size_unit: null, error: 'Pack size must be a positive number.' }
    }
    pack_size = ps

    // pack_size_unit is required when pack_size is present
    if (!packSizeUnitRaw || packSizeUnitRaw.length === 0) {
      return { barcode, brand, unit, pack_size, pack_size_unit: null, error: 'Pack size unit is required when pack size is provided.' }
    }
    if (!(SUPPORTED_PACK_SIZE_UNITS as readonly string[]).includes(packSizeUnitRaw)) {
      return { barcode, brand, unit, pack_size, pack_size_unit: null, error: `Invalid pack size unit "${packSizeUnitRaw}". Must be one of: ${SUPPORTED_PACK_SIZE_UNITS.join(', ')}.` }
    }
    pack_size_unit = packSizeUnitRaw
  } else if (packSizeUnitRaw && packSizeUnitRaw.length > 0) {
    // pack_size_unit without pack_size — silently ignore the orphan unit
    pack_size_unit = null
  }

  return { barcode, brand, unit, pack_size, pack_size_unit }
}

export async function addProduct(formData: FormData) {
  const supabase = await createClient()

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return { error: 'Unauthorized. Please log in.' }
  }

  const name = formData.get('name') as string
  const category = formData.get('category') as string
  const currentStockStr = formData.get('current_stock') as string
  const priceStr = formData.get('price') as string
  const supplierName = (formData.get('supplier_name') as string) || ''
  const supplierLeadTimeStr = formData.get('supplier_lead_time_days') as string
  const shelfLifeStr = formData.get('shelf_life_days') as string

  if (!name?.trim()) return { error: 'Product name is required.' }
  if (!category?.trim()) return { error: 'Category is required.' }

  const current_stock = parseInt(currentStockStr, 10)
  if (isNaN(current_stock) || current_stock < 0) {
    return { error: 'Current stock must be a non-negative number.' }
  }

  const price = parseFloat(priceStr)
  if (isNaN(price) || price < 0) {
    return { error: 'Price must be a non-negative number.' }
  }

  const supplier_lead_time_days = parseInt(supplierLeadTimeStr, 10)
  if (isNaN(supplier_lead_time_days) || supplier_lead_time_days < 0) {
    return { error: 'Lead time must be a non-negative number of days.' }
  }

  let shelf_life_days: number | null = null
  if (shelfLifeStr && shelfLifeStr.trim() !== '') {
    shelf_life_days = parseInt(shelfLifeStr, 10)
    if (isNaN(shelf_life_days) || shelf_life_days <= 0) {
      return { error: 'Shelf life must be a positive number of days.' }
    }
  }

  const kirana = parseKiranaFields(formData)
  if (kirana.error) return { error: kirana.error }

  const { data: newProduct, error } = await supabase
    .from('products')
    .insert({
      user_id: user.id,
      name,
      category,
      current_stock,
      price,
      supplier_name: supplierName,
      supplier_lead_time_days,
      shelf_life_days,
      barcode: kirana.barcode,
      brand: kirana.brand,
      unit: kirana.unit,
      pack_size: kirana.pack_size,
      pack_size_unit: kirana.pack_size_unit,
    })
    .select('id')
    .single()

  if (error) {
    return { error: 'Failed to save product. Please try again.' }
  }

  revalidatePath('/inventory')
  return { success: true, productId: newProduct.id as string }
}

export async function updateProduct(id: string, formData: FormData) {
  const supabase = await createClient()

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return { error: 'Unauthorized. Please log in.' }
  }

  const name = formData.get('name') as string
  const category = formData.get('category') as string
  const currentStockStr = formData.get('current_stock') as string
  const priceStr = formData.get('price') as string
  const supplierName = (formData.get('supplier_name') as string) || ''
  const supplierLeadTimeStr = formData.get('supplier_lead_time_days') as string
  const shelfLifeStr = formData.get('shelf_life_days') as string

  if (!name?.trim()) return { error: 'Product name is required.' }
  if (!category?.trim()) return { error: 'Category is required.' }

  const current_stock = parseInt(currentStockStr, 10)
  if (isNaN(current_stock) || current_stock < 0) {
    return { error: 'Current stock must be a non-negative number.' }
  }

  const price = parseFloat(priceStr)
  if (isNaN(price) || price < 0) {
    return { error: 'Price must be a non-negative number.' }
  }

  const supplier_lead_time_days = parseInt(supplierLeadTimeStr, 10)
  if (isNaN(supplier_lead_time_days) || supplier_lead_time_days < 0) {
    return { error: 'Lead time must be a non-negative number of days.' }
  }

  let shelf_life_days: number | null = null
  if (shelfLifeStr && shelfLifeStr.trim() !== '') {
    shelf_life_days = parseInt(shelfLifeStr, 10)
    if (isNaN(shelf_life_days) || shelf_life_days <= 0) {
      return { error: 'Shelf life must be a positive number of days.' }
    }
  }

  const kirana = parseKiranaFields(formData)
  if (kirana.error) return { error: kirana.error }

  // RLS ensures the user can only update their own records
  const { error } = await supabase
    .from('products')
    .update({
      name,
      category,
      current_stock,
      price,
      supplier_name: supplierName,
      supplier_lead_time_days,
      shelf_life_days,
      barcode: kirana.barcode,
      brand: kirana.brand,
      unit: kirana.unit,
      pack_size: kirana.pack_size,
      pack_size_unit: kirana.pack_size_unit,
    })
    .eq('id', id)

  if (error) {
    return { error: 'Failed to update product. Please try again.' }
  }

  revalidatePath('/inventory')
  return { success: true }
}

export async function deleteProduct(id: string) {
  const supabase = await createClient()

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return { error: 'Unauthorized. Please log in.' }
  }

  // RLS ensures the user can only delete their own records
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id)

  if (error) {
    return { error: 'Failed to delete product. Please try again.' }
  }

  revalidatePath('/inventory')
  return { success: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// ALIAS ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches all aliases for the current user (used at page-load for search).
 */
export async function fetchAllAliases() {
  const supabase = await createClient()

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return { error: 'Unauthorized.' }

  const { data, error } = await supabase
    .from('product_aliases')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Error fetching aliases:', error)
    return { error: 'Failed to load aliases. Please try again.' }
  }

  return { data: data as ProductAlias[] }
}

/**
 * SR-1: Adds an alias to a product.
 * Verifies product ownership via explicit DB query before inserting.
 */
export async function addAlias(productId: string, alias: string, language?: string) {
  const supabase = await createClient()

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return { error: 'Unauthorized.' }

  const trimmedAlias = alias?.trim()
  if (!trimmedAlias) return { error: 'Alias cannot be empty.' }

  // SR-1: Verify product belongs to this user — never trust client-supplied product_id alone
  const { data: product } = await supabase
    .from('products')
    .select('id')
    .eq('id', productId)
    .eq('user_id', user.id)
    .single()

  if (!product) return { error: 'Product not found or access denied.' }

  const { data, error } = await supabase
    .from('product_aliases')
    .insert({
      user_id: user.id,
      product_id: productId,
      alias: trimmedAlias,
      language: language?.trim() || null,
    })
    .select()
    .single()

  if (error) {
    return { error: 'Failed to add alias. Please try again.' }
  }

  revalidatePath('/inventory')
  return { success: true, data: data as ProductAlias }
}

/**
 * SR-1: Deletes an alias.
 * Verifies alias ownership via user_id column — no client-supplied product_id needed here.
 */
export async function deleteAlias(aliasId: string) {
  const supabase = await createClient()

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return { error: 'Unauthorized.' }

  // Ownership check: only delete if the alias belongs to this user
  // The .eq('user_id', user.id) filter means the delete is a no-op for aliases
  // belonging to other users — RLS is the second layer.
  const { error } = await supabase
    .from('product_aliases')
    .delete()
    .eq('id', aliasId)
    .eq('user_id', user.id)

  if (error) {
    return { error: 'Failed to delete alias. Please try again.' }
  }

  revalidatePath('/inventory')
  return { success: true }
}
