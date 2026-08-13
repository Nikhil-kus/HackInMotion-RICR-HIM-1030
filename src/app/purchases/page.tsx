import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'
import PurchasesClient from './purchases-client'
import {
  fetchReorderRecommendations,
  fetchPurchaseOrders,
  fetchSuppliers,
  fetchProductSuppliers,
} from './actions'

export const metadata = {
  title: 'Purchase Planning — StockMind AI',
  description: 'Plan and track supplier purchase orders based on smart reorder recommendations.',
}

export default async function PurchasesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const [recommendationsResult, ordersResult, suppliersResult, productSuppliersResult] = await Promise.all([
    fetchReorderRecommendations(),
    fetchPurchaseOrders(),
    fetchSuppliers(),
    fetchProductSuppliers(),
  ])

  return (
    <DashboardLayout userEmail={user.email}>
      <PurchasesClient
        initialRecommendations={recommendationsResult.data ?? []}
        initialOrders={ordersResult.data ?? []}
        initialSuppliers={suppliersResult.data ?? []}
        initialProductSuppliers={productSuppliersResult.data ?? []}
        fetchError={recommendationsResult.error ?? ordersResult.error ?? null}
      />
    </DashboardLayout>
  )
}
