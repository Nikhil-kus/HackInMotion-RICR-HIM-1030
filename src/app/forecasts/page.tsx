import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { ProductForecastDetails } from './actions'
import { generateProductForecast } from '@/lib/forecasting/engine'
import ForecastClient from './forecast-client'
import DashboardLayout from '@/components/DashboardLayout'

export default async function ForecastsPage() {
  const supabase = await createClient()

  // Get current user to verify session
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/auth/login')
  }



  // Fetch user's products list
  const { data: products } = await supabase
    .from('products')
    .select('id, name, price')
    .order('name', { ascending: true })

  // Fetch user's sales history to compute in-memory preview statistics
  const { data: sales } = await supabase
    .from('sales')
    .select('product_id, sale_date, quantity')
    .eq('user_id', user.id)

  // Pre-calculate summaries in-memory for the initial page load state
  const summaries: ProductForecastDetails[] = []
  
  if (products && products.length > 0) {
    // Group sales by product
    const salesMap = new Map<string, Array<{ sale_date: string; quantity: number }>>()
    products.forEach((p) => salesMap.set(p.id, []))
    
    sales?.forEach((s) => {
      const list = salesMap.get(s.product_id)
      if (list) {
        list.push({ sale_date: s.sale_date, quantity: s.quantity })
      }
    })

    products.forEach((product) => {
      const productSales = salesMap.get(product.id) || []
      const engineSummary = generateProductForecast(product.id, productSales, 90)
      
      summaries.push({
        ...engineSummary,
        productName: product.name
      })
    })
  }

  return (
    <DashboardLayout userEmail={user.email}>
      <ForecastClient
        products={products || []}
        initialSummaries={summaries}
      />
    </DashboardLayout>
  )
}
