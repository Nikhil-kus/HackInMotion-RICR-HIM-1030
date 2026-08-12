import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'

export default async function ForecastsPlaceholderPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  return (
    <DashboardLayout userEmail={user.email}>
      <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-sm">
        <h2 className="text-xl font-bold text-gray-900">Demand Forecasting Engine</h2>
        <p className="text-gray-500 text-sm mt-2 max-w-md mx-auto leading-relaxed">
          This feature is scheduled for development in Phase 6. It will calculate demand forecasts using weighted moving averages, trends, and seasonal components.
        </p>
      </div>
    </DashboardLayout>
  )
}
