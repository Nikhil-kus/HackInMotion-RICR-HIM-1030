'use server'

import { createClient } from '@/utils/supabase/server'
import { generateProductForecast } from '@/lib/forecasting/engine'
import { calculateAndStoreAlerts } from '@/app/alerts/actions'
import { fetchPurchaseMetrics } from '@/app/purchases/actions'
import {
  getNextFestival,
  getFestivalsInRange,
  daysBetween,
  type FestivalConfig,
} from '@/lib/festivals/calendar'

export interface DailySalesTrend {
  date: string      // YYYY-MM-DD
  label: string     // MMM DD
  quantity: number
  revenue: number
}

export interface BIProductSummary {
  id: string
  name: string
  price: number
  current_stock: number
  supplier_lead_time_days: number
  shelf_life_days: number | null
  salesVolume: number
  salesRevenue: number
  daysOfStock: number
  capitalAtRisk: number
  trend: 'Increasing' | 'Stable' | 'Decreasing'
  confidenceScore: number
  status: 'out_of_stock' | 'critical' | 'low' | 'healthy' | 'overstock'
}

export interface BIActiveAlert {
  id: string
  product_id: string
  product_name: string
  alert_type: 'stockout' | 'overstock' | 'reorder'
  severity: 'low' | 'medium' | 'high' | 'critical'
  message: string
  recommended_quantity: number
  current_stock: number
  price: number
  reason: string
}

export interface ExpiryRiskProduct {
  id: string
  name: string
  current_stock: number
  shelf_life_days: number
  daysOfStock: number
  price: number
  capitalAtRisk: number
}

// ── Phase 10I: Festival Intelligence types ────────────────────────────────────

export interface FestivalProductInsight {
  productId: string
  productName: string
  currentStock: number
  price: number
  // Baseline mean daily demand over the full available history window
  baselineDailyDemand: number
  // Mean daily demand during the festival period (null = insufficient data)
  festivalDailyDemand: number | null
  // Percentage uplift vs baseline (null = insufficient data)
  historicalUpliftPct: number | null
  // Festival-period demand estimate for the prep window
  expectedFestivalNeed: number | null
  // How many sale days existed in the festival comparison window (for transparency)
  festivalSaleDays: number
  // Minimum required sale days to compute a valid uplift
  minSaleDaysRequired: number
  // Preparation status derived from current stock vs expected need
  prepStatus: 'ok' | 'low' | 'risk' | 'unknown'
  // Human-readable deterministic insight string
  insight: string
}

export interface FestivalInsightsData {
  // The next upcoming festival from the configured calendar
  nextFestival: FestivalConfig | null
  // Days until the next festival (negative = in the past, null = no upcoming festival)
  daysUntilNextFestival: number | null
  // Any festivals that fell within the last 90-day sales history window
  // — used for historical uplift calculation
  historicalFestivals: FestivalConfig[]
  // Per-product analysis for the next upcoming festival (or the most recent past one)
  productInsights: FestivalProductInsight[]
  // Count of products with sufficient evidence
  productsWithEvidence: number
  // Count of products needing attention (low or risk status)
  productsNeedingAttention: number
}

