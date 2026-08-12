import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { generateProductForecast } from '@/lib/forecasting/engine'
import DashboardLayout from '@/components/DashboardLayout'

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Fetch user's products
  const { data: products } = await supabase
    .from('products')
    .select('id, name, price')

  const totalProducts = products?.length || 0

  // Fetch sales to calculate active forecasts and trend metrics
  const { data: sales } = await supabase
    .from('sales')
    .select('product_id, sale_date, quantity')
    .eq('user_id', user.id)

  let forecastedProductsCount = 0
  let totalPredictedUnits = 0
  let increasingProductsCount = 0

  if (products && products.length > 0) {
    // Group sales in memory
    const salesMap = new Map<string, Array<{ sale_date: string; quantity: number }>>()
    products.forEach((p) => salesMap.set(p.id, []))
    
    sales?.forEach((s) => {
      const list = salesMap.get(s.product_id)
      if (list) list.push({ sale_date: s.sale_date, quantity: s.quantity })
    })

    products.forEach((product) => {
      const pSales = salesMap.get(product.id) || []
      const summary = generateProductForecast(product.id, pSales, 90)
      if (!summary.insufficientData) {
        forecastedProductsCount++
        totalPredictedUnits += summary.forecastList.reduce((sum, f) => sum + f.predictedDemand, 0)
        if (summary.trend === 'Increasing') {
          increasingProductsCount++
        }
      }
    })
  }

  return (
    <DashboardLayout userEmail={user.email}>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Dashboard Overview</h2>
          <p className="text-gray-500 text-sm mt-1 font-normal">Welcome back! Here is a summary of your inventory status.</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between">
            <div>
              <span className="text-gray-500 text-sm font-medium">Total Products</span>
              <span className="block text-3xl font-bold text-gray-900 mt-2">{totalProducts}</span>
            </div>
            <div className="mt-4">
              <a href="/inventory" className="text-xs text-blue-600 font-medium hover:underline">
                View inventory →
              </a>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between">
            <div>
              <span className="text-gray-500 text-sm font-medium">Forecasted Products</span>
              <span className="block text-3xl font-bold text-purple-600 mt-2">{forecastedProductsCount}</span>
            </div>
            <div className="mt-4">
              <a href="/forecasts" className="text-xs text-purple-600 font-medium hover:underline">
                View forecasts →
              </a>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between">
            <div>
              <span className="text-gray-500 text-sm font-medium">Predicted Units (Next 7d)</span>
              <span className="block text-3xl font-bold text-gray-950 mt-2">{totalPredictedUnits}</span>
            </div>
            <span className="text-xs text-gray-400 font-medium mt-4 block">
              Units across all forecasts
            </span>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between">
            <div>
              <span className="text-gray-500 text-sm font-medium">Increasing Demand Trends</span>
              <span className="block text-3xl font-bold text-emerald-600 mt-2">{increasingProductsCount}</span>
            </div>
            <span className="text-xs text-gray-400 font-medium mt-4 block">
              Trending upward
            </span>
          </div>
        </div>

        {/* Welcome Section */}
        <div className="bg-white border border-gray-200 rounded-xl p-8 shadow-sm">
          <h3 className="text-lg font-medium text-gray-950">Get Started with StockMind AI</h3>
          <p className="text-gray-500 text-sm mt-2 max-w-2xl font-normal leading-relaxed">
            Navigate to the Inventory section to add and track products, manage supplier lead times, and monitor stock health levels.
          </p>
        </div>
      </div>
    </DashboardLayout>
  )
}
