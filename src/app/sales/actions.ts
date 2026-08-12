'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'

export interface Sale {
  id: string
  user_id: string
  product_id: string
  sale_date: string
  quantity: number
  unit_price: number
  source: 'csv' | 'demo' | 'retail'
  created_at: string
  product_name?: string
}

export async function fetchSalesData() {
  const supabase = await createClient()

  // Get current user to verify session
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return { error: 'Unauthorized. Please log in.' }
  }

  // Fetch sales joined with product names
  // RLS will automatically restrict to the user's sales
  const { data, error } = await supabase
    .from('sales')
    .select(`
      id,
      user_id,
      product_id,
      sale_date,
      quantity,
      unit_price,
      source,
      created_at,
      products (
        name
      )
    `)
    .order('sale_date', { ascending: false })

  if (error) {
    console.error('Error fetching sales:', error)
    return { error: error.message }
  }

  interface DBResponse {
    id: string
    user_id: string
    product_id: string
    sale_date: string
    quantity: number
    unit_price: number
    source: 'csv' | 'demo' | 'retail'
    created_at: string
    products: { name: string } | null
  }

  // Map database response to our Sale interface
  const sales: Sale[] = (data as unknown as DBResponse[] || []).map((s) => ({
    id: s.id,
    user_id: s.user_id,
    product_id: s.product_id,
    sale_date: s.sale_date,
    quantity: s.quantity,
    unit_price: Number(s.unit_price),
    source: s.source,
    created_at: s.created_at,
    product_name: s.products?.name || 'Unknown Product'
  }))

  // Calculate statistics
  const totalRecords = sales.length
  const totalUnits = sales.reduce((sum, s) => sum + s.quantity, 0)
  const totalRevenue = sales.reduce((sum, s) => sum + (s.quantity * s.unit_price), 0)

  return {
    data: sales,
    stats: {
      totalRecords,
      totalUnits,
      totalRevenue
    }
  }
}

export async function importSales(salesList: Array<{
  product_id: string
  sale_date: string
  quantity: number
  unit_price: number
}>) {
  if (salesList.length === 0) {
    return { error: 'No records to import.' }
  }

  const supabase = await createClient()

  // Get current user
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return { error: 'Unauthorized. Please log in.' }
  }

  // Determine min and max dates for de-duplication check
  const dateTimes = salesList.map((s) => new Date(s.sale_date).getTime())
  const minDate = new Date(Math.min(...dateTimes)).toISOString()
  const maxDate = new Date(Math.max(...dateTimes)).toISOString()

  // Fetch existing CSV sales in that date range to prevent duplicates
  const { data: existingSales, error: fetchError } = await supabase
    .from('sales')
    .select('product_id, sale_date, quantity, unit_price')
    .eq('user_id', user.id)
    .eq('source', 'csv')
    .gte('sale_date', minDate)
    .lte('sale_date', maxDate)

  if (fetchError) {
    console.error('Error fetching existing sales for deduplication:', fetchError)
    return { error: 'Failed to verify duplicate records.' }
  }

  // Create set lookup of existing keys
  // Normalize timestamp comparisons to ISO strings
  const existingSet = new Set(
    (existingSales || []).map((s) => {
      const dateStr = new Date(s.sale_date).toISOString()
      const priceNum = Number(s.unit_price).toFixed(2)
      return `${s.product_id}_${dateStr}_${s.quantity}_${priceNum}`
    })
  )

  // Filter out any incoming records that already exist
  const newSales = salesList
    .map((s) => ({
      user_id: user.id,
      product_id: s.product_id,
      sale_date: new Date(s.sale_date).toISOString(),
      quantity: s.quantity,
      unit_price: s.unit_price,
      source: 'csv' as const
    }))
    .filter((s) => {
      const key = `${s.product_id}_${s.sale_date}_${s.quantity}_${s.unit_price.toFixed(2)}`
      return !existingSet.has(key)
    })

  const skippedCount = salesList.length - newSales.length

  if (newSales.length === 0) {
    return {
      success: true,
      importedCount: 0,
      skippedCount,
      message: 'All records were skipped as duplicates.'
    }
  }

  // Batch insert new records (Supabase supports inserting arrays)
  const { error: insertError } = await supabase
    .from('sales')
    .insert(newSales)

  if (insertError) {
    console.error('Error importing sales:', insertError)
    return { error: insertError.message }
  }

  revalidatePath('/sales')
  return {
    success: true,
    importedCount: newSales.length,
    skippedCount
  }
}

