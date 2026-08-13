import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { fetchSalesData } from './actions'
import { fetchProducts, fetchAllAliases } from '@/app/inventory/actions'
import SalesClient from './sales-client'
import DashboardLayout from '@/components/DashboardLayout'

export default async function SalesPage() {
  const supabase = await createClient()

  // Get current user to verify session
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/auth/login')
  }

  // Fetch sales records, summary stats, products, and aliases in parallel
  const [salesResult, productsResult, aliasesResult] = await Promise.all([
    fetchSalesData(),
    fetchProducts(),
    fetchAllAliases(),
  ])

  const { data: sales, stats, error: salesError } = salesResult
  const products = productsResult.data || []
  const aliases = aliasesResult.data || []

  // Merge aliases into product records for multi-field search (name, brand, barcode, alias)
  const productsWithAliases = products.map((p) => ({
    ...p,
    aliases: aliases.filter((a) => a.product_id === p.id),
  }))

  return (
    <DashboardLayout userEmail={user.email}>
      <SalesClient
        initialSales={sales || []}
        initialStats={stats || { totalRecords: 0, totalUnits: 0, totalRevenue: 0 }}
        products={productsWithAliases}
        fetchError={salesError}
      />
    </DashboardLayout>
  )
}
