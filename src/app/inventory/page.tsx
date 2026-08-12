import { createClient } from '@/utils/supabase/server'
import { fetchProducts } from './actions'
import { calculateAndStoreAlerts } from '@/app/alerts/actions'
import InventoryClient from './inventory-client'
import DashboardLayout from '@/components/DashboardLayout'
import { redirect } from 'next/navigation'

export default async function InventoryPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/auth/login')
  }

  // Recalculate alerts so stock status is fresh
  await calculateAndStoreAlerts()

  // Fetch active alerts to pass to InventoryClient
  const { data: activeAlerts } = await supabase
    .from('alerts')
    .select('product_id, alert_type, severity')
    .eq('user_id', user.id)
    .eq('resolved', false)

  const { data: products, error } = await fetchProducts()

  return (
    <DashboardLayout userEmail={user.email}>
      <InventoryClient 
        initialProducts={products || []} 
        activeAlerts={activeAlerts || []} 
        fetchError={error} 
      />
    </DashboardLayout>
  )
}
