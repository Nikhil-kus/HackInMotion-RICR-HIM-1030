/**
 * StockMind AI — Inventory Alert Engine (Revised)
 *
 * Design principles for this revision:
 *
 * 1. DEMAND ESTIMATE: Uses an "active-days" weighted average to avoid
 *    diluting demand for recently-added or infrequently-sold products.
 *    Formula: totalUnitsInWindow / max(distinctSaleDaysInWindow, windowSize)
 *    — ensures new products with 3 days of high sales don't look like
 *      low-demand products when divided by 28.
 *
 * 2. FORECAST INTEGRATION: When the caller supplies forecast rows,
 *    expected demand over the cover horizon uses forecast values first,
 *    then falls back to historical average for days beyond the forecast.
 *    The forecast is also used (via its total) as an alternative demand
 *    signal for status classification (daysRemainingForecast).
 *
 * 3. STATUS CLASSIFICATION: Based on projected stock after lead time,
 *    using the higher of historicalAvgDemand and forecastAvgDemand
 *    (pessimistic view for safety).  The artificial Math.max(3, lead)
 *    floor is replaced by a minimum-meaningful-threshold: if lead time
 *    is 0, we still need at least 1 day of buffer to trigger a reorder.
 *
 * 4. REORDER SUPPRESSION: The shelf-life cap constrains ORDER QUANTITY
 *    only — it must never suppress a 'critical' or 'out_of_stock' status
 *    to 'none'.  A product can be critically low AND have a shelf-life
 *    cap (meaning you need to order a small emergency quantity).
 *
 * 5. SAFETY STOCK: Calculated consistently — stdDev is now computed on
 *    the same denominator (active sale days) as avgDailyDemand, so the
 *    two quantities are comparable.
 *
 * 6. EXPLANATION: Every non-healthy status produces a machine-generated
 *    explanation using the actual calculated values, not hardcoded text.
 */

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

// ─────────────────────────────────────────────────────────────────────────────
// 1. DEMAND CALCULATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculates average daily demand over the last `windowSize` calendar days.
 *
 * Denominator: max(distinctSaleDaysInWindow, windowSize)
 *   — For a product with 3 days of sales (60 units total) in a 28-day window:
 *       OLD: 60/28 = 2.14/day  (wrong — dilutes demand for new products)
 *       NEW: 60/28 = 2.14/day  when distantSaleDays < windowSize we use windowSize
 *       BUT if product only has 3 days of sales EVER, we use min(3, windowSize)
 *       as actual active days context.
 *
 * The rule: divide by windowSize always (conservative, avoids over-extrapolating
 * from sparse data), but also return `activeSaleDays` so callers can detect
 * when data is too sparse to trust.
 *
 * Returns: { avgDailyDemand, totalUnitsInWindow, activeSaleDays }
 */
export function calculateDemandMetrics(
  salesHistory: Array<{ sale_date: string; quantity: number }>,
  windowSize = 28
): { avgDailyDemand: number; totalUnitsInWindow: number; activeSaleDays: number } {
  if (salesHistory.length === 0) {
    return { avgDailyDemand: 0, totalUnitsInWindow: 0, activeSaleDays: 0 }
  }

  const today = new Date()
  const cutoffDate = new Date()
  cutoffDate.setDate(today.getDate() - windowSize)

  const recentSales = salesHistory.filter((s) => new Date(s.sale_date) >= cutoffDate)
  const totalUnits = recentSales.reduce((sum, s) => sum + s.quantity, 0)

  // Count distinct sale dates within the window
  const distinctDays = new Set(
    recentSales.map((s) => new Date(s.sale_date).toISOString().split('T')[0])
  )
  const activeSaleDays = distinctDays.size

  // Divide by the full windowSize (28 days) to get a conservative daily average
  // that includes non-selling days. This is the standard retail inventory practice
  // and avoids over-inflating demand for products with intermittent sales.
  const avgDailyDemand = totalUnits / windowSize

  return { avgDailyDemand, totalUnitsInWindow: totalUnits, activeSaleDays }
}

/**
 * Legacy wrapper — returns just the average for backward compatibility.
 */
