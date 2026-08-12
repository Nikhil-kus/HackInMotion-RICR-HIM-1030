import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { fetchAlerts, calculateAndStoreAlerts } from './actions'
import AlertsClient from './alerts-client'
import DashboardLayout from '@/components/DashboardLayout'

export default async function AlertsPage() {
  const supabase = await createClient()

  // Get current user to verify session
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/auth/login')
  }

  // Pre-calculate alerts on page load so user always sees fresh data
  await calculateAndStoreAlerts()

  // Fetch updated alerts from database
  const { data: alerts, error: alertsError } = await fetchAlerts()

  return (
    <DashboardLayout userEmail={user.email}>
      <AlertsClient
        initialAlerts={alerts || []}
        fetchError={alertsError}
      />
    </DashboardLayout>
  )
}
