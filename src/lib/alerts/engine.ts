export interface AlertEngineInput {
  productId: string
  productName: string
  currentStock: number
  price: number
  leadTimeDays: number
  salesHistory: Array<{ sale_date: string; quantity: number }>
  forecasts: Array<{ forecast_date: string; predicted_demand: number }>
  shelfLifeDays?: number | null
}

export interface AlertEngineResult {
  productId: string
  productName: string
  status: 'out_of_stock' | 'critical' | 'low' | 'healthy' | 'overstock'
  priority: 'critical' | 'warning' | 'info' | 'none'
  avgDailyDemand: number
  daysRemaining: number
  recommendedReorderQuantity: number
  reorderPoint: number
  reason: string
  alertType: 'stockout' | 'overstock' | 'reorder' | 'none'
  shelfLifeDays?: number | null
  replenishmentCycleDays: number
  safetyStock: number
  expectedDemand: number
  maxSellableDemand?: number | null
}

/**
 * 1. Calculates the average daily demand over the last 28 days of history.
 */
export function calculateAverageDailyDemand(
  salesHistory: Array<{ sale_date: string; quantity: number }>,
  windowSize = 28
): number {
  if (salesHistory.length === 0) return 0

  const today = new Date()
  const cutoffDate = new Date()
  cutoffDate.setDate(today.getDate() - windowSize)

  // Filter sales in cutoff window
  const recentSales = salesHistory.filter((s) => new Date(s.sale_date) >= cutoffDate)
  const totalUnits = recentSales.reduce((sum, s) => sum + s.quantity, 0)

  // Avoid dividing by 0, standard return is units divided by the active window span
  return totalUnits / windowSize
}

/**
 * 2. Safely calculates days of stock remaining.
 */
export function calculateDaysOfStockRemaining(currentStock: number, avgDailyDemand: number): number {
  if (currentStock <= 0) return 0
  if (avgDailyDemand <= 0) return 999 // Represent infinite/very high stock safely
  return currentStock / avgDailyDemand
}

/**
 * 3. Calculates the Reorder Point.
 * Formula: (Average Daily Demand * Lead Time Days) + Safety Buffer
 */
export function calculateReorderPoint(avgDailyDemand: number, leadTimeDays: number): number {
  const leadTimeDemand = avgDailyDemand * leadTimeDays
  // Safety buffer is 30% of lead time demand, or at least 5 units if lead time is very short
  const safetyBuffer = Math.max(5, leadTimeDemand * 0.3)
  return leadTimeDemand + safetyBuffer
}

/**
 * 4. Calculates recommended reorder quantity.
 * Reorder quantity is designed to cover the lead time + 14-day stock buffer.
 */
/**
 * Calculates demand standard deviation over a 28-day window.
 * Only aggregates days that have at least one sales record —
 * missing days are treated as missing data, not zero-demand days,
 * to avoid inflating stddev when sales history is sparse or bulk-imported.
 */
export function calculateDemandStandardDeviation(
  salesHistory: Array<{ sale_date: string; quantity: number }>,
  avgDailyDemand: number,
  windowSize = 28
): number {
  if (salesHistory.length === 0) return 0

  const today = new Date()
  const cutoffDate = new Date()
  cutoffDate.setDate(today.getDate() - windowSize)

  // Build per-day aggregated quantities for ONLY days that appear in the sales history
  const recentSales = salesHistory.filter((s) => new Date(s.sale_date) >= cutoffDate)
  const dayQuantities = new Map<string, number>()

  recentSales.forEach((s) => {
    try {
      const dateStr = new Date(s.sale_date).toISOString().split('T')[0]
      dayQuantities.set(dateStr, (dayQuantities.get(dateStr) || 0) + s.quantity)
    } catch {
      // ignore
    }
  })

  // Require at least 3 distinct sale days to compute a meaningful stddev
  if (dayQuantities.size < 3) return 0

  const quantities = Array.from(dayQuantities.values())
  const n = quantities.length
  // Use the actual per-day average over days with sales (not the overall avgDailyDemand)
  // so that the variance reflects real day-to-day sales variability
  const mean = quantities.reduce((sum, q) => sum + q, 0) / n
  const sumOfSquares = quantities.reduce((sum, q) => sum + Math.pow(q - mean, 2), 0)
  const variance = sumOfSquares / Math.max(1, n - 1)
  return Math.sqrt(variance)
}

/**
 * Calculates all parameters needed for realistic reordering and shelf-life cap.
 */
