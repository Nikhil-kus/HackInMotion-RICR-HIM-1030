export interface DailyDemand {
  date: string
  quantity: number
}

export interface ForecastResult {
  productId: string
  forecastDate: string
  predictedDemand: number
  confidenceScore: number
  modelVersion: string
}

export interface EngineSummary {
  productId: string
  insufficientData: boolean
  daysOfHistory: number
  trend: 'Increasing' | 'Stable' | 'Decreasing'
  confidenceScore: number
  explanation: string
  forecastList: ForecastResult[]
  historicalDemand: DailyDemand[]
}

// Simple statistical helper functions
function getMean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((sum, val) => sum + val, 0) / arr.length
}

function getStdDev(arr: number[], mean: number): number {
  if (arr.length <= 1) return 0
  const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (arr.length - 1)
  return Math.sqrt(variance)
}

/**
 * 1. Aggregates sales list into daily demand bins, padding missing dates with zero sales.
 *
 * The zero-padding architecture is intentional and unchanged:
 * - Returns exactly (daysBack + 1) entries regardless of actual sale days.
 * - Missing days are represented as quantity = 0.
 * - This is the correct basis for WMA, trend, and seasonality calculations.
 */
export function prepareDailyDemand(
  sales: Array<{ sale_date: string; quantity: number }>,
  daysBack = 90
): DailyDemand[] {
  const demandMap = new Map<string, number>()

  sales.forEach((s) => {
    // Extract date portion YYYY-MM-DD
    const dateKey = new Date(s.sale_date).toISOString().split('T')[0]
    demandMap.set(dateKey, (demandMap.get(dateKey) || 0) + s.quantity)
  })

  const dailyDemand: DailyDemand[] = []
  const today = new Date()
  const startDate = new Date()
  startDate.setDate(today.getDate() - daysBack)

  for (let i = 0; i <= daysBack; i++) {
    const tempDate = new Date(startDate)
    tempDate.setDate(startDate.getDate() + i)
    const dateKey = tempDate.toISOString().split('T')[0]

    dailyDemand.push({
      date: dateKey,
      quantity: demandMap.get(dateKey) || 0
    })
  }

  return dailyDemand
}

/**
 * 2. Computes the Weighted Moving Average (WMA) of recent demand.
 * Gives linear incremental weights (1 to windowSize) to recent dates.
 */
export function calculateWeightedMovingAverage(dailyDemand: number[], windowSize = 14): number {
  if (dailyDemand.length === 0) return 0

  const actualWindow = Math.min(windowSize, dailyDemand.length)
  const recentDemand = dailyDemand.slice(-actualWindow)

  let weightedSum = 0
  let weightTotal = 0

  for (let i = 0; i < actualWindow; i++) {
    const weight = i + 1
    weightedSum += recentDemand[i] * weight
    weightTotal += weight
  }

  return weightTotal > 0 ? weightedSum / weightTotal : 0
}

/**
 * 3. Computes linear trends by comparing average sales of the first and second halves.
 * Returns classification and trend slope (change in units per day).
 *
 * FIX I4: When both halves have near-zero activity the old code had a bare
 * `else if (avg2 > 1)` branch that could mark a new product as Increasing
 * based on a single 2-unit data point.  The guard now requires the second
 * half to show genuine, non-trivial activity before declaring a trend:
 *
 *   - avg1 = 0 AND avg2 ≤ 1.0            → Stable   (near-zero evidence)
 *   - avg1 = 0 AND avg2 > 1.0            → Increasing  (meaningful new activity)
 *     BUT only when avg2 represents at least a modest signal (> 1 unit/day mean
 *     across the 14-day second half, i.e. > 14 units of total activity).
 *
 * All three canonical scenarios remain correct:
 *   5→8→12→18   → Increasing   (percentChange >> 8%)
 *   20→17→12→7  → Decreasing   (percentChange << -8%)
 *   10→10→10→10 → Stable       (percentChange = 0%)
 */
