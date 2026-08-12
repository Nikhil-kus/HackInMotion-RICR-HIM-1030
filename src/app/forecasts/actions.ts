'use server'

import { createClient } from '@/utils/supabase/server'
import { generateProductForecast, EngineSummary } from '@/lib/forecasting/engine'
import { revalidatePath } from 'next/cache'

export interface ForecastRecord {
  id: string
  user_id: string
  product_id: string
  forecast_date: string
  predicted_demand: number
  confidence_score: number
  model_version: string
  created_at: string
  product_name?: string
}

export interface ProductSimple {
  id: string
  name: string
  price: number
}

export interface ProductForecastDetails extends EngineSummary {
  productName: string
}

export async function fetchForecastsData() {
  const supabase = await createClient()

  // Get current user to verify session
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return { error: 'Unauthorized. Please log in.' }
  }

  // Fetch forecast records from table (RLS automatically enforces per-user access)
  const { data, error } = await supabase
    .from('forecasts')
    .select(`
      id,
      user_id,
      product_id,
      forecast_date,
      predicted_demand,
      confidence_score,
      model_version,
      created_at,
      products (
        name
      )
    `)
    .order('forecast_date', { ascending: true })

  if (error) {
    console.error('Error fetching forecasts:', error)
    return { error: error.message }
  }

  interface DBResponse {
    id: string
    user_id: string
    product_id: string
    forecast_date: string
    predicted_demand: number
    confidence_score: number
    model_version: string
    created_at: string
    products: { name: string } | null
  }

  const forecasts: ForecastRecord[] = (data as unknown as DBResponse[] || []).map((f) => ({
    id: f.id,
    user_id: f.user_id,
    product_id: f.product_id,
    forecast_date: f.forecast_date,
    predicted_demand: f.predicted_demand,
    confidence_score: f.confidence_score,
    model_version: f.model_version,
    created_at: f.created_at,
    product_name: f.products?.name || 'Unknown Product'
  }))

  return { data: forecasts }
}

export async function calculateAllForecasts(products: ProductSimple[]) {
  if (products.length === 0) {
    return { error: 'No products found. Please create products in Inventory first.' }
  }

  const supabase = await createClient()

  // Get current user
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return { error: 'Unauthorized. Please log in.' }
  }

  const modelVersion = 'hybrid-wma-trend-seasonality-v1'
  const allForecastRecordsToInsert: Array<{
    user_id: string
    product_id: string
    forecast_date: string
    predicted_demand: number
    confidence_score: number
    model_version: string
  }> = []
  const summaries: ProductForecastDetails[] = []

  // Fetch ALL sales of the user in one batch to perform high performance in-memory grouping
  const { data: allSales, error: salesError } = await supabase
    .from('sales')
    .select('product_id, sale_date, quantity')
    .eq('user_id', user.id)

  if (salesError) {
    console.error('Error fetching batch sales for forecasting:', salesError)
    return { error: 'Failed to fetch sales history.' }
  }

  // Group sales by product_id in-memory
  const salesMap = new Map<string, Array<{ sale_date: string; quantity: number }>>()
  products.forEach((p) => salesMap.set(p.id, []))
  
  allSales?.forEach((s) => {
    const list = salesMap.get(s.product_id)
    if (list) {
      list.push({ sale_date: s.sale_date, quantity: s.quantity })
    }
  })

  // Generate forecasts for each product in-memory
  products.forEach((product) => {
    const productSales = salesMap.get(product.id) || []
    const summary = generateProductForecast(product.id, productSales, 90)

    summaries.push({
      ...summary,
      productName: product.name
    })

    if (!summary.insufficientData) {
      summary.forecastList.forEach((forecast) => {
        allForecastRecordsToInsert.push({
          user_id: user.id,
          product_id: product.id,
          forecast_date: forecast.forecastDate,
          predicted_demand: forecast.predictedDemand,
          confidence_score: forecast.confidenceScore,
          model_version: modelVersion
        })
      })
    }
  })

  // Clean / Safely replace previous forecast records for these products
  const productIds = products.map((p) => p.id)
  const { error: deleteError } = await supabase
    .from('forecasts')
    .delete()
    .eq('user_id', user.id)
    .in('product_id', productIds)
    .eq('model_version', modelVersion)

  if (deleteError) {
    console.error('Error removing old forecasts:', deleteError)
    return { error: 'Failed to clean old forecast data.' }
  }

  // Batch insert new forecasts
  if (allForecastRecordsToInsert.length > 0) {
    const { error: insertError } = await supabase
      .from('forecasts')
      .insert(allForecastRecordsToInsert)

    if (insertError) {
      console.error('Error batch inserting forecasts:', insertError)
      return { error: insertError.message }
    }
  }

  revalidatePath('/forecasts')
  revalidatePath('/dashboard')

  return {
    success: true,
    summaries
  }
}