export function calculateDetailedReorder(
  currentStock: number,
  avgDailyDemand: number,
  leadTimeDays: number,
  salesHistory: Array<{ sale_date: string; quantity: number }>,
  forecasts: Array<{ forecast_date: string; predicted_demand: number }>,
  shelfLifeDays?: number | null
) {
  // 1. Determine replenishment cycle days
  let replenishmentCycleDays = 7
  if (shelfLifeDays && shelfLifeDays > 0) {
    if (shelfLifeDays <= 7) {
      replenishmentCycleDays = Math.max(1, Math.floor(shelfLifeDays * 0.5))
    } else if (shelfLifeDays <= 30) {
      replenishmentCycleDays = Math.max(2, Math.floor(shelfLifeDays * 0.25))
    }
  } else if (avgDailyDemand >= 15) {
    replenishmentCycleDays = 3
  }

  // 2. Expected Demand over Lead Time + Replenishment cycle using forecasts
  const totalCoverDays = leadTimeDays + replenishmentCycleDays
  let expectedDemand = 0
  if (forecasts.length > 0) {
    if (totalCoverDays <= 7) {
      expectedDemand = forecasts.slice(0, totalCoverDays).reduce((sum, f) => sum + f.predicted_demand, 0)
    } else {
      const first7DaysSum = forecasts.slice(0, 7).reduce((sum, f) => sum + f.predicted_demand, 0)
      const remainingDays = totalCoverDays - 7
      expectedDemand = first7DaysSum + (remainingDays * avgDailyDemand)
    }
  } else {
    expectedDemand = totalCoverDays * avgDailyDemand
  }

  // 3. Dynamic Safety Stock using standard deviation
  let safetyStock = 0
  const hasHistory = salesHistory.length >= 5
  if (hasHistory) {
    const stdDev = calculateDemandStandardDeviation(salesHistory, avgDailyDemand, 28)
    if (stdDev > 0) {
      // Sufficient distinct daily observations — use statistical formula
      const rawSafetyStock = 1.65 * stdDev * Math.sqrt(Math.max(1, leadTimeDays))
      safetyStock = rawSafetyStock
    } else {
      // stdDev returned 0 = fewer than 3 distinct sale days observed.
      // Insufficient history → conservative fallback (do NOT treat as zero variability)
      safetyStock = Math.max(5, 0.2 * avgDailyDemand * Math.max(1, leadTimeDays))
    }
  } else {
    // Not enough total records → conservative fallback
    safetyStock = Math.max(5, 0.2 * avgDailyDemand * Math.max(1, leadTimeDays))
  }

  if (isNaN(safetyStock) || !isFinite(safetyStock) || safetyStock < 0) {
    safetyStock = 0
  }
  safetyStock = Math.round(safetyStock)

  // 4. Target Stock
  const targetStock = expectedDemand + safetyStock

  // 5. Unconstrained Recommended Order
  let recommended = Math.max(0, Math.round(targetStock - currentStock))

  // 6. Max Sellable Demand (Shelf-Life constraint)
  // Use Math.floor to ensure total inventory never exceeds avgDailyDemand × shelfLifeDays
  let maxSellableDemand: number | null = null
  if (shelfLifeDays && shelfLifeDays > 0) {
    maxSellableDemand = avgDailyDemand * shelfLifeDays
    // floor(MSD - currentStock) ensures 2 + order <= MSD exactly (no rounding overshoot)
    const maxAllowableOrder = Math.max(0, Math.floor(maxSellableDemand - currentStock))
    recommended = Math.min(recommended, maxAllowableOrder)
  }

  return {
    replenishmentCycleDays,
    safetyStock,
    expectedDemand: Math.round(expectedDemand),
    maxSellableDemand: maxSellableDemand !== null ? Math.round(maxSellableDemand) : null,
    recommendedReorderQuantity: recommended
  }
}

export function calculateRecommendedReorderQuantity(
  currentStock: number,
  avgDailyDemand: number,
  leadTimeDays: number,
  forecasts: Array<{ forecast_date: string; predicted_demand: number }>
): number {
  const detail = calculateDetailedReorder(currentStock, avgDailyDemand, leadTimeDays, [], forecasts, null)
  return detail.recommendedReorderQuantity
}

/**
 * 5. Returns deterministic Stock Status.
 */
export function calculateStockStatus(
  currentStock: number,
  daysRemaining: number,
  leadTimeDays: number,
  shelfLifeDays?: number | null
): 'out_of_stock' | 'critical' | 'low' | 'healthy' | 'overstock' {
  if (currentStock <= 0) return 'out_of_stock'

  const effectiveLeadTime = Math.max(3, leadTimeDays)

  if (daysRemaining <= effectiveLeadTime) {
    return 'critical'
  }
  if (daysRemaining <= effectiveLeadTime * 1.8) {
    return 'low'
  }
  if (shelfLifeDays && shelfLifeDays > 0) {
    if (daysRemaining > shelfLifeDays) {
      return 'overstock'
    }
  } else if (daysRemaining > 60 && currentStock > 30) {
    return 'overstock'
  }
  return 'healthy'
}

