import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { fetchSalesData } from './actions'
import SalesClient from './sales-client'
import DashboardLayout from '@/components/DashboardLayout'

export default async function SalesPage() {
  const supabase = await createClient()

  // Get current user to verify session
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/auth/login')
  }

  // Fetch sales records and summary stats
  const { data: sales, stats, error: salesError } = await fetchSalesData()

  // Fetch simple list of user's products for matching in the CSV import
  const { data: products } = await supabase
    .from('products')
    .select('id, name, price')
    .order('name', { ascending: true })

  return (
    <DashboardLayout userEmail={user.email}>
      <SalesClient
        initialSales={sales || []}
        initialStats={stats || { totalRecords: 0, totalUnits: 0, totalRevenue: 0 }}
        products={products || []}
        fetchError={salesError}
      />
    </DashboardLayout>
  )
}
