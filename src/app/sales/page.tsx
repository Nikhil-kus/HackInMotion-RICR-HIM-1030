import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'

export default async function SalesPlaceholderPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  return (
    <DashboardLayout userEmail={user.email}>
      <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-sm">
        <h2 className="text-xl font-bold text-gray-900">Sales Transactions Module</h2>
        <p className="text-gray-500 text-sm mt-2 max-w-md mx-auto leading-relaxed">
          This feature is scheduled for development in Phase 5. It will support normalized transaction data uploads via CSV and API integration.
        </p>
      </div>
    </DashboardLayout>
  )
}