export function calculateTrend(dailyDemand: number[]): {
  trend: 'Increasing' | 'Stable' | 'Decreasing'
  slope: number
} {
  const length = dailyDemand.length
  if (length < 14) {
    return { trend: 'Stable', slope: 0 }
  }

  // Use the last 28 days (or entire history if less)
  const analysisPeriod = Math.min(28, length)
  const recentHistory = dailyDemand.slice(-analysisPeriod)
  const half = Math.floor(analysisPeriod / 2)

  const firstHalf = recentHistory.slice(0, half)
  const secondHalf = recentHistory.slice(half)

  const avg1 = getMean(firstHalf)
  const avg2 = getMean(secondHalf)

  // Slope is average daily increase/decrease between centers of the two halves
  const daysDiff = half
  const slope = daysDiff > 0 ? (avg2 - avg1) / daysDiff : 0

  // Standardize classification threshold based on % change from base mean
  let trend: 'Increasing' | 'Stable' | 'Decreasing' = 'Stable'

  if (avg1 > 0) {
    // Normal case: both halves have meaningful demand — use percentage threshold
    const percentChange = (avg2 - avg1) / avg1
    if (percentChange > 0.08) {
      trend = 'Increasing'
    } else if (percentChange < -0.08) {
      trend = 'Decreasing'
    }
  } else {
    // FIX I4: avg1 = 0 (first half was entirely zero).
    // Require the second half to represent genuine, non-trivial activity:
    // avg2 > 1.0 means more than 1 unit/day across 14 days (> 14 total units).
    // A single 2-unit day produces avg2 ≈ 0.14 → Stable (correctly).
    // A product genuinely picking up (e.g. 3 units/day in second half) → Increasing.
    if (avg2 > 1.0) {
      trend = 'Increasing'
    }
    // Otherwise (avg2 ≤ 1.0): remain Stable — insufficient evidence of a real trend
  }

  return { trend, slope }
}

/**
 * 4. Detects weekly seasonality index multipliers [Sun, Mon, Tue, Wed, Thu, Fri, Sat].
 *
 * FIX I3: The zero-padded array always has 91 entries, so the old `length < 28`
 * gate was effectively never triggered.  Two additional evidence requirements
 * are now enforced before seasonality can be marked `detected`:
 *
 *   a) At least 14 DISTINCT active sale days in the analysis window.
 *      This prevents a product with 5 weekend sales from having 0-multiplier
 *      weekday forecasts due to coincidental data sparsity.
 *
 *   b) Every day-of-week bucket that would produce a non-neutral index must
 *      have at least 2 observations.  Buckets with only 1 observation are
 *      clamped to the neutral index (1.0) before std-dev is evaluated.
 *      This prevents a single anomalous day from dominating a bucket.
 *
 * If either requirement is not met, indices are returned as all 1.0 and
 * detected = false — the forecast behaves as if no seasonality exists.
 *
 * FIX I2: Both measurement (already used getUTCDay) and application of
 * seasonal indices now consistently use UTC day-of-week.  The UTC/local
 * inconsistency has been removed from the forecast loop in
 * generateProductForecast.
 */
export function calculateWeeklySeasonality(
  dailyDemand: number[],
  dates: string[]
): { indices: number[]; detected: boolean } {
  const defaultIndices = Array(7).fill(1.0)
  if (dailyDemand.length < 28 || dates.length !== dailyDemand.length) {
    return { indices: defaultIndices, detected: false }
  }

  // FIX I3a: Count distinct active sale days (quantity > 0) in the window.
  // Seasonality requires at least 14 distinct active days to be meaningful.
  const MIN_ACTIVE_DAYS_FOR_SEASONALITY = 14
  const activeDayCount = dailyDemand.filter((q) => q > 0).length
  if (activeDayCount < MIN_ACTIVE_DAYS_FOR_SEASONALITY) {
    return { indices: defaultIndices, detected: false }
  }

  const dowSums = Array(7).fill(0)
  const dowCounts = Array(7).fill(0)

  for (let i = 0; i < dailyDemand.length; i++) {
    const dateObj = new Date(dates[i])
    const dow = dateObj.getUTCDay() // FIX I2: UTC day-of-week (measurement side — already correct)
    dowSums[dow] += dailyDemand[i]
    dowCounts[dow] += 1
  }

  // FIX I3b: Clamp buckets with fewer than 2 observations to neutral (1.0).
  // A single observation cannot reliably characterise a day-of-week pattern.
  const MIN_OBSERVATIONS_PER_BUCKET = 2
  const dowAverages = dowSums.map((sum, index) => {
    const count = dowCounts[index]
    if (count < MIN_OBSERVATIONS_PER_BUCKET) return null  // mark as insufficient
    return sum / count
  })

  const overallAvg = getMean(dailyDemand)
  if (overallAvg <= 0) {
    return { indices: defaultIndices, detected: false }
  }

  // Build indices: use neutral 1.0 for any bucket with insufficient observations
  const indices = dowAverages.map((avg) =>
    avg !== null ? avg / overallAvg : 1.0
  )

  // Calculate standard deviation of seasonal indices to see if they differ
  // significantly from uniform (1.0).  Only apply seasonality if std dev > 0.08.
  const stdDev = getStdDev(indices, 1.0)
  const detected = stdDev > 0.08

  return {
    indices: detected ? indices : defaultIndices,
    detected
  }
}