// Simple LCG pseudo-random generator for deterministic values based on a seed
class SeededRandom {
  private seed: number
  constructor(seed: number) {
    this.seed = seed
  }
  next() {
    this.seed = (this.seed * 9301 + 49297) % 233280
    return this.seed / 233280
  }
  range(min: number, max: number) {
    return min + this.next() * (max - min)
  }
}

function getHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash)
}

export async function generateDemoSales(products: Array<{ id: string; name: string; price: number }>) {
  if (products.length === 0) {
    return { error: 'Please create products first before generating demo sales data.' }
  }

  const supabase = await createClient()

  // Get current user
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return { error: 'Unauthorized. Please log in.' }
  }

  const salesToInsert: Array<{
    user_id: string
    product_id: string
    sale_date: string
    quantity: number
    unit_price: number
    source: 'demo'
  }> = []
  const today = new Date()
  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(today.getDate() - 90)

  // Generate 90 days of sales history deterministically for each product
  products.forEach((product) => {
    const seed = getHash(product.id)
    const random = new SeededRandom(seed)
    const patternType = seed % 5 // 5 distinct patterns

    for (let day = 0; day <= 90; day++) {
      const currentDate = new Date(ninetyDaysAgo)
      currentDate.setDate(ninetyDaysAgo.getDate() + day)
      const dayOfWeek = currentDate.getDay() // 0 = Sunday, 6 = Saturday

      let baseDemand = 15 // average base demand units/day

      // Apply pattern logic
      switch (patternType) {
        case 0:
          // Stable demand
          baseDemand = random.range(10, 20)
          break
        case 1:
          // Increasing trend
          baseDemand = 8 + (day * 0.15) + random.range(-3, 3)
          break
        case 2:
          // Decreasing trend
          baseDemand = Math.max(2, 25 - (day * 0.2) + random.range(-4, 4))
          break
        case 3:
          // Weekly seasonality (spikes on Fridays and Saturdays: index 5 and 6)
          const weekendMultiplier = (dayOfWeek === 5 || dayOfWeek === 6) ? 2.0 : 0.8
          baseDemand = (12 + random.range(-3, 3)) * weekendMultiplier
          break
        case 4:
          // Occasional spikes (e.g. wholesale purchase every 15 days)
          const isSpikeDay = (day % 15 === 0)
          baseDemand = isSpikeDay ? 50 + random.range(0, 10) : 5 + random.range(-2, 2)
          break
      }

      // Quantity must be a positive integer
      const quantity = Math.max(1, Math.round(baseDemand))

      salesToInsert.push({
        user_id: user.id,
        product_id: product.id,
        sale_date: currentDate.toISOString(),
        quantity,
        unit_price: product.price,
        source: 'demo'
      })
    }
  })

  // We should also delete existing 'demo' data first to prevent duplicate demo data generation cluttering the db
  const { error: deleteError } = await supabase
    .from('sales')
    .delete()
    .eq('user_id', user.id)
    .eq('source', 'demo')

  if (deleteError) {
    console.error('Error clearing old demo data:', deleteError)
    return { error: deleteError.message }
  }

  // Insert the fresh generated batch
  // For safety with large datasets, chunk in batches of 500
  const chunkSize = 500
  for (let i = 0; i < salesToInsert.length; i += chunkSize) {
    const chunk = salesToInsert.slice(i, i + chunkSize)
    const { error: insertError } = await supabase
      .from('sales')
      .insert(chunk)

    if (insertError) {
      console.error('Error inserting demo sales chunk:', insertError)
      return { error: insertError.message }
    }
  }

  revalidatePath('/sales')
  return {
    success: true,
    message: `Generated ${salesToInsert.length} demo sales records for ${products.length} products.`
  }
}