export interface DashboardAnalyticsData {
  // Section A: Executive Summary KPI Cards
  kpis: {
    totalProducts: number
    inventoryUnits: number
    inventoryValue: number
    salesVolume: number
    salesRevenue: number
    forecastUnits7Days: number
    reorderValue: number
  }
  // Section B: Inventory Health Visual Distribution
  healthDistribution: {
    outOfStock: number
    critical: number
    low: number
    healthy: number
    overstock: number
  }
  // Section C: Sales Analytics
  salesAnalytics: {
    trend: DailySalesTrend[]
    peakSalesDay: { date: string; quantity: number; revenue: number } | null
    avgDailyVelocity: number
  }
  // Section D: Top & Slow Products
  topProducts: BIProductSummary[]
  slowProducts: BIProductSummary[]
  // Section E: Demand Forecast Insights
  forecastInsights: {
    trendCounts: { Increasing: number; Stable: number; Decreasing: number }
    growthProducts: BIProductSummary[]
  }
  // Section F: Needs Attention
  needsAttention: BIActiveAlert[]
  // Section G: Purchase Analytics & Expiry Risk
  purchasing: {
    draftCount: number
    pendingCount: number
    pendingValue: number
  }
  expiryRisks: ExpiryRiskProduct[]
  // Section H: StockMind AI Natural Language Insights
  aiInsights: string[]
  // Section I: All products — full dataset for What-If Simulation (Phase 10H)
  // biProducts is already computed internally; this exposes it without new queries.
  allProducts: BIProductSummary[]
  // Section J: Festival & Seasonal Intelligence (Phase 10I)
  festivalInsights: FestivalInsightsData
}

