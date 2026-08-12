import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Fetch count of products to show a quick stat
  const { count } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })

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
              <span className="block text-3xl font-bold text-gray-900 mt-2">{count ?? 0}</span>
            </div>
            <div className="mt-4">
              <a href="/inventory" className="text-xs text-blue-600 font-medium hover:underline">
                View inventory →
              </a>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between opacity-75">
            <div>
              <span className="text-gray-500 text-sm font-medium">Total Sales</span>
              <span className="block text-3xl font-bold text-gray-400 mt-2">--</span>
            </div>
            <span className="text-xs text-gray-400 font-medium mt-4 block">
              Feature coming soon
            </span>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between opacity-75">
            <div>
              <span className="text-gray-500 text-sm font-medium">Demand Forecasts</span>
              <span className="block text-3xl font-bold text-gray-400 mt-2">--</span>
            </div>
            <span className="text-xs text-gray-400 font-medium mt-4 block">
              Feature coming soon
            </span>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between opacity-75">
            <div>
              <span className="text-gray-500 text-sm font-medium">Active Alerts</span>
              <span className="block text-3xl font-bold text-gray-400 mt-2">--</span>
            </div>
            <span className="text-xs text-gray-400 font-medium mt-4 block">
              Feature coming soon
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