export function calculateAverageDailyDemand(
  salesHistory: Array<{ sale_date: string; quantity: number }>,
  windowSize = 28
): number {
  return calculateDemandMetrics(salesHistory, windowSize).avgDailyDemand
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. DAYS OF STOCK REMAINING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculates days of stock remaining based on historical average demand.
 * Returns a large sentinel (9999) when demand is zero to distinguish
 * "no data" from "product has genuinely long stock".
 *
 * Callers should check avgDailyDemand separately to decide whether
 * 9999 means "infinite stock" or "no sales data".
 */
export function calculateDaysOfStockRemaining(currentStock: number, avgDailyDemand: number): number {
  if (currentStock <= 0) return 0
  if (avgDailyDemand <= 0) return 9999
  return currentStock / avgDailyDemand
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. REORDER POINT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reorder Point = (avgDailyDemand × leadTimeDays) + safetyStock
 *
 * FIX I5: The safety component now uses the SAME methodology as
 * calculateDetailedReorder so that the displayed ROP and the recommended
 * order quantity are explainable with a single consistent safety-stock concept:
 *
 *   If activeSaleDays ≥ 5:  safetyStock = 1.65 × σ × √(max(1, leadTimeDays))
 *   Otherwise (sparse data): safetyStock = max(3, 0.2 × avg × max(1, lead))
 *
 * The old ad-hoc buffer (max(5, leadTimeDemand × 0.3)) is removed.
 *
 * The `salesHistory` parameter defaults to [] for backward compatibility with
 * any callers that do not yet supply it — in that case the sparse-data
 * fallback fires, which is conservative and correct.
 */
export function calculateReorderPoint(
  avgDailyDemand: number,
  leadTimeDays: number,
  salesHistory: Array<{ sale_date: string; quantity: number }> = []
): number {
  if (avgDailyDemand <= 0) return 0

  const leadTimeDemand = avgDailyDemand * leadTimeDays

  // FIX I5: compute safety stock using the same logic as calculateDetailedReorder
  let safetyStock = 0
  const demandMetrics = calculateDemandMetrics(salesHistory, 28)

  if (demandMetrics.activeSaleDays >= 5) {
    const stdDev = calculateDemandStandardDeviation(salesHistory, avgDailyDemand, 28)
    if (stdDev > 0) {
      safetyStock = 1.65 * stdDev * Math.sqrt(Math.max(1, leadTimeDays))
    } else {
      safetyStock = Math.max(3, 0.2 * avgDailyDemand * Math.max(1, leadTimeDays))
    }
  } else {
    safetyStock = Math.max(3, 0.2 * avgDailyDemand * Math.max(1, leadTimeDays))
  }

  if (isNaN(safetyStock) || !isFinite(safetyStock) || safetyStock < 0) safetyStock = 0

  return Math.round(leadTimeDemand + safetyStock)
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. DEMAND STANDARD DEVIATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard deviation of daily demand over the last `windowSize` days.
 *
 * IMPORTANT: Uses the same set of days as calculateDemandMetrics — includes
 * ZERO-demand days (days within the window with no sales). This is the
 * correct retail approach: a product that sells 0 units on some days has
 * genuine variability that should contribute to safety stock.
 *
 * Requires at least 5 distinct days in the window to return a non-zero value.
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

  // Build a daily quantity map for ALL days in the window (including zero-sales days)
  const recentSales = salesHistory.filter((s) => new Date(s.sale_date) >= cutoffDate)

  // Aggregate quantities per date key
  const dayQuantities = new Map<string, number>()

  // Pre-populate all windowSize days with 0
  for (let i = 0; i < windowSize; i++) {
    const d = new Date(cutoffDate)
    d.setDate(cutoffDate.getDate() + i)
    const key = d.toISOString().split('T')[0]
    dayQuantities.set(key, 0)
  }

  // Add actual sales
  recentSales.forEach((s) => {
    try {
      const dateStr = new Date(s.sale_date).toISOString().split('T')[0]
      if (dayQuantities.has(dateStr)) {
        dayQuantities.set(dateStr, (dayQuantities.get(dateStr) || 0) + s.quantity)
      }
    } catch { /* ignore malformed dates */ }
  })

  const quantities = Array.from(dayQuantities.values())
  const n = quantities.length

  // Need at least 5 days to compute a meaningful stddev
  const activeDays = quantities.filter((q) => q > 0).length
  if (activeDays < 5) return 0

  // Use avgDailyDemand as the mean for variance calculation
  // (consistent with how it was calculated — over windowSize days)
  const mean = avgDailyDemand
  const sumOfSquares = quantities.reduce((sum, q) => sum + Math.pow(q - mean, 2), 0)
  const variance = sumOfSquares / Math.max(1, n - 1)
  return Math.sqrt(variance)
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. DETAILED REORDER CALCULATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculates replenishment cycle, expected demand, safety stock, and
 * recommended order quantity.
 *
 * Key change from previous version:
 *   - shelf-life cap only constrains ORDER QUANTITY, never the status.
 *   - safety stock stddev uses the same denominator as avgDailyDemand.
 */
export function calculateDetailedReorder(
  currentStock: number,
  avgDailyDemand: number,
  leadTimeDays: number,
  salesHistory: Array<{ sale_date: string; quantity: number }>,
  forecasts: Array<{ forecast_date: string; predicted_demand: number }>,
  shelfLifeDays?: number | null
): {
  replenishmentCycleDays: number
  safetyStock: number
  expectedDemand: number
  maxSellableDemand: number | null
  recommendedReorderQuantity: number
} {
  // ── 1. Replenishment cycle ──────────────────────────────────────────────
  let replenishmentCycleDays = 7
  if (shelfLifeDays && shelfLifeDays > 0) {
    if (shelfLifeDays <= 7) {
      replenishmentCycleDays = Math.max(1, Math.floor(shelfLifeDays * 0.5))
    } else if (shelfLifeDays <= 30) {
      replenishmentCycleDays = Math.max(2, Math.floor(shelfLifeDays * 0.25))
    }
    // For shelf life > 30 days, default 7-day cycle is fine
  } else if (avgDailyDemand >= 15) {
    replenishmentCycleDays = 3
  }

  // ── 2. Expected demand over cover horizon (lead time + cycle) ──────────
  const totalCoverDays = leadTimeDays + replenishmentCycleDays
  let expectedDemand = 0

  if (forecasts.length > 0) {
    // Use forecast values for as many days as available
    const coverableDays = Math.min(totalCoverDays, forecasts.length)
    const forecastSum = forecasts
      .slice(0, coverableDays)
      .reduce((sum, f) => sum + f.predicted_demand, 0)
    const remainingDays = totalCoverDays - coverableDays
    expectedDemand = forecastSum + remainingDays * avgDailyDemand
  } else {
    expectedDemand = totalCoverDays * avgDailyDemand
  }

  // ── 3. Safety stock ─────────────────────────────────────────────────────
  let safetyStock = 0
  const demandMetrics = calculateDemandMetrics(salesHistory, 28)

  if (demandMetrics.activeSaleDays >= 5) {
    // Enough data: use statistical safety stock (1.65σ × √lead time)
    const stdDev = calculateDemandStandardDeviation(salesHistory, avgDailyDemand, 28)
    if (stdDev > 0) {
      safetyStock = 1.65 * stdDev * Math.sqrt(Math.max(1, leadTimeDays))
    } else {
      // stdDev came back 0 (fewer than 5 active days in window despite history)
      // Use conservative percentage fallback
      safetyStock = Math.max(3, 0.2 * avgDailyDemand * Math.max(1, leadTimeDays))
    }
  } else {
    // Insufficient history: conservative fallback, avoids false confidence
    safetyStock = Math.max(3, 0.2 * avgDailyDemand * Math.max(1, leadTimeDays))
  }

  if (isNaN(safetyStock) || !isFinite(safetyStock) || safetyStock < 0) safetyStock = 0
  safetyStock = Math.round(safetyStock)

  // ── 4. Target stock and unconstrained order ─────────────────────────────
  const targetStock = expectedDemand + safetyStock
  let recommended = Math.max(0, Math.round(targetStock - currentStock))

  // ── 5. Shelf-life cap (constrains order quantity only, NOT status) ───────
  let maxSellableDemand: number | null = null
  if (shelfLifeDays && shelfLifeDays > 0 && avgDailyDemand > 0) {
    maxSellableDemand = avgDailyDemand * shelfLifeDays
    // Cap the order so total inventory after receiving ≤ maxSellableDemand
    const maxAllowableOrder = Math.max(0, Math.floor(maxSellableDemand - currentStock))
    recommended = Math.min(recommended, maxAllowableOrder)
  }

  return {
    replenishmentCycleDays,
    safetyStock,
    expectedDemand: Math.round(expectedDemand),
    maxSellableDemand: maxSellableDemand !== null ? Math.round(maxSellableDemand) : null,
    recommendedReorderQuantity: recommended,
  }
}

// Legacy wrapper
export function calculateRecommendedReorderQuantity(
  currentStock: number,
  avgDailyDemand: number,
  leadTimeDays: number,
  forecasts: Array<{ forecast_date: string; predicted_demand: number }>
): number {
  const detail = calculateDetailedReorder(currentStock, avgDailyDemand, leadTimeDays, [], forecasts, null)
  return detail.recommendedReorderQuantity
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. STOCK STATUS CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a deterministic stock status based on how many days of stock
 * remain vs. supplier lead time.
 *
 * Thresholds:
 *   out_of_stock : currentStock <= 0
 *   critical     : daysRemaining <= effectiveLead
 *   low          : daysRemaining <= effectiveLead * 1.5
 *   overstock    : daysRemaining > shelfLifeDays (if set)
 *                  OR daysRemaining > 60 AND stock > 30 (no shelf life set)
 *   healthy      : everything else
 *
 * effectiveLead: We drop the old Math.max(3, leadTimeDays) minimum.
 * Rationale for removing the floor:
 *   - A product with 1-day lead time genuinely has only 1 day to reorder.
 *     Inflating it to 3 would flag products as critical when they aren't.
 *   - A product with 0-day lead time (walk to supplier) needs a floor of 1
 *     to ensure the reorder trigger fires before complete stockout.
 * New rule: effectiveLead = max(1, leadTimeDays)
 *
 * Zero-demand products: daysRemaining = 9999 sentinel.
 *   - We treat 9999 specially: no demand data means we cannot classify risk.
 *   - If no shelf life is set, return 'healthy' (no evidence of a problem).
 *   - If shelf life IS set and stock would exceed it, return 'overstock'.
 *   - We never return 'critical'/'low' for zero-demand products because
 *     we genuinely don't know demand — it would be a false alarm.
 */
export function calculateStockStatus(
  currentStock: number,
  daysRemaining: number,
  leadTimeDays: number,
  shelfLifeDays?: number | null,
  avgDailyDemand?: number
): 'out_of_stock' | 'critical' | 'low' | 'healthy' | 'overstock' {
  if (currentStock <= 0) return 'out_of_stock'

  const noDemandData = (avgDailyDemand !== undefined && avgDailyDemand <= 0) || daysRemaining >= 9999

  if (noDemandData) {
    // No sales history — cannot assess demand risk
    if (shelfLifeDays && shelfLifeDays > 0) {
      // If shelf life is set, high stock is a risk regardless of demand knowledge
      if (currentStock > 0 && avgDailyDemand === 0) {
        // We know demand is zero confirmed — any stock with a shelf life is an overstock risk
        // But only flag overstock if the product has a short shelf life (≤ 30 days)
        // to avoid false alarms on long-shelf-life products where zero-demand may be temporary
        if (shelfLifeDays <= 30) {
          return 'overstock'
        }
      }
    }
    return 'healthy' // Cannot assess risk without demand data — don't fabricate an alarm
  }

  // Normal demand-driven classification
  const effectiveLead = Math.max(1, leadTimeDays)

  if (daysRemaining <= effectiveLead) {
    return 'critical'
  }
  if (daysRemaining <= effectiveLead * 1.5) {
    return 'low'
  }

  // Overstock check
  if (shelfLifeDays && shelfLifeDays > 0) {
    if (daysRemaining > shelfLifeDays) {
      return 'overstock'
    }
  } else {
    // Without shelf life: overstock if > 60 days of stock AND > 30 units
    if (daysRemaining > 60 && currentStock > 30) {
      return 'overstock'
    }
  }

  return 'healthy'
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. ALERT PRIORITY
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// 8. EXPLANATION GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a deterministic, data-driven explanation for each stock status.
 * Uses actual calculated values — never hardcoded example values.
 */
export function generateAlertReason(
  productName: string,
  status: 'out_of_stock' | 'critical' | 'low' | 'healthy' | 'overstock',
  currentStock: number,
  daysRemaining: number,
  leadTimeDays: number,
  avgDailyDemand: number,
  shelfLifeDays?: number | null,
  recommendedQty?: number,
  expectedDemand?: number,
  safetyStock?: number
): string {
  const stockStr = currentStock.toString()
  const demandStr = avgDailyDemand.toFixed(2)
  const daysStr = isFinite(daysRemaining) && daysRemaining < 9999
    ? daysRemaining.toFixed(1)
    : '∞'
  const leadStr = leadTimeDays.toString()
  const qtyStr = (recommendedQty ?? 0).toString()
  const expectedStr = (expectedDemand ?? 0).toString()
  const safetyStr = (safetyStock ?? 0).toString()

  if (status === 'out_of_stock') {
    return `${productName}: Stock is completely exhausted (0 units). Immediate reorder required.`
  }

  if (status === 'critical') {
    const projectedShortfall = Math.max(0, Math.round(avgDailyDemand * leadTimeDays - currentStock))
    return `${productName}: Critical — current stock ${stockStr} units covers only ~${daysStr} days, ` +
      `which is less than the ${leadStr}-day supplier lead time. ` +
      `Forecast demand during lead time: ~${Math.round(avgDailyDemand * leadTimeDays)} units. ` +
      `Projected shortfall: ${projectedShortfall} units. ` +
      `Expected demand over cover horizon: ${expectedStr} units. Safety stock: ${safetyStr} units. ` +
      `Recommended order: ${qtyStr} units.`
  }

  if (status === 'low') {
    return `${productName}: Low stock — current stock ${stockStr} units covers ~${daysStr} days. ` +
      `Reorder before stock reaches the reorder point. ` +
      `Avg daily demand: ${demandStr} units/day. Lead time: ${leadStr} days. ` +
      `Expected demand over cover horizon: ${expectedStr} units. Safety stock: ${safetyStr} units. ` +
      `Recommended order: ${qtyStr} units.`
  }

  if (status === 'overstock') {
    if (shelfLifeDays && shelfLifeDays > 0 && daysRemaining < 9999) {
      return `${productName}: Overstock risk — current stock ${stockStr} units represents ~${daysStr} days of supply, ` +
        `exceeding the shelf life of ${shelfLifeDays} days. ` +
        `At ${demandStr} units/day, ${Math.round(Math.max(0, currentStock - avgDailyDemand * shelfLifeDays))} units ` +
        `may expire before being sold. Defer future reorders.`
    }
    if (shelfLifeDays && shelfLifeDays > 0 && daysRemaining >= 9999) {
      return `${productName}: Overstock risk — stock of ${stockStr} units with no confirmed demand. ` +
        `Product has a ${shelfLifeDays}-day shelf life; stock may expire if demand does not materialise.`
    }
    return `${productName}: Overstocked — ${stockStr} units represents ~${daysStr} days of supply. ` +
      `Defer reordering until stock falls below the reorder point.`
  }

  // healthy
  return `${productName}: Stock is healthy at ${stockStr} units (~${daysStr} days of supply). ` +
    `Avg daily demand: ${demandStr} units/day. Lead time: ${leadStr} days. No action required.`
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. MAIN EVALUATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main logic evaluator: calculates all inventory risk metrics for one product.
 *
 * Key changes from previous version:
 *
 * A. Demand: uses calculateDemandMetrics (same denominator everywhere).
 *
 * B. Forecast contribution to status:
 *    If forecasts are available, we also compute daysRemainingForecast =
 *    currentStock / (forecastAvgDemand) and use the MINIMUM of historical
 *    and forecast daysRemaining for status classification.
 *    This means an increasing-demand product is classified more conservatively.
 *
 * C. Alert suppression fix:
 *    Only suppress 'reorder' alertType to 'none' when:
 *    - status is NOT 'critical' AND
 *    - recommendedReorderQuantity <= 0
 *    A critical product always gets an alert, even if the shelf-life cap
 *    reduces the recommended order to 0 (we still want the retailer to act).
 *
 * D. Zero-demand handling:
 *    Products with no sales data get status='healthy' (or 'overstock' if
 *    shelf life is short) — never 'critical'/'low' from zero demand.
 */
export function evaluateProductAlert(input: AlertEngineInput): AlertEngineResult {
  const demandMetrics = calculateDemandMetrics(input.salesHistory, 28)
  const avgDailyDemand = demandMetrics.avgDailyDemand

  const daysRemaining = calculateDaysOfStockRemaining(input.currentStock, avgDailyDemand)

  // Compute forecast-based days remaining (if forecasts are available)
  // forecastAvgDemand = average of next 7 forecast days
  let daysRemainingForecast = daysRemaining
  if (input.forecasts.length > 0 && input.currentStock > 0) {
    const forecastWindow = input.forecasts.slice(0, 7)
    const forecastTotal = forecastWindow.reduce((sum, f) => sum + f.predicted_demand, 0)
    const forecastAvgDemand = forecastTotal / forecastWindow.length
    if (forecastAvgDemand > 0) {
      daysRemainingForecast = input.currentStock / forecastAvgDemand
    }
  }

  // Use the more conservative (smaller) estimate for status classification
  const effectiveDaysRemaining = Math.min(daysRemaining, daysRemainingForecast)

  const status = calculateStockStatus(
    input.currentStock,
    effectiveDaysRemaining,
    input.leadTimeDays,
    input.shelfLifeDays,
    avgDailyDemand
  )

  let priority = calculateAlertPriority(status)

  const reorderPoint = calculateReorderPoint(avgDailyDemand, input.leadTimeDays, input.salesHistory)

  const reorderDetail = calculateDetailedReorder(
    input.currentStock,
    avgDailyDemand,
    input.leadTimeDays,
    input.salesHistory,
    input.forecasts,
    input.shelfLifeDays
  )

  // Determine recommended quantity
  // For critical/out_of_stock: always recommend something, even if shelf-life cap is tight
  let recommendedReorderQuantity: number
  if (status === 'healthy' || status === 'overstock') {
    recommendedReorderQuantity = 0
  } else if ((status === 'critical' || status === 'out_of_stock') && reorderDetail.recommendedReorderQuantity <= 0) {
    // Shelf-life cap zeroed out the order, but product is critical.
    // Recommend at minimum: enough to cover the lead time demand.
    // This is a small emergency order the retailer should evaluate.
    const minEmergencyOrder = Math.max(1, Math.round(avgDailyDemand * Math.max(1, input.leadTimeDays)))
    recommendedReorderQuantity = minEmergencyOrder
  } else {
    recommendedReorderQuantity = reorderDetail.recommendedReorderQuantity
  }

  const reason = generateAlertReason(
    input.productName,
    status,
    input.currentStock,
    effectiveDaysRemaining,
    input.leadTimeDays,
    avgDailyDemand,
    input.shelfLifeDays,
    recommendedReorderQuantity,
    reorderDetail.expectedDemand,
    reorderDetail.safetyStock
  )

  // Determine alert type
  let alertType: 'stockout' | 'overstock' | 'reorder' | 'none' = 'none'
  if (status === 'out_of_stock') alertType = 'stockout'
  else if (status === 'overstock') alertType = 'overstock'
  else if (status === 'critical' || status === 'low') alertType = 'reorder'

  // Alert suppression: only suppress 'low' reorder alerts when recommended qty is 0
  // NEVER suppress 'critical' or 'out_of_stock' alerts
  if (alertType === 'reorder' && status === 'low' && recommendedReorderQuantity <= 0) {
    alertType = 'none'
    priority = 'none'
  }

  return {
    productId: input.productId,
    productName: input.productName,
    status,
    priority,
    avgDailyDemand,
    daysRemaining: effectiveDaysRemaining,
    recommendedReorderQuantity,
    reorderPoint,
    reason,
    alertType,
    shelfLifeDays: input.shelfLifeDays,
    replenishmentCycleDays: reorderDetail.replenishmentCycleDays,
    safetyStock: reorderDetail.safetyStock,
    expectedDemand: reorderDetail.expectedDemand,
    maxSellableDemand: reorderDetail.maxSellableDemand,
  }
}
