'use client'

import React, { useState, useMemo } from 'react'
import type { Product, ProductAlias } from './types'
import { SUPPORTED_UNITS, SUPPORTED_PACK_SIZE_UNITS } from './types'
import Image from 'next/image'
import { getProductImage } from '@/lib/product-images'
import {
  addProduct,
  updateProduct,
  deleteProduct,
  addAlias,
  deleteAlias,
} from './actions'

interface ActiveAlertSimple {
  product_id: string
  alert_type: string
  severity: string
}

interface InventoryClientProps {
  initialProducts: Product[]
  activeAlerts: ActiveAlertSimple[]
  fetchError?: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Format pack size info compactly
// ─────────────────────────────────────────────────────────────────────────────
function formatPackInfo(product: Product): string | null {
  const parts: string[] = []
  if (product.brand) parts.push(product.brand)
  if (product.unit) parts.push(product.unit)
  if (product.pack_size != null && product.pack_size_unit) {
    parts.push(`${product.pack_size % 1 === 0 ? product.pack_size.toFixed(0) : product.pack_size} ${product.pack_size_unit}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

// ─────────────────────────────────────────────────────────────────────────────
// INLINE ALIAS MANAGER (used in both Add & Edit modals)
// ─────────────────────────────────────────────────────────────────────────────
interface AliasManagerProps {
  productId?: string          // undefined when adding a new product (aliases added after save)
  existingAliases: ProductAlias[]
  pendingAliases: Array<{ alias: string; language: string }>
  onAddPending: (alias: string, language: string) => void
  onRemovePending: (index: number) => void
  onDeleteSaved?: (aliasId: string) => void
  deletingAliasId?: string | null
}

function AliasManager({
  existingAliases,
  pendingAliases,
  onAddPending,
  onRemovePending,
  onDeleteSaved,
  deletingAliasId,
}: AliasManagerProps) {
  const [newAlias, setNewAlias] = useState('')
  const [newLang, setNewLang] = useState('')

  function handleAdd() {
    const trimmed = newAlias.trim()
    if (!trimmed) return
    onAddPending(trimmed, newLang.trim())
    setNewAlias('')
    setNewLang('')
  }

  return (
    <div className="space-y-2">
      {/* Saved aliases (edit mode only) */}
      {existingAliases.map((a) => (
        <div key={a.id} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-md px-3 py-1.5 text-sm">
          <span className="flex-1 text-gray-800 font-medium">{a.alias}</span>
          {a.language && (
            <span className="text-xs text-gray-400 bg-gray-200 rounded px-1.5 py-0.5">{a.language}</span>
          )}
          {onDeleteSaved && (
            <button
              type="button"
              onClick={() => onDeleteSaved(a.id)}
              disabled={deletingAliasId === a.id}
              className="text-red-400 hover:text-red-600 disabled:opacity-40 transition-colors ml-1"
              aria-label={`Delete alias ${a.alias}`}
            >
              {deletingAliasId === a.id ? '…' : '✕'}
            </button>
          )}
        </div>
      ))}

      {/* Pending aliases (not yet saved to DB) */}
      {pendingAliases.map((pa, idx) => (
        <div key={idx} className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-3 py-1.5 text-sm">
          <span className="flex-1 text-gray-800 font-medium">{pa.alias}</span>
          {pa.language && (
            <span className="text-xs text-blue-500 bg-blue-100 rounded px-1.5 py-0.5">{pa.language}</span>
          )}
          <span className="text-xs text-blue-400 italic">unsaved</span>
          <button
            type="button"
            onClick={() => onRemovePending(idx)}
            className="text-red-400 hover:text-red-600 transition-colors ml-1"
            aria-label={`Remove pending alias ${pa.alias}`}
          >
            ✕
          </button>
        </div>
      ))}

      {/* Add new alias row */}
      <div className="flex gap-2 pt-1">
        <input
          type="text"
          value={newAlias}
          onChange={(e) => setNewAlias(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd() } }}
          placeholder="e.g. दूध, amul doodh"
          className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
        />
        <input
          type="text"
          value={newLang}
          onChange={(e) => setNewLang(e.target.value)}
          placeholder="Lang (optional)"
          className="w-28 px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors shrink-0"
        >
          Add
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION DIVIDER
// ─────────────────────────────────────────────────────────────────────────────
function FormSection({ title }: { title: string }) {
  return (
    <div className="pt-2 pb-1 border-b border-gray-100">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{title}</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL STYLE CONSTANTS (shared by KiranaFormFields & InventoryClient)
// ─────────────────────────────────────────────────────────────────────────────
const inputCls = 'mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500'
const selectCls = inputCls + ' bg-white'

// ─────────────────────────────────────────────────────────────────────────────
// SHARED FORM FIELDS for Add / Edit (must be at module level, not inside render)
// ─────────────────────────────────────────────────────────────────────────────
function KiranaFormFields({ product }: { product?: Product | null }) {
  return (
    <>
      {/* ── SECTION 1: Basic Information */}
      <FormSection title="Basic Information" />

      <div>
        <label className="block text-sm font-medium text-gray-700">Product Name <span className="text-red-500">*</span></label>
        <input required type="text" name="name" defaultValue={product?.name || ''} className={inputCls} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Brand <span className="text-xs text-gray-400">(Optional)</span></label>
          <input type="text" name="brand" defaultValue={product?.brand || ''} placeholder="e.g. Amul, Parle" className={inputCls} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Category <span className="text-red-500">*</span></label>
          <input required type="text" name="category" defaultValue={product?.category || ''} placeholder="e.g. Dairy, Grocery" className={inputCls} />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Barcode <span className="text-xs text-gray-400">(Optional)</span></label>
        <input type="text" name="barcode" defaultValue={product?.barcode || ''} placeholder="e.g. 8901234567890" className={inputCls} />
      </div>

      {/* ── SECTION 2: Selling & Quantity */}
      <FormSection title="Selling & Quantity" />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Selling Price (₹) <span className="text-red-500">*</span></label>
          <input required type="number" step="0.01" min="0" name="price" defaultValue={product?.price ?? '0.00'} className={inputCls} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Selling Unit <span className="text-xs text-gray-400">(Optional)</span></label>
          <select name="unit" defaultValue={product?.unit || ''} className={selectCls}>
            <option value="">— select unit —</option>
            {SUPPORTED_UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Pack Size <span className="text-xs text-gray-400">(Optional)</span></label>
          <input type="number" step="any" min="0.001" name="pack_size" defaultValue={product?.pack_size ?? ''} placeholder="e.g. 500" className={inputCls} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Pack Size Unit <span className="text-xs text-gray-400">(required if Pack Size set)</span></label>
          <select name="pack_size_unit" defaultValue={product?.pack_size_unit || ''} className={selectCls}>
            <option value="">— select —</option>
            {SUPPORTED_PACK_SIZE_UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── SECTION 3: Inventory */}
      <FormSection title="Inventory" />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Current Stock <span className="text-red-500">*</span></label>
          <input required type="number" min="0" name="current_stock" defaultValue={product?.current_stock ?? 0} className={inputCls} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Supplier Lead Time (Days) <span className="text-red-500">*</span></label>
          <input required type="number" min="0" name="supplier_lead_time_days" defaultValue={product?.supplier_lead_time_days ?? 0} className={inputCls} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Supplier Name <span className="text-xs text-gray-400">(Optional)</span></label>
          <input type="text" name="supplier_name" defaultValue={product?.supplier_name || ''} className={inputCls} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Shelf Life (Days) <span className="text-xs text-gray-400">(Optional)</span></label>
          <input type="number" min="1" name="shelf_life_days" defaultValue={product?.shelf_life_days || ''} placeholder="e.g. 3, 180" className={inputCls} />
        </div>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function InventoryClient({ initialProducts, activeAlerts, fetchError }: InventoryClientProps) {
  const [products] = useState<Product[]>(initialProducts)
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [error, setError] = useState<string | null>(fetchError || null)
  const [success, setSuccess] = useState<string | null>(null)

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null)
  const [pending, setPending] = useState(false)

  // Alias state for Add modal (pending only, no saved)
  const [addPendingAliases, setAddPendingAliases] = useState<Array<{ alias: string; language: string }>>([])

  // Alias state for Edit modal
  const [editSavedAliases, setEditSavedAliases] = useState<ProductAlias[]>([])
  const [editPendingAliases, setEditPendingAliases] = useState<Array<{ alias: string; language: string }>>([])
  const [deletingAliasId, setDeletingAliasId] = useState<string | null>(null)

  // Dynamic category list
  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category))
    return Array.from(set).sort()
  }, [products])

  // Stock status badge
  // PRIMARY SOURCE: active alerts from the DB (pre-calculated by the alert engine on page load).
  // SECONDARY SOURCE: inline engine calculation — used only when no active alert exists.
  // This ensures the badge is never driven by naive stock-count thresholds.
  const getStockStatus = (productId: string, stock: number) => {
    const alert = activeAlerts.find((a) => a.product_id === productId)
    if (alert) {
      if (alert.alert_type === 'stockout') return { label: 'Out of Stock', badgeClass: 'bg-red-100 text-red-800 border-red-200' }
      if (alert.severity === 'critical') return { label: 'Critical', badgeClass: 'bg-red-100 text-red-800 border-red-200 font-bold' }
      if (alert.alert_type === 'reorder') return { label: 'Low Stock', badgeClass: 'bg-amber-100 text-amber-800 border-amber-200' }
      if (alert.alert_type === 'overstock') return { label: 'Overstock', badgeClass: 'bg-blue-100 text-blue-800 border-blue-200' }
    }
    // No active alert: the engine evaluated this product as healthy/no-action-needed.
    // Show 'Healthy' — but also guard against the edge case of zero stock with no alert.
    if (stock === 0) return { label: 'Out of Stock', badgeClass: 'bg-red-100 text-red-800 border-red-200' }
    return { label: 'Healthy', badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200' }
  }

  // ── Expanded search: name, brand, barcode, alias text
  const filteredProducts = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    return products.filter((product) => {
      if (categoryFilter && product.category !== categoryFilter) return false
      if (!q) return true

      if (product.name.toLowerCase().includes(q)) return true
      if (product.brand?.toLowerCase().includes(q)) return true
      if (product.barcode?.toLowerCase().includes(q)) return true
      if (product.aliases?.some((a) => a.alias.toLowerCase().includes(q))) return true
      return false
    })
  }, [products, searchQuery, categoryFilter])

  // Toasts
  const showToast = (message: string, isError = false) => {
    if (isError) { setError(message); setSuccess(null) }
    else { setSuccess(message); setError(null) }
    setTimeout(() => { setError(null); setSuccess(null) }, 5000)
  }

  // ── Add product submit
  async function handleAddSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)

    const formData = new FormData(e.currentTarget)
    const result = await addProduct(formData)

    if (result.error) {
      showToast(result.error, true)
      setPending(false)
      return
    }

    // Save pending aliases now that we have the product id
    if (result.productId && addPendingAliases.length > 0) {
      for (const pa of addPendingAliases) {
        await addAlias(result.productId, pa.alias, pa.language || undefined)
      }
    }

    window.location.reload()
  }

  // ── Edit product: open modal
  function openEditModal(product: Product) {
    setEditingProduct(product)
    setEditSavedAliases(product.aliases || [])
    setEditPendingAliases([])
  }

  // ── Edit product submit
  async function handleEditSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editingProduct) return
    setPending(true)
    setError(null)

    const formData = new FormData(e.currentTarget)
    const result = await updateProduct(editingProduct.id, formData)

    if (result.error) {
      showToast(result.error, true)
      setPending(false)
      return
    }

    // Save pending aliases
    for (const pa of editPendingAliases) {
      await addAlias(editingProduct.id, pa.alias, pa.language || undefined)
    }

    window.location.reload()
  }

  // ── Delete alias (edit mode)
  async function handleDeleteAlias(aliasId: string) {
    setDeletingAliasId(aliasId)
    const result = await deleteAlias(aliasId)
    if (result.error) {
      showToast(result.error, true)
    } else {
      setEditSavedAliases((prev) => prev.filter((a) => a.id !== aliasId))
    }
    setDeletingAliasId(null)
  }

  // ── Delete product
  async function handleDeleteConfirm() {
    if (!deletingProduct) return
    setPending(true)
    const result = await deleteProduct(deletingProduct.id)
    if (result.error) {
      showToast(result.error, true)
      setPending(false)
    } else {
      window.location.reload()
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Inventory Management</h2>
          <p className="text-gray-500 text-sm mt-1">Manage and track your products, stock levels, and suppliers.</p>
        </div>
        <button
          onClick={() => { setAddPendingAliases([]); setIsAddModalOpen(true) }}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
        >
          <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Product
        </button>
      </div>

      {/* Toasts */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">✕</button>
        </div>
      )}
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-lg text-sm flex items-center justify-between">
          <span>{success}</span>
          <button onClick={() => setSuccess(null)} className="text-emerald-500 hover:text-emerald-700">✕</button>
        </div>
      )}

      {/* Search & Filters */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <input
            type="text"
            placeholder="Search by name, brand, barcode, or local name…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
          />
          <span className="absolute left-3 top-2.5 text-gray-400">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
        </div>
        <div className="md:w-64">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
          >
            <option value="">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Products table */}
      {filteredProducts.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-sm">
          <div className="mx-auto w-12 h-12 text-gray-400 mb-4">
            <svg className="w-full h-full" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-950">No products found</h3>
          <p className="text-gray-500 text-sm mt-1 mb-6">
            {products.length === 0
              ? 'Get started by creating your first product inventory record.'
              : 'Try adjusting your search query or category filter.'}
          </p>
          {products.length === 0 && (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none transition-colors"
            >
              Add Product
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Product</th>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Category</th>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Stock</th>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Price</th>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Supplier</th>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Lead / Shelf</th>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th scope="col" className="relative px-6 py-3.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredProducts.map((product) => {
                  const status = getStockStatus(product.id, product.current_stock)
                  const packInfo = formatPackInfo(product)
                  return (
                    <tr key={product.id} className="hover:bg-gray-50/50 transition-colors">
                      {/* Product name + compact Kirana info */}
                      <td className="px-6 py-4 text-sm">
                        <div className="flex items-center gap-3">
                          <div className="relative w-10 h-10 rounded-lg bg-gray-50 border border-gray-200 overflow-hidden flex-shrink-0">
                            <Image
                              src={getProductImage(product.name, product.brand)}
                              alt={product.name}
                              fill
                              className="object-cover"
                              sizes="40px"
                            />
                          </div>
                          <div>
                            <div className="font-medium text-gray-900">{product.name}</div>
                            {packInfo && (
                              <div className="text-xs text-gray-500 mt-0.5">{packInfo}</div>
                            )}
                            {product.barcode && (
                              <div className="text-xs text-gray-400 mt-0.5 font-mono">Barcode: {product.barcode}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{product.category}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{product.current_stock}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">₹{product.price.toFixed(2)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{product.supplier_name || 'N/A'}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <div>Lead Time: {product.supplier_lead_time_days} {product.supplier_lead_time_days === 1 ? 'day' : 'days'}</div>
                        <div className="text-xs text-gray-400">Shelf Life: {product.shelf_life_days ? `${product.shelf_life_days} days` : 'N/A'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${status.badgeClass}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                        <button
                          onClick={() => openEditModal(product)}
                          className="text-blue-600 hover:text-blue-900 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeletingProduct(product)}
                          className="text-red-600 hover:text-red-900 transition-colors"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── ADD PRODUCT MODAL ─────────────────────────────────────────────────── */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 flex items-start justify-center p-4 pt-8">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full border border-gray-100 overflow-hidden">
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-150 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Add New Product</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={handleAddSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              <KiranaFormFields product={null} />

              {/* ── SECTION 4: Local Names */}
              <FormSection title="Local Names / Aliases" />
              <p className="text-xs text-gray-500">
                Add local or Hindi names for this product. These will be searchable in the inventory. You can add more aliases after saving.
              </p>
              <AliasManager
                existingAliases={[]}
                pendingAliases={addPendingAliases}
                onAddPending={(alias, language) => setAddPendingAliases((prev) => [...prev, { alias, language }])}
                onRemovePending={(idx) => setAddPendingAliases((prev) => prev.filter((_, i) => i !== idx))}
              />

              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="px-4 py-2 border border-transparent rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {pending ? 'Adding…' : 'Add Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── EDIT PRODUCT MODAL ────────────────────────────────────────────────── */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 flex items-start justify-center p-4 pt-8">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full border border-gray-100 overflow-hidden">
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-150 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Edit Product</h3>
              <button onClick={() => setEditingProduct(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <form onSubmit={handleEditSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              <KiranaFormFields product={editingProduct} />

              {/* ── SECTION 4: Local Names */}
              <FormSection title="Local Names / Aliases" />
              <p className="text-xs text-gray-500">
                Local and Hindi names make this product searchable by alias. Aliases are saved individually.
              </p>
              <AliasManager
                productId={editingProduct.id}
                existingAliases={editSavedAliases}
                pendingAliases={editPendingAliases}
                onAddPending={(alias, language) => setEditPendingAliases((prev) => [...prev, { alias, language }])}
                onRemovePending={(idx) => setEditPendingAliases((prev) => prev.filter((_, i) => i !== idx))}
                onDeleteSaved={handleDeleteAlias}
                deletingAliasId={deletingAliasId}
              />

              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setEditingProduct(null)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="px-4 py-2 border border-transparent rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  {pending ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRMATION ───────────────────────────────────────────────── */}
      {deletingProduct && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full border border-gray-100 overflow-hidden p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Product</h3>
            <p className="text-gray-500 text-sm mb-6">
              Are you sure you want to delete <span className="font-semibold text-gray-900">&quot;{deletingProduct.name}&quot;</span>? This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setDeletingProduct(null)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={pending}
                className="px-4 py-2 border border-transparent rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
              >
                {pending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
