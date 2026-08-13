import { createClient } from '@/utils/supabase/server'
import { fetchProducts, fetchAllAliases } from './actions'
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

  // Fetch products and aliases in parallel
  const [productsResult, aliasesResult] = await Promise.all([
    fetchProducts(),
    fetchAllAliases(),
  ])

  const { data: products, error } = productsResult
  const aliases = aliasesResult.data || []

  // Merge aliases into product records for client-side search
  const productsWithAliases = (products || []).map((p) => ({
    ...p,
    aliases: aliases.filter((a) => a.product_id === p.id),
  }))

  return (
    <DashboardLayout userEmail={user.email}>
      <InventoryClient
        initialProducts={productsWithAliases}
        activeAlerts={activeAlerts || []}
        fetchError={error}
      />
    </DashboardLayout>
  )
}
