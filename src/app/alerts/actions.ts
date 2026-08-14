'use server'

import { createClient } from '@/utils/supabase/server'
import { evaluateProductAlert, AlertEngineResult } from '@/lib/alerts/engine'
import { generateProductForecast } from '@/lib/forecasting/engine'
import { revalidatePath } from 'next/cache'

export interface DBAlertRecord {
  id: string
  user_id: string
  product_id: string
  alert_type: 'stockout' | 'overstock' | 'reorder'
  severity: 'low' | 'medium' | 'high' | 'critical'
  message: string
  recommended_quantity: number
  resolved: boolean
  created_at: string
  products?: {
    name: string
    current_stock: number
    price: number
    supplier_lead_time_days: number
    shelf_life_days?: number | null
  }
}

/**
 * Fetches alerts for the authenticated user (joined with product properties)
 */
export async function fetchAlerts() {
  const supabase = await createClient()

  // Get current user to verify session
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return { error: 'Unauthorized. Please log in.' }
  }

  const { data, error } = await supabase
    .from('alerts')
    .select(`
      id,
      user_id,
      product_id,
      alert_type,
      severity,
      message,
      recommended_quantity,
      resolved,
      created_at,
      products (*)
    `)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching alerts:', error)
    return { error: error.message }
  }

  interface DBAlertJoin {
    id: string
    user_id: string
    product_id: string
    alert_type: 'stockout' | 'overstock' | 'reorder'
    severity: 'low' | 'medium' | 'high' | 'critical'
    message: string
    recommended_quantity: number
    resolved: boolean
    created_at: string
    products: {
      name: string
      current_stock: number
      price: number
      supplier_lead_time_days: number
    } | null
  }

  // Typecast to DBAlertRecord list
  const alerts: DBAlertRecord[] = (data as unknown as DBAlertJoin[] || []).map((a) => ({
    id: a.id,
    user_id: a.user_id,
    product_id: a.product_id,
    alert_type: a.alert_type,
    severity: a.severity,
    message: a.message,
    recommended_quantity: a.recommended_quantity,
    resolved: a.resolved,
    created_at: a.created_at,
    products: a.products ? {
      name: a.products.name,
      current_stock: a.products.current_stock,
      price: Number(a.products.price),
      supplier_lead_time_days: a.products.supplier_lead_time_days
    } : undefined
  }))

  return { data: alerts }
}

/**
 * Resolves a specific alert belonging to the authenticated user
 */
export async function resolveAlert(alertId: string) {
  const supabase = await createClient()

  // Get current user
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return { error: 'Unauthorized. Please log in.' }
  }

  // Perform update check
  const { error } = await supabase
    .from('alerts')
    .update({ resolved: true })
    .eq('id', alertId)
    .eq('user_id', user.id) // Ensure security check

  if (error) {
    console.error('Error resolving alert:', error)
    return { error: error.message }
  }

  revalidatePath('/alerts')
  revalidatePath('/dashboard')
  return { success: true }
}

/**
 * Iterates over inventory, calculates stock metrics, and stores/updates alerts safely.
 */
