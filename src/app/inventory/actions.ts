'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'

export interface Product {
  id: string
  user_id: string
  name: string
  category: string
  current_stock: number
  price: number
  supplier_name: string
  supplier_lead_time_days: number
  created_at: string
  updated_at: string
}

export async function fetchProducts() {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('name', { ascending: true })

  if (error) {
    console.error('Error fetching products:', error)
    return { error: error.message }
  }

  return { data: data as Product[] }
}

export async function addProduct(formData: FormData) {
  const supabase = await createClient()

  // Get current user to bind the user_id
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return { error: 'Unauthorized. Please log in.' }
  }

  const name = formData.get('name') as string
  const category = formData.get('category') as string
  const currentStockStr = formData.get('current_stock') as string
  const priceStr = formData.get('price') as string
  const supplierName = (formData.get('supplier_name') as string) || ''
  const supplierLeadTimeStr = formData.get('supplier_lead_time_days') as string

  // Simple validation
  if (!name?.trim()) return { error: 'Product name is required.' }
  if (!category?.trim()) return { error: 'Category is required.' }

  const current_stock = parseInt(currentStockStr, 10)
  if (isNaN(current_stock) || current_stock < 0) {
    return { error: 'Current stock must be a non-negative number.' }
  }

  const price = parseFloat(priceStr)
  if (isNaN(price) || price < 0) {
    return { error: 'Price must be a non-negative number.' }
  }

  const supplier_lead_time_days = parseInt(supplierLeadTimeStr, 10)
  if (isNaN(supplier_lead_time_days) || supplier_lead_time_days < 0) {
    return { error: 'Lead time must be a non-negative number of days.' }
  }

  const { error } = await supabase.from('products').insert({
    user_id: user.id,
    name,
    category,
    current_stock,
    price,
    supplier_name: supplierName,
    supplier_lead_time_days,
  })

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/inventory')
  return { success: true }
}

export async function updateProduct(id: string, formData: FormData) {
  const supabase = await createClient()

  // Get current user to verify authentication
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return { error: 'Unauthorized. Please log in.' }
  }

  const name = formData.get('name') as string
  const category = formData.get('category') as string
  const currentStockStr = formData.get('current_stock') as string
  const priceStr = formData.get('price') as string
  const supplierName = (formData.get('supplier_name') as string) || ''
  const supplierLeadTimeStr = formData.get('supplier_lead_time_days') as string

  // Simple validation
  if (!name?.trim()) return { error: 'Product name is required.' }
  if (!category?.trim()) return { error: 'Category is required.' }

  const current_stock = parseInt(currentStockStr, 10)
  if (isNaN(current_stock) || current_stock < 0) {
    return { error: 'Current stock must be a non-negative number.' }
  }

  const price = parseFloat(priceStr)
  if (isNaN(price) || price < 0) {
    return { error: 'Price must be a non-negative number.' }
  }

  const supplier_lead_time_days = parseInt(supplierLeadTimeStr, 10)
  if (isNaN(supplier_lead_time_days) || supplier_lead_time_days < 0) {
    return { error: 'Lead time must be a non-negative number of days.' }
  }

  // RLS ensures the user can only update their own records
  const { error } = await supabase
    .from('products')
    .update({
      name,
      category,
      current_stock,
      price,
      supplier_name: supplierName,
      supplier_lead_time_days,
    })
    .eq('id', id)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/inventory')
  return { success: true }
}

export async function deleteProduct(id: string) {
  const supabase = await createClient()

  // Get current user to verify authentication
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return { error: 'Unauthorized. Please log in.' }
  }

  // RLS ensures the user can only delete their own records
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/inventory')
  return { success: true }
}
