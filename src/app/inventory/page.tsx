import { createClient } from '@/utils/supabase/server'
import { fetchProducts } from './actions'
import InventoryClient from './inventory-client'
import DashboardLayout from '@/components/DashboardLayout'
import { redirect } from 'next/navigation'

export default async function InventoryPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/auth/login')
  }

  const { data: products, error } = await fetchProducts()

  return (
    <DashboardLayout userEmail={user.email}>
      <InventoryClient initialProducts={products || []} fetchError={error} />
    </DashboardLayout>
  )
}