export async function fetchDashboardAnalytics(dateRangeDays: number): Promise<{ data?: DashboardAnalyticsData; error?: string }> {
  try {
    const supabase = await createClient()

    // 1. Get authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return { error: 'Unauthorized. Please log in.' }
    }

    // 2. Pre-calculate alerts to keep database fresh
    await calculateAndStoreAlerts()

    // 3. Fetch products
    const { data: productsRaw, error: productsErr } = await supabase
      .from('products')
      .select('id, name, price, current_stock, supplier_lead_time_days, shelf_life_days')
      .eq('user_id', user.id)

    if (productsErr) {
      console.error('Error fetching products:', productsErr)
      return { error: 'Failed to fetch products.' }
    }

    const products = productsRaw || []

    // 4. Calculate date cutoff
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - dateRangeDays)
    const cutoffDateIso = cutoffDate.toISOString()

    // 5. Fetch sales in selected range
    const { data: salesRaw, error: salesErr } = await supabase
      .from('sales')
      .select('product_id, sale_date, quantity, unit_price')
      .eq('user_id', user.id)
      .gte('sale_date', cutoffDateIso)

    if (salesErr) {
      console.error('Error fetching sales:', salesErr)
      return { error: 'Failed to fetch sales history.' }
    }

    const sales = salesRaw || []

    // 6. Fetch ALL sales for forecasting trend calculations (last 90 days to ensure accuracy)
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
    const { data: forecastSalesRaw } = await supabase
      .from('sales')
      .select('product_id, sale_date, quantity')
      .eq('user_id', user.id)
      .gte('sale_date', ninetyDaysAgo.toISOString())

    const forecastSales = forecastSalesRaw || []

    // 7. Fetch active alerts
    const { data: alertsRaw, error: alertsErr } = await supabase
      .from('alerts')
      .select('id, product_id, alert_type, severity, message, recommended_quantity')
      .eq('user_id', user.id)
      .eq('resolved', false)

    if (alertsErr) {
      console.error('Error fetching alerts:', alertsErr)
      return { error: 'Failed to fetch active alerts.' }
    }

    const activeAlerts = alertsRaw || []

    // 8. Fetch forecasts (Next 7 days)
    const todayStr = new Date().toISOString().split('T')[0]
    const next7Days = new Date()
    next7Days.setDate(next7Days.getDate() + 7)
    const next7DaysStr = next7Days.toISOString().split('T')[0]

    const { data: forecastsRaw } = await supabase
      .from('forecasts')
      .select('product_id, forecast_date, predicted_demand')
      .eq('user_id', user.id)
      .eq('model_version', 'hybrid-wma-trend-seasonality-v1')
      .gte('forecast_date', todayStr)
      .lte('forecast_date', next7DaysStr)

    const forecasts = forecastsRaw || []

    // 9. Fetch Purchase Metrics
    const purchaseMetricsResult = await fetchPurchaseMetrics()
    const purchasing = purchaseMetricsResult.data || { draftCount: 0, pendingCount: 0, pendingValue: 0 }

    // Map sales by product for forecast engine
    const salesMap = new Map<string, Array<{ sale_date: string; quantity: number }>>()
    products.forEach((p) => salesMap.set(p.id, []))
    forecastSales.forEach((s) => {
      const list = salesMap.get(s.product_id)
      if (list) list.push({ sale_date: s.sale_date, quantity: s.quantity })
    })

    // Map active alerts by product for fast lookup
    const alertsMap = new Map<string, typeof activeAlerts[0]>()
    activeAlerts.forEach((a) => {
      alertsMap.set(a.product_id, a)
    })

    // Generate product summaries and forecasts
    const biProducts: BIProductSummary[] = []
    const trendCounts = { Increasing: 0, Stable: 0, Decreasing: 0 }

    products.forEach((p) => {
      const productSales = salesMap.get(p.id) || []
      const summary = generateProductForecast(p.id, productSales, 90)

      // Calculate sales volume & revenue in selected date window
      const inWindowSales = sales.filter((s) => s.product_id === p.id)
      const salesVolume = inWindowSales.reduce((sum, s) => sum + s.quantity, 0)
      const salesRevenue = inWindowSales.reduce((sum, s) => sum + s.quantity * Number(s.unit_price), 0)

      // Average daily velocity
      const avgDailyDemand = salesVolume / dateRangeDays
      const daysOfStock = p.current_stock > 0
        ? (avgDailyDemand > 0 ? p.current_stock / avgDailyDemand : 999)
        : 0

      // Trend counts from forecast engine
      let trend: 'Increasing' | 'Stable' | 'Decreasing' = 'Stable'
      let confidenceScore = 0
      if (!summary.insufficientData) {
        trend = summary.trend as 'Increasing' | 'Stable' | 'Decreasing'
        confidenceScore = summary.confidenceScore
        trendCounts[trend]++
      } else {
        trendCounts['Stable']++
      }

      // Resolve status based on active alerts
      let status: 'out_of_stock' | 'critical' | 'low' | 'healthy' | 'overstock' = 'healthy'
      const activeAlert = alertsMap.get(p.id)
      if (activeAlert) {
        if (activeAlert.alert_type === 'stockout') {
          status = 'out_of_stock'
        } else if (activeAlert.alert_type === 'overstock') {
          status = 'overstock'
        } else if (activeAlert.alert_type === 'reorder') {
          status = activeAlert.severity === 'critical' ? 'critical' : 'low'
        }
      } else if (p.current_stock === 0) {
        status = 'out_of_stock'
      }

      biProducts.push({
        id: p.id,
        name: p.name,
        price: Number(p.price),
        current_stock: p.current_stock,
        supplier_lead_time_days: p.supplier_lead_time_days,
        shelf_life_days: p.shelf_life_days,
        salesVolume,
        salesRevenue,
        daysOfStock,
        capitalAtRisk: p.current_stock * Number(p.price),
        trend,
        confidenceScore,
        status
      })
    })

    // KPI Card computations
    const totalProducts = products.length
    const inventoryUnits = products.reduce((sum, p) => sum + p.current_stock, 0)
    const inventoryValue = products.reduce((sum, p) => sum + p.current_stock * Number(p.price), 0)
    const salesVolume = sales.reduce((sum, s) => sum + s.quantity, 0)
    const salesRevenue = sales.reduce((sum, s) => sum + s.quantity * Number(s.unit_price), 0)
    const forecastUnits7Days = forecasts.reduce((sum, f) => sum + Number(f.predicted_demand), 0)

    // Calculate Reorder Value from active alerts
    let reorderValue = 0
    activeAlerts.forEach((alert) => {
      if (alert.alert_type === 'reorder' || alert.alert_type === 'stockout') {
        const prod = products.find((p) => p.id === alert.product_id)
        if (prod) {
          reorderValue += alert.recommended_quantity * Number(prod.price)
        }
      }
    })

    // Health Distribution counts
    const healthDistribution = {
      outOfStock: biProducts.filter((p) => p.status === 'out_of_stock').length,
      critical: biProducts.filter((p) => p.status === 'critical').length,
      low: biProducts.filter((p) => p.status === 'low').length,
      healthy: biProducts.filter((p) => p.status === 'healthy').length,
      overstock: biProducts.filter((p) => p.status === 'overstock').length,
    }

    // Timeline sales trend for Section C chart
    const trendMap = new Map<string, { quantity: number; revenue: number }>()
    for (let i = 0; i < dateRangeDays; i++) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateKey = d.toISOString().split('T')[0]
      trendMap.set(dateKey, { quantity: 0, revenue: 0 })
    }

    sales.forEach((s) => {
      const dateKey = new Date(s.sale_date).toISOString().split('T')[0]
      const current = trendMap.get(dateKey)
      if (current) {
        current.quantity += s.quantity
        current.revenue += s.quantity * Number(s.unit_price)
      }
    })

    const trendArray: DailySalesTrend[] = Array.from(trendMap.entries())
      .map(([date, data]) => {
        const parsedDate = new Date(date)
        const label = parsedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
        return {
          date,
          label,
          quantity: data.quantity,
          revenue: data.revenue
        }
      })
      // Sort chronologically (oldest to newest)
      .sort((a, b) => a.date.localeCompare(b.date))

    // Find peak sales day
    let peakSalesDay: { date: string; quantity: number; revenue: number } | null = null
    trendArray.forEach((t) => {
      if (!peakSalesDay || t.quantity > peakSalesDay.quantity) {
        peakSalesDay = { date: t.date, quantity: t.quantity, revenue: t.revenue }
      }
    })

    const avgDailyVelocity = dateRangeDays > 0 ? salesVolume / dateRangeDays : 0

    // Top 5 Products by Sales Volume
    const topProducts = [...biProducts]
      .filter((p) => p.salesVolume > 0)
      .sort((a, b) => b.salesVolume - a.salesVolume)
      .slice(0, 5)

    // Slow-moving Products by sales velocity (sorted ascending)
    const slowProducts = [...biProducts]
      .sort((a, b) => a.salesVolume - b.salesVolume)
      .slice(0, 5)

    // Forecast Insights growth products: Increasing trend, sorted by confidence score desc
    const growthProducts = biProducts
      .filter((p) => p.trend === 'Increasing')
      .sort((a, b) => b.confidenceScore - a.confidenceScore)
      .slice(0, 5)

    // Section F: Needs Attention active alerts mapped nicely
    const needsAttention: BIActiveAlert[] = activeAlerts
      .map((a) => {
        const prod = products.find((p) => p.id === a.product_id)
        let alertReason = ''
        try {
          const parsed = JSON.parse(a.message)
          alertReason = parsed.reason || a.message
        } catch {
          alertReason = a.message
        }

        return {
          id: a.id,
          product_id: a.product_id,
          product_name: prod?.name || 'Unknown Product',
          alert_type: a.alert_type as 'stockout' | 'overstock' | 'reorder',
          severity: a.severity as 'low' | 'medium' | 'high' | 'critical',
          message: a.message,
          recommended_quantity: a.recommended_quantity,
          current_stock: prod?.current_stock || 0,
          price: prod ? Number(prod.price) : 0,
          reason: alertReason
        }
      })
      .sort((a, b) => {
        // Sort order: critical -> high -> medium -> low
        const severityWeight = { critical: 4, high: 3, medium: 2, low: 1 }
        const weightA = severityWeight[a.severity] || 0
        const weightB = severityWeight[b.severity] || 0
        return weightB - weightA
      })

    // Expiry / Overstock Risk: products with shelf life where daysOfStock > shelf_life_days
    const expiryRisks: ExpiryRiskProduct[] = biProducts
      .filter((p) => p.shelf_life_days !== null && p.shelf_life_days > 0 && p.daysOfStock > p.shelf_life_days)
      .map((p) => ({
        id: p.id,
        name: p.name,
        current_stock: p.current_stock,
        shelf_life_days: p.shelf_life_days as number,
        daysOfStock: p.daysOfStock,
        price: p.price,
        capitalAtRisk: p.current_stock * p.price
      }))
      .sort((a, b) => b.capitalAtRisk - a.capitalAtRisk)

    // Section H: StockMind AI Natural Language Insights (deterministic)
    const aiInsights: string[] = []

    // 1. Stockout/Critical alert insight
    const criticalCount = healthDistribution.outOfStock + healthDistribution.critical
    if (criticalCount > 0) {
      const exampleProduct = biProducts.find((p) => p.status === 'out_of_stock' || p.status === 'critical')
      aiInsights.push(
        `Critical Alert: ${criticalCount} product(s) require immediate purchasing action. e.g., "${exampleProduct?.name}" is ${exampleProduct?.status === 'out_of_stock' ? 'completely out of stock' : `facing a stockout risk in less than ${exampleProduct?.supplier_lead_time_days} days`}.`
      )
    } else {
      aiInsights.push('All stock levels are healthy or low risk. No immediate stockouts predicted.')
    }

    // 2. Overstock / Capital tied up insight
    const overstockProducts = biProducts.filter((p) => p.status === 'overstock')
    if (overstockProducts.length > 0) {
      const totalOverstockVal = overstockProducts.reduce((sum, p) => sum + p.capitalAtRisk, 0)
      const worstOverstock = [...overstockProducts].sort((a, b) => b.capitalAtRisk - a.capitalAtRisk)[0]
      aiInsights.push(
        `Capital Efficiency: ₹${totalOverstockVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })} is tied up in overstock items. Defer reordering "${worstOverstock.name}" which holds ~${worstOverstock.daysOfStock.toFixed(0)} days of supply.`
      )
    }

    // 3. Expiry risk insight
    if (expiryRisks.length > 0) {
      const totalWastageRisk = expiryRisks.reduce((sum, p) => sum + p.capitalAtRisk, 0)
      aiInsights.push(
        `Expiry Risk: ${expiryRisks.length} product(s) have supply timelines exceeding shelf life, representing a potential wastage of ₹${totalWastageRisk.toLocaleString('en-IN', { maximumFractionDigits: 0 })}. Prioritize sales velocity promotions for "${expiryRisks[0].name}".`
      )
    }

    // 4. Sales performance insight
    if (topProducts.length > 0) {
      aiInsights.push(
        `Top Performer: "${topProducts[0].name}" is the top contributor in the selected window, selling ${topProducts[0].salesVolume} units and generating ₹${topProducts[0].salesRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}. Demand trajectory is ${topProducts[0].trend}.`
      )
    }

    // 5. Growth trajectory insight
    const growingCount = trendCounts.Increasing
    if (growingCount > 0) {
      const worstLowStockGrowing = biProducts
        .filter((p) => p.trend === 'Increasing' && (p.status === 'low' || p.status === 'critical'))
        .sort((a, b) => a.daysOfStock - b.daysOfStock)[0]

      if (worstLowStockGrowing) {
        aiInsights.push(
          `Demand Shift: ${growingCount} product(s) show upward demand. Danger alert: "${worstLowStockGrowing.name}" is trending up but has only ${worstLowStockGrowing.daysOfStock.toFixed(0)} days of stock left.`
        )
      } else {
        const topGrower = growthProducts[0]
        aiInsights.push(
          `Demand Shift: ${growingCount} product(s) show upward demand trends, led by "${topGrower.name}" with a ${topGrower.confidenceScore.toFixed(0)}% confidence score.`
        )
      }
    }

    // Fill minimum 4 insights if empty
    while (aiInsights.length < 4) {
      aiInsights.push('Verify regular sales data updates to ensure real-time analytics accuracy.')
    }

    // ── Phase 10I: Festival Intelligence computation ─────────────────────────
    // Uses the existing forecastSales / salesMap data — NO new database queries.
    // Minimum 5 distinct sale days required in each comparison window for validity.
    const MIN_FESTIVAL_SALE_DAYS = 5
    const todayUtc = new Date().toISOString().split('T')[0]
    const ninetyDaysAgoUtc = new Date()
    ninetyDaysAgoUtc.setDate(ninetyDaysAgoUtc.getDate() - 90)
    const windowStart = ninetyDaysAgoUtc.toISOString().split('T')[0]

    const nextFestival = getNextFestival(todayUtc)
    const daysUntilNextFestival = nextFestival
      ? daysBetween(todayUtc, nextFestival.date)
      : null

    // Find festivals within the last 90 days — these have historical data available
    const historicalFestivals = getFestivalsInRange(windowStart, todayUtc)

    // Determine which festival to analyze:
    // Priority 1: A festival within the last 30 days (most recent historical evidence)
    // Priority 2: The next upcoming festival (forward-looking, if its date is ≤ 90 days away)
    // Priority 3: null — no suitable festival for analysis
    const recentFestivals = historicalFestivals
      .filter((f) => daysBetween(f.date, todayUtc) <= 30)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    const targetFestival: FestivalConfig | null =
      recentFestivals[0] ??
      (nextFestival && daysUntilNextFestival !== null && daysUntilNextFestival <= 90
        ? nextFestival
        : null)

    const productInsights: FestivalProductInsight[] = []

    if (targetFestival) {
      const festivalDateMs = new Date(targetFestival.date).getTime()
      // Festival comparison window: [festivalDate - 14 days, festivalDate + 7 days]
      const festWindowStart = new Date(festivalDateMs - 14 * 86400000).toISOString().split('T')[0]
      const festWindowEnd = new Date(festivalDateMs + 7 * 86400000).toISOString().split('T')[0]

      products.forEach((p) => {
        const productSales = salesMap.get(p.id) || []
        const biEntry = biProducts.find((b) => b.id === p.id)
        // Use the same 90-day window baseline as the forecasting engine
        const baselineDailyDemand90 = biEntry ? biEntry.salesVolume / 90 : 0

        // Split sales into festival-period and non-festival baseline
        const festivalSales = productSales.filter((s) => {
          const d = s.sale_date.split('T')[0]
          return d >= festWindowStart && d <= festWindowEnd
        })
        const baselineSales = productSales.filter((s) => {
          const d = s.sale_date.split('T')[0]
          return d < festWindowStart || d > festWindowEnd
        })

        // Count distinct sale days in each window
        const festSaleDays = new Set(festivalSales.map((s) => s.sale_date.split('T')[0])).size
        const baseSaleDays = new Set(baselineSales.map((s) => s.sale_date.split('T')[0])).size

        const hasSufficientHistory =
          festSaleDays >= MIN_FESTIVAL_SALE_DAYS &&
          baseSaleDays >= MIN_FESTIVAL_SALE_DAYS

        let festivalDailyDemand: number | null = null
        let historicalUpliftPct: number | null = null
        let expectedFestivalNeed: number | null = null
        let prepStatus: FestivalProductInsight['prepStatus'] = 'unknown'
        let insight = ''

        const baselineMean =
          baseSaleDays > 0
            ? baselineSales.reduce((s, r) => s + r.quantity, 0) / baseSaleDays
            : 0

        if (!hasSufficientHistory) {
          insight = `Festival demand ke liye abhi enough history nahi hai (${festSaleDays} festival sale days, minimum ${MIN_FESTIVAL_SALE_DAYS} required).`
        } else {
          const festMean = festivalSales.reduce((s, r) => s + r.quantity, 0) / festSaleDays
          festivalDailyDemand = Math.round(festMean * 10) / 10
          historicalUpliftPct =
            baselineMean > 0
              ? Math.round(((festMean - baselineMean) / baselineMean) * 100)
              : null

          // Use the 90-day baseline as the forward-looking rate, scaled by uplift
          const effectiveDailyDemand =
            historicalUpliftPct !== null
              ? baselineDailyDemand90 * (1 + historicalUpliftPct / 100)
              : baselineDailyDemand90
          expectedFestivalNeed = Math.ceil(
            effectiveDailyDemand * targetFestival.festivalWindowDays
          )

          const stock = p.current_stock
          if (expectedFestivalNeed <= 0) {
            prepStatus = 'ok'
          } else if (stock >= expectedFestivalNeed) {
            prepStatus = 'ok'
          } else if (stock >= expectedFestivalNeed * 0.6) {
            prepStatus = 'low'
          } else {
            prepStatus = 'risk'
          }

          const upliftStr =
            historicalUpliftPct !== null
              ? historicalUpliftPct >= 0
                ? `+${historicalUpliftPct}%`
                : `${historicalUpliftPct}%`
              : 'stable'
          const statusStr =
            prepStatus === 'ok'
              ? 'Stock ठीक है।'
              : prepStatus === 'low'
              ? `Stock बढ़ाना चाहिए — expected need: ${expectedFestivalNeed} units।`
              : `Stock-out Risk — expected need: ${expectedFestivalNeed} units, current: ${stock}।`

          insight = `${targetFestival.name} period mein historical demand ${upliftStr} thi (${festSaleDays} sale days analyzed). ${statusStr}`
        }

        productInsights.push({
          productId: p.id,
          productName: p.name,
          currentStock: p.current_stock,
          price: Number(p.price),
          baselineDailyDemand: Math.round(baselineMean * 10) / 10,
          festivalDailyDemand,
          historicalUpliftPct,
          expectedFestivalNeed,
          festivalSaleDays: festSaleDays,
          minSaleDaysRequired: MIN_FESTIVAL_SALE_DAYS,
          prepStatus,
          insight,
        })
      })

      // Sort: risk first, then low, then ok, then unknown.
      // Within each group, sort by expected festival need descending.
      productInsights.sort((a, b) => {
        const order: Record<string, number> = { risk: 0, low: 1, ok: 2, unknown: 3 }
        const diff = order[a.prepStatus] - order[b.prepStatus]
        if (diff !== 0) return diff
        return (b.expectedFestivalNeed ?? 0) - (a.expectedFestivalNeed ?? 0)
      })
    }

    const festivalInsights: FestivalInsightsData = {
      nextFestival,
      daysUntilNextFestival,
      historicalFestivals,
      productInsights: productInsights.slice(0, 8),
      productsWithEvidence: productInsights.filter((p) => p.historicalUpliftPct !== null).length,
      productsNeedingAttention: productInsights.filter(
        (p) => p.prepStatus === 'low' || p.prepStatus === 'risk'
      ).length,
    }

    return {
      data: {
        kpis: {
          totalProducts,
          inventoryUnits,
          inventoryValue,
          salesVolume,
          salesRevenue,
          forecastUnits7Days,
          reorderValue
        },
        healthDistribution,
        salesAnalytics: {
          trend: trendArray,
          peakSalesDay,
          avgDailyVelocity
        },
        topProducts,
        slowProducts,
        forecastInsights: {
          trendCounts,
          growthProducts
        },
        needsAttention,
        purchasing,
        expiryRisks,
        aiInsights,
        allProducts: biProducts,
        festivalInsights
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Internal server error occurred.'
    console.error('Server error in fetchDashboardAnalytics:', err)
    return { error: errorMsg }
  }
}
