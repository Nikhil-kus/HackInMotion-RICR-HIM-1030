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
    const percentChange = (avg2 - avg1) / avg1
    if (percentChange > 0.08) {
      trend = 'Increasing'
    } else if (percentChange < -0.08) {
      trend = 'Decreasing'
    }
  } else if (avg2 > 1) {
    trend = 'Increasing'
  }

  return { trend, slope }
}

/**
 * 4. Detects weekly seasonality index multipliers [Sun, Mon, Tue, Wed, Thu, Fri, Sat].
 * Avoids applying seasonality if data is insufficient (< 28 days) or indices are uniform.
 */
export function calculateWeeklySeasonality(
  dailyDemand: number[],
  dates: string[]
): { indices: number[]; detected: boolean } {
  const defaultIndices = Array(7).fill(1.0)
  if (dailyDemand.length < 28 || dates.length !== dailyDemand.length) {
    return { indices: defaultIndices, detected: false }
  }

  const dowSums = Array(7).fill(0)
  const dowCounts = Array(7).fill(0)

  for (let i = 0; i < dailyDemand.length; i++) {
    const dateObj = new Date(dates[i])
    const dow = dateObj.getUTCDay() // Use UTC to prevent local client offset skew
    dowSums[dow] += dailyDemand[i]
    dowCounts[dow] += 1
  }

  const dowAverages = dowSums.map((sum, index) => {
    const count = dowCounts[index]
    return count > 0 ? sum / count : 0
  })

  const overallAvg = getMean(dailyDemand)
  if (overallAvg <= 0) {
    return { indices: defaultIndices, detected: false }
  }

  const indices = dowAverages.map((avg) => avg / overallAvg)
  
  // Calculate standard deviation of seasonal indices to see if they differ significantly from uniform (1.0)
  const stdDev = getStdDev(indices, 1.0)

  // Only apply seasonality if there is a noticeable variance (std dev > 0.08)
  const detected = stdDev > 0.08

  return {
    indices: detected ? indices : defaultIndices,
    detected
  }
}

/**
 * 5. Bounded transparency-based confidence score based on data points & consistency.
 */
export function calculateConfidenceScore(
  daysCount: number,
  dailyDemand: number[],
  trend: 'Increasing' | 'Stable' | 'Decreasing',
  seasonalityDetected: boolean
): number {
  let score = 0

  // A. Points from historical data length (max 40)
  if (daysCount >= 90) score += 40
  else if (daysCount >= 60) score += 30
  else if (daysCount >= 28) score += 20
  else if (daysCount >= 14) score += 10

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
 */
export function generateProductForecast(
  productId: string,
  sales: Array<{ sale_date: string; quantity: number }>,
  historyDays = 90
): EngineSummary {
  const modelVersion = 'hybrid-wma-trend-seasonality-v1'
  const dailyDemand = prepareDailyDemand(sales, historyDays)
  
  const daysOfHistory = sales.length
  
  // Requirement: If fewer than 14 transactions exist, indicate insufficient data.
  if (daysOfHistory < 14) {
    return {
      productId,
      insufficientData: true,
      daysOfHistory,
      trend: 'Stable',
      confidenceScore: 0,
      explanation: 'Insufficient historical transactions to run reliable forecasting. At least 14 days of data are required.',
      forecastList: [],
      historicalDemand: dailyDemand
    }
  }

  const quantities = dailyDemand.map((d) => d.quantity)
  const dates = dailyDemand.map((d) => d.date)

  // A. Weighted Moving Average (baseline)
  const baseDemand = calculateWeightedMovingAverage(quantities, 14)

  // B. Trend computation
  const { trend, slope } = calculateTrend(quantities)

  // C. Seasonality computation
  const { indices: seasonalIndices, detected: seasonalityDetected } = calculateWeeklySeasonality(quantities, dates)

  // D. Confidence calculation
  const confidenceScore = calculateConfidenceScore(
    dailyDemand.length,
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
    
    // Apply weekly seasonal index multiplier
    const dayOfWeek = forecastDate.getDay() // getDay() yields local/universal depending on construct, since it projects tomorrow onwards we use getDay
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
    daysOfHistory: dailyDemand.length,
    trend,
    confidenceScore,
    explanation,
    forecastList,
    historicalDemand: dailyDemand
  }
}
