import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'
import DashboardClient from './dashboard-client'
import { fetchDashboardAnalytics } from './actions'

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Fetch initial 30-day analytics data on the server
  const analyticsResult = await fetchDashboardAnalytics(30)

  return (
    <DashboardLayout userEmail={user.email}>
      {analyticsResult.error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-xl text-sm font-semibold">
          Error loading dashboard analytics: {analyticsResult.error}
        </div>
      ) : (
        <DashboardClient initialData={analyticsResult.data!} initialDays={30} />
      )}
    </DashboardLayout>
  )
}
