import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { generateProductForecast } from '@/lib/forecasting/engine'
import { calculateAndStoreAlerts } from '@/app/alerts/actions'
import DashboardLayout from '@/components/DashboardLayout'
import Link from 'next/link'

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Pre-calculate alerts on dashboard load to keep summaries accurate
  await calculateAndStoreAlerts()

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

  // Fetch active alerts for summary cards and "Needs Attention" list
  const { data: activeAlertsRaw } = await supabase
    .from('alerts')
    .select(`
      id,
      alert_type,
      severity,
      message,
      recommended_quantity,
      products (
        name,
        current_stock
      )
    `)
    .eq('user_id', user.id)
    .eq('resolved', false)
    .order('created_at', { ascending: false })

  interface DashboardAlert {
    id: string
    alert_type: 'stockout' | 'overstock' | 'reorder'
    severity: 'low' | 'medium' | 'high' | 'critical'
    message: string
    recommended_quantity: number
    products: {
      name: string
      current_stock: number
    } | null
  }

  const activeAlerts = (activeAlertsRaw as unknown as DashboardAlert[]) || []
  const activeAlertsCount = activeAlerts.length
  const criticalAlertsCount = activeAlerts.filter((a) => a.severity === 'critical').length
  const productsNeedingReorder = activeAlerts.filter((a) => a.alert_type === 'reorder' || a.alert_type === 'stockout').length
  const totalRecommendedReorderUnits = activeAlerts.reduce((sum, a) => sum + a.recommended_quantity, 0)

  // Needs Attention items (critical severity alerts)
  const needsAttentionList = activeAlerts.filter((a) => a.severity === 'critical')

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

        {/* Alerts & Reorder Summary Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <span className="text-gray-500 text-sm font-medium">Active Alerts</span>
            <span className="block text-3xl font-bold text-gray-955 mt-2">{activeAlertsCount}</span>
          </div>
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <span className="text-gray-500 text-sm font-medium">Critical Alerts</span>
            <span className="block text-3xl font-bold text-red-600 mt-2">{criticalAlertsCount}</span>
          </div>
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <span className="text-gray-500 text-sm font-medium">Products Needing Reorder</span>
            <span className="block text-3xl font-bold text-amber-600 mt-2">{productsNeedingReorder}</span>
          </div>
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <span className="text-gray-500 text-sm font-medium">Total Recommended Reorder Units</span>
            <span className="block text-3xl font-bold text-blue-600 mt-2">{totalRecommendedReorderUnits}</span>
          </div>
        </div>

        {/* Needs Attention & Info Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Needs Attention Table */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden lg:col-span-2">
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-md font-bold text-gray-950">Needs Attention (Critical Alerts)</h3>
              <Link href="/alerts" className="text-xs text-blue-600 font-semibold hover:underline">
                View all alerts →
              </Link>
            </div>
            {needsAttentionList.length === 0 ? (
              <div className="p-12 text-center text-gray-500 text-sm">
                No active critical stockout or low stock alerts logged. Your inventory is healthy!
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-xs font-semibold text-gray-500">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left uppercase">Product</th>
                      <th scope="col" className="px-6 py-3 text-left uppercase">Alert Type</th>
                      <th scope="col" className="px-6 py-3 text-left uppercase">Stock</th>
                      <th scope="col" className="px-6 py-3 text-left uppercase">Message</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200 text-gray-900">
                    {needsAttentionList.slice(0, 5).map((a) => (
                      <tr key={a.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-6 py-4 font-medium">{a.products?.name}</td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border bg-red-100 text-red-800 border-red-200">
                            {a.alert_type}
                          </span>
                        </td>
                        <td className="px-6 py-4 font-semibold">{a.products?.current_stock} units</td>
                        <td className="px-6 py-4 text-xs text-gray-500 max-w-xs truncate">{a.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Quick Guide Card */}
          <div className="bg-white border border-gray-200 rounded-xl p-8 shadow-sm flex flex-col justify-between">
            <div>
              <h3 className="text-lg font-medium text-gray-950">Inventory Intelligence Guide</h3>
              <p className="text-gray-500 text-xs mt-2 leading-relaxed">
                StockMind AI uses moving demand baselines and supplier lead times to predict stockout events before they happen.
              </p>
              <ul className="text-xs text-gray-650 space-y-2 mt-4 list-disc pl-4 leading-relaxed font-medium">
                <li>🔴 **Critical**: Stock levels will run out within the lead time. Reorder immediately.</li>
                <li>🟠 **Warning**: Stock levels are low. Plan orders.</li>
                <li>🔵 **Info**: Overstock detected. Hold off reordering.</li>
              </ul>
            </div>
            <div className="mt-6 pt-4 border-t border-gray-150">
              <Link href="/alerts" className="w-full inline-flex justify-center items-center px-4 py-2 border border-transparent rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors">
                Run Alert Calculations
              </Link>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