export async function calculateAndStoreAlerts() {
  const supabase = await createClient()

  // 1. Get authenticated user
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return { error: 'Unauthorized. Please log in.' }
  }

  // 2. Fetch user's products
  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('*')
    .eq('user_id', user.id)

  if (productsError) {
    console.error('Error fetching products for alerts:', productsError)
    return { error: 'Failed to fetch products.' }
  }

  if (!products || products.length === 0) {
    return { success: true, message: 'No products to analyze.' }
  }

  // 3. Fetch user's sales history
  const { data: sales, error: salesError } = await supabase
    .from('sales')
    .select('product_id, sale_date, quantity')
    .eq('user_id', user.id)

  if (salesError) {
    console.error('Error fetching sales for alerts:', salesError)
    return { error: 'Failed to fetch sales history.' }
  }

  // 4. Fetch all existing active (unresolved) alerts for deduplication checks
  // NOTE: We no longer rely on the forecasts DB table for alert calculations.
  // Forecasts are computed inline from the same sales data so that alerts
  // are always based on fresh, consistent demand estimates.
  // This eliminates the stale-forecast problem where alerts and forecasts disagreed.
  const { data: existingActiveAlerts, error: activeAlertsError } = await supabase
    .from('alerts')
    .select('id, product_id, alert_type, resolved')
    .eq('user_id', user.id)
    .eq('resolved', false)

  if (activeAlertsError) {
    console.error('Error fetching existing active alerts:', activeAlertsError)
    return { error: 'Failed to fetch active alerts.' }
  }

  // Map database lists for quick in-memory grouping
  const salesMap = new Map<string, Array<{ sale_date: string; quantity: number }>>()
  products.forEach((p) => {
    salesMap.set(p.id, [])
  })

  sales?.forEach((s) => {
    const list = salesMap.get(s.product_id)
    if (list) list.push({ sale_date: s.sale_date, quantity: s.quantity })
  })

  // Generate inline forecasts for each product using the same forecasting engine
  // as the forecasts page — this guarantees alert calculations and forecast display agree.
  const forecastsMap = new Map<string, Array<{ forecast_date: string; predicted_demand: number }>>()
  products.forEach((p) => {
    const productSales = salesMap.get(p.id) || []
    const summary = generateProductForecast(p.id, productSales, 90)
    if (!summary.insufficientData && summary.forecastList.length > 0) {
      forecastsMap.set(
        p.id,
        summary.forecastList.map((f) => ({
          forecast_date: f.forecastDate,
          predicted_demand: f.predictedDemand,
        }))
      )
    } else {
      forecastsMap.set(p.id, [])
    }
  })

  // Fetch active purchase order items to account for incoming on-order stock
  const { data: activePOItems } = await supabase
    .from('purchase_order_items')
    .select('product_id, ordered_quantity, received_quantity, purchase_orders!inner(status)')
    .eq('user_id', user.id)
    .in('purchase_orders.status', ['draft', 'ordered', 'partially_received'])

  const onOrderMap = new Map<string, number>()
  interface RawPOItem {
    product_id: string
    ordered_quantity: number
    received_quantity: number
  }
  ;(activePOItems as unknown as RawPOItem[] || []).forEach((item) => {
    const remaining = Math.max(0, item.ordered_quantity - item.received_quantity)
    onOrderMap.set(item.product_id, (onOrderMap.get(item.product_id) || 0) + remaining)
  })

  // Evaluate alerts for every product in memory (current stock + on-order stock)
  // onOrderQty is added so we don't generate duplicate purchase recommendations
  // for stock already on its way. The raw current_stock is preserved separately
  // so the alert message can display what the DB actually has on shelves.
  const results: AlertEngineResult[] = products.map((product) => {
    const onOrderQty = onOrderMap.get(product.id) || 0
    const effectiveStock = product.current_stock + onOrderQty
    return evaluateProductAlert({
      productId: product.id,
      productName: product.name,
      currentStock: effectiveStock,
      price: Number(product.price),
      leadTimeDays: product.supplier_lead_time_days,
      salesHistory: salesMap.get(product.id) || [],
      forecasts: forecastsMap.get(product.id) || [],
      shelfLifeDays: product.shelf_life_days
    })
  })

  const newAlertsToInsert: Array<{
    user_id: string
    product_id: string
    alert_type: 'stockout' | 'overstock' | 'reorder'
    severity: 'low' | 'medium' | 'high' | 'critical'
    message: string
    recommended_quantity: number
    resolved: boolean
  }> = []
  const alertsToUpdate: Array<{ id: string; message: string; severity: string; recommended_quantity: number }> = []
  const alertsToResolve: string[] = [] // IDs of old active alerts that are now healthy

  const productMap = new Map<string, typeof products[0]>()
  products.forEach((p) => productMap.set(p.id, p))

  // Match computed statuses against database active alerts
  results.forEach((res) => {
    // 1. Get all active alerts currently registered for this product
    const matchingActive = (existingActiveAlerts || []).filter(
      (a) => a.product_id === res.productId
    )

    if (res.alertType === 'none') {
      // Product is healthy. Any active alerts for it should be resolved!
      matchingActive.forEach((a) => alertsToResolve.push(a.id))
      return
    }

    // Product has an active warning (stockout, overstock, or reorder)
    const alertSeverity = res.priority === 'critical' ? 'critical'
      : res.priority === 'warning' ? 'medium'
      : 'low'

    const existingAlertsOfSameType = matchingActive.filter(
      (a) => a.alert_type === res.alertType
    )

    // Build serialized JSON message body
    const matchingProd = productMap.get(res.productId)
    const onOrderQty = onOrderMap.get(res.productId) || 0
    const alertMessage = JSON.stringify({
      reason: res.reason,
      currentStock: matchingProd?.current_stock || 0,  // actual shelf stock (without on-order)
      onOrderStock: onOrderQty,
      avgDailyDemand: res.avgDailyDemand,
      leadTimeDays: matchingProd?.supplier_lead_time_days || 0,
      shelfLifeDays: res.shelfLifeDays,
      replenishmentCycleDays: res.replenishmentCycleDays,
      expectedDemand: res.expectedDemand,
      safetyStock: res.safetyStock,
      maxSellableDemand: res.maxSellableDemand,
      recommendedQty: res.recommendedReorderQuantity
    })

    if (existingAlertsOfSameType.length > 0) {
      const primaryAlert = existingAlertsOfSameType[0]
      // Update existing alert with new stats / message JSON
      alertsToUpdate.push({
        id: primaryAlert.id,
        message: alertMessage,
        severity: alertSeverity,
        recommended_quantity: res.recommendedReorderQuantity
      })
      
      // Resolve any secondary duplicate active alerts of the same type
      existingAlertsOfSameType.slice(1).forEach((a) => alertsToResolve.push(a.id))
      
      // If there are other active alerts of a DIFFERENT type on this same product, resolve them
      matchingActive
        .filter((a) => a.alert_type !== res.alertType)
        .forEach((a) => alertsToResolve.push(a.id))
    } else {
      // Create new alert row
      newAlertsToInsert.push({
        user_id: user.id,
        product_id: res.productId,
        alert_type: res.alertType,
        severity: alertSeverity,
        message: alertMessage,
        recommended_quantity: res.recommendedReorderQuantity,
        resolved: false
      })

      // Resolve any older mismatched active alert types
      matchingActive.forEach((a) => alertsToResolve.push(a.id))
    }
  })

  // Batch resolve old alerts (mark as resolved)
  if (alertsToResolve.length > 0) {
    const { error: resolveErr } = await supabase
      .from('alerts')
      .update({ resolved: true })
      .in('id', alertsToResolve)

    if (resolveErr) {
      console.error('Error resolving old alerts:', resolveErr)
      return { error: 'Failed to resolve old alerts.' }
    }
  }

  // Batch update existing alerts
  for (const upd of alertsToUpdate) {
    await supabase
      .from('alerts')
      .update({
        message: upd.message,
        severity: upd.severity,
        recommended_quantity: upd.recommended_quantity,
        created_at: new Date().toISOString() // refresh timestamp
      })
      .eq('id', upd.id)
  }

  // Batch insert new alerts
  if (newAlertsToInsert.length > 0) {
    const { error: insertErr } = await supabase
      .from('alerts')
      .insert(newAlertsToInsert)

    if (insertErr) {
      console.error('Error inserting new alerts:', insertErr)
      return { error: insertErr.message }
    }
  }



  return {
    success: true,
    analyzedCount: products.length,
    insertedCount: newAlertsToInsert.length,
    updatedCount: alertsToUpdate.length,
    resolvedCount: alertsToResolve.length
  }
}