/**
 * 5. Bounded transparency-based confidence score based on data points & consistency.
 *
 * FIX C2: The `activeSaleDays` parameter now drives the history-length component
 * instead of the padded calendar-window length (which was always 91 regardless
 * of how many days actually had sales).
 *
 * A product with 5 actual sale days in 90 calendar days must NOT receive the
 * same history-length score as a product with 90 active sale days.
 *
 * Thresholds (using distinct active sale days):
 *   0–13  active days → 0 history points   (insufficient evidence)
 *   14–27 active days → 10 points
 *   28–59 active days → 20 points
 *   60–89 active days → 30 points
 *   90+   active days → 40 points (maximum)
 *
 * All other scoring components (CV, trend clarity, seasonality) are unchanged.
 * Total score remains bounded [10, 100].
 */
export function calculateConfidenceScore(
  activeSaleDays: number,
  dailyDemand: number[],
  trend: 'Increasing' | 'Stable' | 'Decreasing',
  seasonalityDetected: boolean
): number {
  let score = 0

  // A. Points from REAL data density — distinct active sale days (max 40)
  // FIX C2: use activeSaleDays, not the padded calendar-window length
  if (activeSaleDays >= 90) score += 40
  else if (activeSaleDays >= 60) score += 30
  else if (activeSaleDays >= 28) score += 20
  else if (activeSaleDays >= 14) score += 10
  // else: 0 points — fewer than 14 active days, no history credit

  // B. Points from demand consistency (max 30)
  // Low coefficient of variation (CV = StdDev / Mean) -> High consistency
  const mean = getMean(dailyDemand)
  if (mean > 0) {
    const stdDev = getStdDev(dailyDemand, mean)
    const cv = stdDev / mean

    if (cv < 0.25) score += 30
    else if (cv < 0.6) score += 20
    else if (cv < 1.2) score += 10
    else score += 5
  }

  // C. Points from trend clarity (max 15)
  if (trend === 'Increasing' || trend === 'Decreasing') {
    score += 15 // Clear trend is predictable
  } else {
    score += 10 // Stable is also predictable
  }

  // D. Points from weekly seasonality confirmation (max 15)
  if (seasonalityDetected) {
    score += 15 // Seasonality adds structured predictability
  }

  // Bounded between 10 and 100
  return Math.min(100, Math.max(10, score))
}

/**
 * Main function executing the hybrid statistical forecasting algorithm.
 *
 * FIX C1: `daysOfHistory` now counts DISTINCT CALENDAR DAYS represented by
 * the raw sales records, not the raw transaction count (`sales.length`).
 *
 * Examples:
 *   20 transactions on 1 day       → daysOfHistory = 1  → insufficientData
 *   13 transactions on 13 days     → daysOfHistory = 13 → insufficientData
 *   14 transactions on 14 days     → daysOfHistory = 14 → forecast runs
 *
 * The 91-entry zero-padded daily demand array is unaffected — it is still
 * used as the basis for WMA, trend, and seasonality calculations.
 *
 * FIX C2: `calculateConfidenceScore` now receives `activeSaleDays` (the
 * count of padded-array entries that have quantity > 0) instead of
 * `dailyDemand.length` (which was always 91).
 *
 * FIX I2: The 7-day forecast loop now uses `forecastDate.getUTCDay()` to
 * select the seasonal index, matching the UTC measurement in
 * `calculateWeeklySeasonality`.
 */
