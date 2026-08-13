'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  calculatePurchaseLineTotal,
  calculatePurchaseOrderTotal,
  groupItemsBySupplier,
  validateReceiveQuantity,
  derivePurchaseOrderStatus,
} from '@/lib/purchasing/engine'
import { calculateAndStoreAlerts } from '@/app/alerts/actions'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface Supplier {
  id: string
  user_id: string
  name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface ProductSupplier {
  id: string
  user_id: string
  product_id: string
  supplier_id: string
  purchase_price: number | null
  supplier_sku: string | null
  is_primary: boolean
  created_at: string
  updated_at: string
  suppliers?: { name: string } | null
  products?: { name: string; current_stock: number; supplier_lead_time_days: number; shelf_life_days?: number | null } | null
}

export interface PurchaseOrderItem {
  id: string
  user_id: string
  purchase_order_id: string
  product_id: string
  recommended_quantity: number
  ordered_quantity: number
  received_quantity: number
  unit_cost: number | null
  line_total: number
  created_at: string
  products?: { name: string; current_stock: number } | null
}

export interface PurchaseOrderRecord {
  id: string
  user_id: string
  supplier_id: string | null
  status: 'draft' | 'ordered' | 'partially_received' | 'received' | 'cancelled'
  total_amount: number
  notes: string | null
  ordered_at: string | null
  expected_at: string | null
  received_at: string | null
  created_at: string
  updated_at: string
  suppliers?: { name: string } | null
  purchase_order_items?: PurchaseOrderItem[]
}

export interface ReorderRecommendation {
  productId: string
  productName: string
  currentStock: number
  avgDailyDemand: number
  leadTimeDays: number
  shelfLifeDays: number | null
  recommendedQuantity: number
  supplierId: string | null
  supplierName: string | null
  purchasePrice: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPPLIER ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchSuppliers() {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return { error: 'Unauthorized.' }

  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .eq('user_id', user.id)
    .order('name', { ascending: true })

  if (error) return { error: error.message }
  return { data: data as Supplier[] }
}

export async function addSupplier(formData: FormData) {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return { error: 'Unauthorized.' }

  const name = (formData.get('name') as string)?.trim()
  if (!name) return { error: 'Supplier name is required.' }

  const { error } = await supabase.from('suppliers').insert({
    user_id: user.id,
    name,
    contact_name: (formData.get('contact_name') as string) || null,
    phone: (formData.get('phone') as string) || null,
    email: (formData.get('email') as string) || null,
    address: (formData.get('address') as string) || null,
    notes: (formData.get('notes') as string) || null,
  })

  if (error) return { error: error.message }
  revalidatePath('/purchases')
  return { success: true }
}

export async function updateSupplier(id: string, formData: FormData) {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return { error: 'Unauthorized.' }

  const name = (formData.get('name') as string)?.trim()
  if (!name) return { error: 'Supplier name is required.' }

  const { error } = await supabase
    .from('suppliers')
    .update({
      name,
      contact_name: (formData.get('contact_name') as string) || null,
      phone: (formData.get('phone') as string) || null,
      email: (formData.get('email') as string) || null,
      address: (formData.get('address') as string) || null,
      notes: (formData.get('notes') as string) || null,
    })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/purchases')
  return { success: true }
}

export async function deleteSupplier(id: string) {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return { error: 'Unauthorized.' }

  // Check no active orders reference this supplier
  const { data: activeOrders } = await supabase
    .from('purchase_orders')
    .select('id')
    .eq('supplier_id', id)
    .eq('user_id', user.id)
    .in('status', ['draft', 'ordered', 'partially_received'])
    .limit(1)

  if (activeOrders && activeOrders.length > 0) {
    return { error: 'Cannot delete supplier with active purchase orders. Cancel or complete those orders first.' }
  }

  const { error } = await supabase
    .from('suppliers')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/purchases')
  return { success: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCT-SUPPLIER RELATIONSHIP ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchProductSuppliers() {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return { error: 'Unauthorized.' }

  const { data, error } = await supabase
    .from('product_suppliers')
    .select('*, suppliers(name), products(name, current_stock, supplier_lead_time_days, shelf_life_days)')
    .eq('user_id', user.id)

  if (error) return { error: error.message }
  return { data: data as ProductSupplier[] }
}

export async function assignSupplierToProduct(
  productId: string,
  supplierId: string,
  purchasePrice: number | null,
  supplierSku: string | null,
  isPrimary: boolean
) {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return { error: 'Unauthorized.' }

  // Verify product and supplier belong to this user
  const { data: product } = await supabase.from('products').select('id').eq('id', productId).eq('user_id', user.id).single()
  if (!product) return { error: 'Product not found.' }
  const { data: supplier } = await supabase.from('suppliers').select('id').eq('id', supplierId).eq('user_id', user.id).single()
  if (!supplier) return { error: 'Supplier not found.' }

  // If setting as primary, clear other primary flags for this product
  if (isPrimary) {
    await supabase
      .from('product_suppliers')
      .update({ is_primary: false })
      .eq('product_id', productId)
      .eq('user_id', user.id)
  }

  const { error } = await supabase.from('product_suppliers').upsert({
    user_id: user.id,
    product_id: productId,
    supplier_id: supplierId,
    purchase_price: purchasePrice,
    supplier_sku: supplierSku,
    is_primary: isPrimary,
  }, { onConflict: 'product_id,supplier_id' })

  if (error) return { error: error.message }
  revalidatePath('/purchases')
  revalidatePath('/inventory')
  return { success: true }
}

export async function removeProductSupplier(id: string) {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return { error: 'Unauthorized.' }

  const { error } = await supabase
    .from('product_suppliers')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/purchases')
  return { success: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// REORDER RECOMMENDATIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches active reorder alerts from Phase 7 and enriches with supplier/pricing data.
 * Does NOT recalculate Phase 7 recommendations.
 */
export async function fetchReorderRecommendations(): Promise<{ data?: ReorderRecommendation[]; error?: string }> {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return { error: 'Unauthorized.' }

  // Get active reorder alerts (Phase 7 output)
  const { data: alerts, error: alertsError } = await supabase
    .from('alerts')
    .select('product_id, recommended_quantity, message, products(*)')
    .eq('user_id', user.id)
    .eq('resolved', false)
    .eq('alert_type', 'reorder')
    .order('created_at', { ascending: false })

  if (alertsError) return { error: alertsError.message }
  if (!alerts || alerts.length === 0) return { data: [] }

  interface RawAlert {
    product_id: string
    recommended_quantity: number
    message: string
    products: { name: string; current_stock: number; supplier_lead_time_days: number; shelf_life_days?: number | null } | null
  }
  interface RawProductSupplier {
    product_id: string
    supplier_id: string
    purchase_price: number | null
    is_primary: boolean
    suppliers: { name: string } | null
  }

  // Deduplicate by product_id (take the latest/first)
  const seen = new Set<string>()
  const deduped = (alerts as unknown as RawAlert[]).filter((a) => {
    if (seen.has(a.product_id)) return false
    seen.add(a.product_id)
    return true
  })

  // Fetch product-supplier relationships for these products
  const productIds = deduped.map((a) => a.product_id)
  const { data: productSuppliers } = await supabase
    .from('product_suppliers')
    .select('product_id, supplier_id, purchase_price, is_primary, suppliers(name)')
    .eq('user_id', user.id)
    .in('product_id', productIds)

  // Build supplier map by product_id (prefer primary)
  const supplierMap = new Map<string, { supplierId: string; supplierName: string; purchasePrice: number | null }>()
  ;(productSuppliers as unknown as RawProductSupplier[] || []).forEach((ps) => {
    const existing = supplierMap.get(ps.product_id)
    if (!existing || ps.is_primary) {
      supplierMap.set(ps.product_id, {
        supplierId: ps.supplier_id,
        supplierName: ps.suppliers?.name ?? 'Unknown',
        purchasePrice: ps.purchase_price ? Number(ps.purchase_price) : null,
      })
    }
  })

  const recommendations: ReorderRecommendation[] = deduped.map((alert) => {
    const product = alert.products
    const supplierInfo = supplierMap.get(alert.product_id) ?? null

    // Parse avgDailyDemand from the JSON message if present
    let avgDailyDemand = 0
    try {
      const parsed = JSON.parse(alert.message)
      if (parsed?.avgDailyDemand) avgDailyDemand = Number(parsed.avgDailyDemand)
    } catch { /* fallback */ }

    return {
      productId: alert.product_id,
      productName: product?.name ?? 'Unknown Product',
      currentStock: product?.current_stock ?? 0,
      avgDailyDemand,
      leadTimeDays: product?.supplier_lead_time_days ?? 0,
      shelfLifeDays: product?.shelf_life_days ?? null,
      recommendedQuantity: alert.recommended_quantity,
      supplierId: supplierInfo?.supplierId ?? null,
      supplierName: supplierInfo?.supplierName ?? null,
      purchasePrice: supplierInfo?.purchasePrice ?? null,
    }
  })

  return { data: recommendations }
}

// ─────────────────────────────────────────────────────────────────────────────
// PURCHASE ORDER ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchPurchaseOrders() {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return { error: 'Unauthorized.' }

  const { data, error } = await supabase
    .from('purchase_orders')
    .select('*, suppliers(name), purchase_order_items(*, products(name, current_stock))')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return { error: error.message }
  return { data: data as PurchaseOrderRecord[] }
}

export async function fetchPurchaseOrder(id: string) {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return { error: 'Unauthorized.' }

  const { data, error } = await supabase
    .from('purchase_orders')
    .select('*, suppliers(name), purchase_order_items(*, products(name, current_stock))')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error) return { error: error.message }
  return { data: data as PurchaseOrderRecord }
}

export interface CreatePurchaseOrderItemInput {
  productId: string
  productName: string
  recommendedQuantity: number
  orderedQuantity: number
  unitCost: number | null
}

/**
 * Creates purchase orders, automatically grouping items by supplier.
 * Returns the IDs of created orders.
 */
export async function createPurchaseOrders(
  items: Array<CreatePurchaseOrderItemInput & { supplierId: string | null; supplierName: string | null }>,
  notes?: string
) {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return { error: 'Unauthorized.' }

  if (!items || items.length === 0) return { error: 'No items provided.' }

  // Validate quantities
  for (const item of items) {
    if (item.orderedQuantity <= 0) {
      return { error: `Purchase quantity for ${item.productName} must be greater than zero.` }
    }
  }

  // Group by supplier using the engine
  const enriched = items.map((item) => ({
    ...item,
    orderedQuantity: item.orderedQuantity,
    lineTotal: calculatePurchaseLineTotal(item.orderedQuantity, item.unitCost),
  }))

  const groups = groupItemsBySupplier(enriched)
  const createdOrderIds: string[] = []

  for (const group of groups) {
    const totalAmount = calculatePurchaseOrderTotal(group.items)

    // Create the purchase order
    const { data: order, error: orderError } = await supabase
      .from('purchase_orders')
      .insert({
        user_id: user.id,
        supplier_id: group.supplierId,
        status: 'draft',
        total_amount: totalAmount,
        notes: notes || null,
      })
      .select('id')
      .single()

    if (orderError || !order) return { error: orderError?.message ?? 'Failed to create purchase order.' }

    // Create the line items
    const lineItems = group.items.map((item) => ({
      user_id: user.id,
      purchase_order_id: order.id,
      product_id: item.productId,
      recommended_quantity: item.recommendedQuantity,
      ordered_quantity: item.orderedQuantity,
      received_quantity: 0,
      unit_cost: item.unitCost,
      line_total: item.lineTotal,
    }))

    const { error: itemsError } = await supabase.from('purchase_order_items').insert(lineItems)
    if (itemsError) return { error: itemsError.message }

    createdOrderIds.push(order.id)
  }

  revalidatePath('/purchases')
  revalidatePath('/dashboard')
  return { success: true, orderIds: createdOrderIds }
}

export async function updatePurchaseOrderStatus(
  orderId: string,
  status: 'ordered' | 'cancelled',
  expectedAt?: string | null
) {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return { error: 'Unauthorized.' }

  const updateData: Record<string, unknown> = { status }
  if (status === 'ordered') updateData.ordered_at = new Date().toISOString()
  if (expectedAt !== undefined) updateData.expected_at = expectedAt

  const { error } = await supabase
    .from('purchase_orders')
    .update(updateData)
    .eq('id', orderId)
    .eq('user_id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/purchases')
  revalidatePath(`/purchases/${orderId}`)
  revalidatePath('/dashboard')
  return { success: true }
}

export async function updateOrderNotes(orderId: string, notes: string) {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return { error: 'Unauthorized.' }

  const { error } = await supabase
    .from('purchase_orders')
    .update({ notes })
    .eq('id', orderId)
    .eq('user_id', user.id)

  if (error) return { error: error.message }
  revalidatePath(`/purchases/${orderId}`)
  return { success: true }
}

/**
 * Receives stock for one or more purchase order items.
 * Validates quantities, increments product stock, updates order status.
 * Triggers Phase 7 alert recalculation after inventory changes.
 */
export async function receiveStock(
  orderId: string,
  receives: Array<{ itemId: string; receiveQuantity: number }>
) {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return { error: 'Unauthorized.' }

  // Fetch the purchase order and its items (with ownership check)
  const { data: order, error: orderError } = await supabase
    .from('purchase_orders')
    .select('id, status, user_id, purchase_order_items(*)')
    .eq('id', orderId)
    .eq('user_id', user.id)
    .single()

  if (orderError || !order) return { error: 'Purchase order not found.' }
  if (order.status === 'received') return { error: 'This order has already been fully received.' }
  if (order.status === 'cancelled') return { error: 'This order has been cancelled.' }

  interface RawOrderWithItems { purchase_order_items: PurchaseOrderItem[] }
  const items = (order as unknown as RawOrderWithItems).purchase_order_items

  // Validate all receive quantities first
  for (const recv of receives) {
    const item = items.find((i) => i.id === recv.itemId)
    if (!item) return { error: `Item ${recv.itemId} not found in this order.` }

    const validation = validateReceiveQuantity(
      recv.receiveQuantity,
      item.ordered_quantity,
      item.received_quantity
    )
    if (!validation.valid) return { error: validation.reason }
  }

  // Apply all receives
  for (const recv of receives) {
    if (recv.receiveQuantity <= 0) continue

    const item = items.find((i) => i.id === recv.itemId)!
    const newReceived = item.received_quantity + recv.receiveQuantity

    // Update purchase_order_item.received_quantity
    const { error: itemUpdateError } = await supabase
      .from('purchase_order_items')
      .update({ received_quantity: newReceived })
      .eq('id', recv.itemId)
      .eq('user_id', user.id)

    if (itemUpdateError) return { error: `Failed to update item: ${itemUpdateError.message}` }

    // Increment product inventory using RPC-style update (read-modify-write with ownership check)
    const { data: product, error: fetchProdError } = await supabase
      .from('products')
      .select('id, current_stock')
      .eq('id', item.product_id)
      .eq('user_id', user.id)
      .single()

    if (fetchProdError || !product) return { error: `Product not found for item ${recv.itemId}.` }

    const { error: stockUpdateError } = await supabase
      .from('products')
      .update({ current_stock: product.current_stock + recv.receiveQuantity })
      .eq('id', product.id)
      .eq('user_id', user.id)

    if (stockUpdateError) return { error: `Failed to update stock: ${stockUpdateError.message}` }
  }

  // Recalculate order status: re-fetch all items to get updated received_quantities
  const { data: updatedItems } = await supabase
    .from('purchase_order_items')
    .select('ordered_quantity, received_quantity')
    .eq('purchase_order_id', orderId)

  const newStatus = derivePurchaseOrderStatus(
    (updatedItems || []).map((i) => ({
      orderedQuantity: i.ordered_quantity,
      receivedQuantity: i.received_quantity,
    }))
  )

  const orderUpdate: Record<string, unknown> = { status: newStatus }
  if (newStatus === 'received') orderUpdate.received_at = new Date().toISOString()

  await supabase
    .from('purchase_orders')
    .update(orderUpdate)
    .eq('id', orderId)
    .eq('user_id', user.id)

  // Recalculate Phase 7 alerts after stock change
  try {
    await calculateAndStoreAlerts()
  } catch (alertErr) {
    console.warn('Alert recalculation after receiving failed:', alertErr)
    // Non-fatal — don't block the receive workflow
  }

  revalidatePath('/purchases')
  revalidatePath(`/purchases/${orderId}`)
  revalidatePath('/inventory')
  revalidatePath('/alerts')
  revalidatePath('/dashboard')
  return { success: true, newStatus }
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD PURCHASE METRICS
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchPurchaseMetrics() {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return { error: 'Unauthorized.' }

  const { data: orders, error } = await supabase
    .from('purchase_orders')
    .select('id, status, total_amount')
    .eq('user_id', user.id)
    .neq('status', 'cancelled')

  if (error) return { error: error.message }

  const draftCount = (orders || []).filter((o) => o.status === 'draft').length
  const pendingCount = (orders || []).filter((o) => o.status === 'ordered' || o.status === 'partially_received').length
  const pendingValue = (orders || [])
    .filter((o) => o.status === 'ordered' || o.status === 'partially_received')
    .reduce((sum, o) => sum + Number(o.total_amount), 0)

  return { data: { draftCount, pendingCount, pendingValue } }
}