/**
 * 6. Maps stock status to severity priority levels.
 */
export function calculateAlertPriority(
  status: 'out_of_stock' | 'critical' | 'low' | 'healthy' | 'overstock'
): 'critical' | 'warning' | 'info' | 'none' {
  switch (status) {
    case 'out_of_stock':
    case 'critical':
      return 'critical'
    case 'low':
      return 'warning'
    case 'overstock':
      return 'info'
    case 'healthy':
    default:
      return 'none'
  }
}

/**
 * 7. Formulates readable alert notifications.
 */
export function generateAlertReason(
  productName: string,
  status: 'out_of_stock' | 'critical' | 'low' | 'healthy' | 'overstock',
  currentStock: number,
  daysRemaining: number,
  leadTimeDays: number,
  avgDailyDemand: number,
  shelfLifeDays?: number | null,
  recommendedQty?: number
): string {
  const demandStr = avgDailyDemand.toFixed(1)
  const shelfStr = shelfLifeDays ? `, and shelf life is ${shelfLifeDays} days` : ''

  if (status === 'out_of_stock') {
    return `"${productName}" is completely out of stock. Immediate reorder required.`
  }

  if (shelfLifeDays && shelfLifeDays > 0) {
    if (status === 'overstock') {
      return `"${productName}" has exceeded its shelf life of ${shelfLifeDays} days with ~${daysRemaining.toFixed(1)} days of stock remaining. High risk of wastage/expiry.`
    }
    return `"${productName}" is selling approximately ${demandStr} units/day, supplier lead time is ${leadTimeDays} days${shelfStr}. Current stock is only ${currentStock} units, so a limited replenishment of ${recommendedQty || 0} units is recommended to cover expected demand without excessive expiry risk.`
  }

  switch (status) {
    case 'critical':
      return `"${productName}" has only ~${daysRemaining.toFixed(1)} days of stock remaining, which is below the supplier lead time of ${leadTimeDays} days. Risk of stockout.`
    case 'low':
      return `"${productName}" is running low with ~${daysRemaining.toFixed(1)} days of stock remaining. Reorder soon.`
    case 'overstock':
      return `"${productName}" is overstocked with ${currentStock} units (~${daysRemaining.toFixed(1)} days of supply). Future reorders should be deferred.`
    case 'healthy':
    default:
      return `"${productName}" has a long shelf life, so the recommendation is primarily based on expected demand, supplier lead time, and safety stock.`
  }
}

/**
 * Main logic evaluator for calculating single product alert status.
 */
export function evaluateProductAlert(input: AlertEngineInput): AlertEngineResult {
  const avgDailyDemand = calculateAverageDailyDemand(input.salesHistory, 28)
  const daysRemaining = calculateDaysOfStockRemaining(input.currentStock, avgDailyDemand)
  
  const status = calculateStockStatus(input.currentStock, daysRemaining, input.leadTimeDays, input.shelfLifeDays)
  const priority = calculateAlertPriority(status)
  const reorderPoint = calculateReorderPoint(avgDailyDemand, input.leadTimeDays)
  
  const reorderDetail = calculateDetailedReorder(
    input.currentStock,
    avgDailyDemand,
    input.leadTimeDays,
    input.salesHistory,
    input.forecasts,
    input.shelfLifeDays
  )
  
  const recommendedReorderQuantity = status === 'healthy' || status === 'overstock'
    ? 0
    : reorderDetail.recommendedReorderQuantity

  const reason = generateAlertReason(
    input.productName,
    status,
    input.currentStock,
    daysRemaining,
    input.leadTimeDays,
    avgDailyDemand,
    input.shelfLifeDays,
    recommendedReorderQuantity
  )

  let alertType: 'stockout' | 'overstock' | 'reorder' | 'none' = 'none'
  if (status === 'out_of_stock') alertType = 'stockout'
  else if (status === 'overstock') alertType = 'overstock'
  else if (status === 'critical' || status === 'low') alertType = 'reorder'

  return {
    productId: input.productId,
    productName: input.productName,
    status,
    priority,
    avgDailyDemand,
    daysRemaining,
    recommendedReorderQuantity,
    reorderPoint,
    reason,
    alertType,
    shelfLifeDays: input.shelfLifeDays,
    replenishmentCycleDays: reorderDetail.replenishmentCycleDays,
    safetyStock: reorderDetail.safetyStock,
    expectedDemand: reorderDetail.expectedDemand,
    maxSellableDemand: reorderDetail.maxSellableDemand
  }
}
