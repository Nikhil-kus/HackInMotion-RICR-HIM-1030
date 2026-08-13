import { createClient } from '@/utils/supabase/server'
import { redirect, notFound } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'
import { fetchPurchaseOrder } from '../actions'
import OrderDetailClient from './order-detail-client'

export const metadata = {
  title: 'Purchase Order — StockMind AI',
  description: 'View and manage a purchase order.',
}

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const result = await fetchPurchaseOrder(id)
  if (result.error || !result.data) notFound()

  return (
    <DashboardLayout userEmail={user.email}>
      <OrderDetailClient order={result.data} />
    </DashboardLayout>
  )
}