export function generateProductForecast(
  productId: string,
  sales: Array<{ sale_date: string; quantity: number }>,
  historyDays = 90
): EngineSummary {
  const modelVersion = 'hybrid-wma-trend-seasonality-v1'
  const dailyDemand = prepareDailyDemand(sales, historyDays)

  // FIX C1: count distinct calendar days, not raw transaction records
  const distinctSaleDays = new Set(
    sales.map((s) => new Date(s.sale_date).toISOString().split('T')[0])
  ).size
  const daysOfHistory = distinctSaleDays

  // Requirement: at least 14 distinct calendar days of evidence.
  if (daysOfHistory < 14) {
    return {
      productId,
      insufficientData: true,
      daysOfHistory,
      trend: 'Stable',
      confidenceScore: 0,
      explanation: 'Insufficient historical data to run reliable forecasting. At least 14 days of sales evidence are required.',
      forecastList: [],
      historicalDemand: dailyDemand
    }
  }

  const quantities = dailyDemand.map((d) => d.quantity)
  const dates = dailyDemand.map((d) => d.date)

  // A. Weighted Moving Average (baseline) — unchanged
  const baseDemand = calculateWeightedMovingAverage(quantities, 14)

  // B. Trend computation — I4 guard applied inside calculateTrend()
  const { trend, slope } = calculateTrend(quantities)

  // C. Seasonality computation — I3 guard applied inside calculateWeeklySeasonality()
  const { indices: seasonalIndices, detected: seasonalityDetected } = calculateWeeklySeasonality(quantities, dates)

  // FIX C2: pass active sale days (non-zero entries in the padded array)
  // instead of the padded array length (always 91).
  const activeSaleDays = quantities.filter((q) => q > 0).length

  // D. Confidence calculation
  const confidenceScore = calculateConfidenceScore(
    activeSaleDays,
    quantities,
    trend,
    seasonalityDetected
  )

  // E. 7-Day Forecast Generation
  const forecastList: ForecastResult[] = []
  const today = new Date()

  for (let i = 1; i <= 7; i++) {
    const forecastDate = new Date(today)
    forecastDate.setDate(today.getDate() + i)
    const dateKey = forecastDate.toISOString().split('T')[0]

    // Project base demand + trend slope over the projection period
    const projectedBase = baseDemand + (slope * i)

    // FIX I2: use getUTCDay() to match the UTC measurement in calculateWeeklySeasonality
    const dayOfWeek = forecastDate.getUTCDay()
    const seasonalFactor = seasonalIndices[dayOfWeek]

    const finalProjection = Math.max(0, Math.round(projectedBase * seasonalFactor))

    forecastList.push({
      productId,
      forecastDate: dateKey,
      predictedDemand: finalProjection,
      confidenceScore,
      modelVersion
    })
  }

  // F. Formulate metric-driven explanation text
  let explanation = ''
  if (trend === 'Increasing') {
    explanation += `Demand is trending upward (daily increase of ~${slope.toFixed(1)} units) based on recent sales. `
  } else if (trend === 'Decreasing') {
    explanation += `Demand is trending downward (daily decrease of ~${Math.abs(slope).toFixed(1)} units) based on recent sales. `
  } else {
    explanation += `Demand is stable with consistent daily volume. `
  }

  if (seasonalityDetected) {
    explanation += 'Strong weekly seasonality was detected and factored into the daily forecast projections.'
  } else {
    explanation += 'Demand displays normal distribution without dominant weekly seasonal patterns.'
  }

  return {
    productId,
    insufficientData: false,
    daysOfHistory,
    trend,
    confidenceScore,
    explanation,
    forecastList,
    historicalDemand: dailyDemand
  }
}
