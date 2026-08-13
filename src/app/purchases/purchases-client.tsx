'use client'

import React, { useState, useMemo, useTransition } from 'react'
import Link from 'next/link'
import {
  ReorderRecommendation,
  PurchaseOrderRecord,
  Supplier,
  ProductSupplier,
  addSupplier,
  updateSupplier,
  deleteSupplier,
  assignSupplierToProduct,
  removeProductSupplier,
  createPurchaseOrders,
} from './actions'
import { calculatePurchaseLineTotal, getPurchaseOrderStatusDisplay } from '@/lib/purchasing/engine'

interface PurchasesClientProps {
  initialRecommendations: ReorderRecommendation[]
  initialOrders: PurchaseOrderRecord[]
  initialSuppliers: Supplier[]
  initialProductSuppliers: ProductSupplier[]
  fetchError?: string | null
}

type Tab = 'recommendations' | 'orders' | 'suppliers'

function formatCurrency(val: number) {
  return `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(str: string | null) {
  if (!str) return '—'
  const d = new Date(str)
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
}

export default function PurchasesClient({
  initialRecommendations,
  initialOrders,
  initialSuppliers,
  initialProductSuppliers,
  fetchError,
}: PurchasesClientProps) {
  const [tab, setTab] = useState<Tab>('recommendations')
  const [pending, startTransition] = useTransition()
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  // ── Recommendation selection state ───────────────────────────────────────
  const [selectedItems, setSelectedItems] = useState<Map<string, {
    recommendedQty: number
    purchaseQty: number
    unitCost: number | null
    supplierId: string | null
    supplierName: string | null
    productName: string
  }>>(new Map())

  // ── Supplier modal state ──────────────────────────────────────────────────
  const [showAddSupplier, setShowAddSupplier] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)

  // ── Product-supplier assignment modal ────────────────────────────────────
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [assigningProductId, setAssigningProductId] = useState<string | null>(null)
  const [assignSupplierId, setAssignSupplierId] = useState('')
  const [assignPrice, setAssignPrice] = useState('')
  const [assignSku, setAssignSku] = useState('')
  const [assignIsPrimary, setAssignIsPrimary] = useState(true)

  // ── Computed summary metrics ──────────────────────────────────────────────
  const metrics = useMemo(() => {
    const productsNeedingReorder = initialRecommendations.length
    const suggestedUnits = initialRecommendations.reduce((s, r) => s + r.recommendedQuantity, 0)
    const draftCount = initialOrders.filter((o) => o.status === 'draft').length
    const pendingCount = initialOrders.filter((o) => o.status === 'ordered' || o.status === 'partially_received').length
    const estimatedValue = Array.from(selectedItems.values()).reduce((s, item) => {
      return s + calculatePurchaseLineTotal(item.purchaseQty, item.unitCost)
    }, 0)
    return { productsNeedingReorder, suggestedUnits, draftCount, pendingCount, estimatedValue }
  }, [initialRecommendations, initialOrders, selectedItems])

  function notify(err?: string | null, ok?: string | null) {
    setActionError(err ?? null)
    setActionSuccess(ok ?? null)
    setTimeout(() => { setActionError(null); setActionSuccess(null) }, 4000)
  }

  // ── Toggle product selection ──────────────────────────────────────────────
  function toggleSelect(rec: ReorderRecommendation) {
    setSelectedItems((prev) => {
      const next = new Map(prev)
      if (next.has(rec.productId)) {
        next.delete(rec.productId)
      } else {
        next.set(rec.productId, {
          recommendedQty: rec.recommendedQuantity,
          purchaseQty: rec.recommendedQuantity,
          unitCost: rec.purchasePrice,
          supplierId: rec.supplierId,
          supplierName: rec.supplierName,
          productName: rec.productName,
        })
      }
      return next
    })
  }

  function updateQty(productId: string, qty: number) {
    setSelectedItems((prev) => {
      const next = new Map(prev)
      const item = next.get(productId)
      if (item) next.set(productId, { ...item, purchaseQty: Math.max(0, qty) })
      return next
    })
  }

  function updateCost(productId: string, cost: number) {
    setSelectedItems((prev) => {
      const next = new Map(prev)
      const item = next.get(productId)
      if (item) next.set(productId, { ...item, unitCost: cost > 0 ? cost : null })
      return next
    })
  }

  // ── Create purchase orders ────────────────────────────────────────────────
  function handleCreateOrders() {
    const items = Array.from(selectedItems.entries()).map(([productId, item]) => ({
      productId,
      productName: item.productName,
      recommendedQuantity: item.recommendedQty,
      orderedQuantity: item.purchaseQty,
      unitCost: item.unitCost,
      supplierId: item.supplierId,
      supplierName: item.supplierName,
    }))

    if (items.length === 0) { notify('No items selected.'); return }
    const invalid = items.find((i) => i.orderedQuantity <= 0)
    if (invalid) { notify(`Purchase quantity for ${invalid.productName} must be > 0.`); return }

    startTransition(async () => {
      const result = await createPurchaseOrders(items)
      if (result.error) { notify(result.error); return }
      setSelectedItems(new Map())
      notify(null, `${result.orderIds?.length ?? 1} purchase order(s) created successfully!`)
      setTab('orders')
    })
  }

  // ── Supplier CRUD handlers ────────────────────────────────────────────────
  function handleAddSupplier(formData: FormData) {
    startTransition(async () => {
      const result = await addSupplier(formData)
      if (result.error) { notify(result.error); return }
      setShowAddSupplier(false)
      notify(null, 'Supplier added.')
    })
  }

  function handleUpdateSupplier(formData: FormData) {
    if (!editingSupplier) return
    startTransition(async () => {
      const result = await updateSupplier(editingSupplier.id, formData)
      if (result.error) { notify(result.error); return }
      setEditingSupplier(null)
      notify(null, 'Supplier updated.')
    })
  }

  function handleDeleteSupplier(id: string, name: string) {
    if (!confirm(`Delete supplier "${name}"? This cannot be undone.`)) return
    startTransition(async () => {
      const result = await deleteSupplier(id)
      if (result.error) { notify(result.error); return }
      notify(null, 'Supplier deleted.')
    })
  }

  // ── Product-supplier assignment ───────────────────────────────────────────
  function openAssign(productId: string) {
    setAssigningProductId(productId)
    setAssignSupplierId('')
    setAssignPrice('')
    setAssignSku('')
    setAssignIsPrimary(true)
    setShowAssignModal(true)
  }

  function handleAssign() {
    if (!assigningProductId || !assignSupplierId) { notify('Select a supplier.'); return }
    startTransition(async () => {
      const result = await assignSupplierToProduct(
        assigningProductId,
        assignSupplierId,
        assignPrice ? parseFloat(assignPrice) : null,
        assignSku || null,
        assignIsPrimary
      )
      if (result.error) { notify(result.error); return }
      setShowAssignModal(false)
      notify(null, 'Supplier assigned.')
    })
  }

  function handleRemovePS(id: string) {
    startTransition(async () => {
      const result = await removeProductSupplier(id)
      if (result.error) { notify(result.error); return }
      notify(null, 'Assignment removed.')
    })
  }

  // ── Unique products for assignment UI ─────────────────────────────────────
  const uniqueProducts = useMemo(() => {
    const seen = new Set<string>()
    return initialRecommendations.filter((r) => {
      if (seen.has(r.productId)) return false
      seen.add(r.productId)
      return true
    })
  }, [initialRecommendations])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Purchase Planning</h1>
          <p className="text-sm text-gray-500 mt-1">Turn reorder recommendations into purchase orders</p>
        </div>
        {selectedItems.size > 0 && (
          <button
            onClick={handleCreateOrders}
            disabled={pending}
            className="inline-flex items-center px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Create Purchase Order ({selectedItems.size})
          </button>
        )}
      </div>

      {/* Notifications */}
      {actionError && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{actionError}</div>}
      {actionSuccess && <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">{actionSuccess}</div>}
      {fetchError && <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">⚠️ {fetchError}</div>}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'Needs Reorder', value: metrics.productsNeedingReorder, color: 'text-red-600' },
          { label: 'Suggested Units', value: metrics.suggestedUnits, color: 'text-amber-600' },
          { label: 'Draft Orders', value: metrics.draftCount, color: 'text-gray-700' },
          { label: 'Pending Orders', value: metrics.pendingCount, color: 'text-blue-600' },
          { label: 'Selected Est. Cost', value: formatCurrency(metrics.estimatedValue), color: 'text-green-700', raw: true },
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{card.label}</p>
            <p className={`text-2xl font-bold ${card.color}`}>
              {card.raw ? card.value : card.value}
            </p>
          </div>
        ))}
      </div>

      {/* Tab navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-6">
          {([
            ['recommendations', 'Recommended Purchases'],
            ['orders', 'Purchase Orders'],
            ['suppliers', 'Suppliers'],
          ] as [Tab, string][]).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* ── TAB: Recommendations ─────────────────────────────────────────── */}
      {tab === 'recommendations' && (
        <div className="space-y-4">
          {initialRecommendations.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <svg className="w-12 h-12 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-gray-500 text-sm">No active reorder recommendations. All products are healthy!</p>
              <p className="text-xs text-gray-400 mt-2">Go to Alerts and click &ldquo;Recalculate Alerts&rdquo; to refresh recommendations.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  Select products to include in a purchase order. Edit quantities as needed.
                </p>
                {selectedItems.size > 0 && (
                  <button onClick={() => setSelectedItems(new Map())} className="text-xs text-gray-400 hover:text-gray-600">
                    Clear selection
                  </button>
                )}
              </div>
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Select</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Product</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Stock</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Demand/day</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Supplier</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Lead Time</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Shelf Life</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase text-blue-700">AI Recommended Qty</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Purchase Qty</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Unit Cost (₹)</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Est. Cost</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Assign</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {initialRecommendations.map((rec) => {
                        const sel = selectedItems.get(rec.productId)
                        const isSelected = !!sel
                        const purchaseQty = sel?.purchaseQty ?? rec.recommendedQuantity
                        const unitCost = sel?.unitCost ?? rec.purchasePrice
                        const estCost = calculatePurchaseLineTotal(purchaseQty, unitCost)

                        return (
                          <tr
                            key={rec.productId}
                            className={`transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50/50'}`}
                          >
                            <td className="px-4 py-3">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelect(rec)}
                                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                            </td>
                            <td className="px-4 py-3 font-medium text-gray-900">{rec.productName}</td>
                            <td className="px-4 py-3 text-gray-600">{rec.currentStock}</td>
                            <td className="px-4 py-3 text-gray-600">{rec.avgDailyDemand.toFixed(1)}</td>
                            <td className="px-4 py-3 text-gray-600">
                              {rec.supplierName ?? <span className="text-gray-400 italic">None</span>}
                            </td>
                            <td className="px-4 py-3 text-gray-600">{rec.leadTimeDays}d</td>
                            <td className="px-4 py-3 text-gray-600">{rec.shelfLifeDays ? `${rec.shelfLifeDays}d` : '—'}</td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center gap-1">
                                <svg className="w-3.5 h-3.5 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                </svg>
                                <span className="font-semibold text-blue-700">{rec.recommendedQuantity}</span>
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {isSelected ? (
                                <input
                                  type="number"
                                  min={1}
                                  value={purchaseQty}
                                  onChange={(e) => updateQty(rec.productId, parseInt(e.target.value) || 0)}
                                  className="w-20 px-2 py-1 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                                />
                              ) : (
                                <span className="text-gray-400 text-xs">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {isSelected ? (
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={unitCost ?? ''}
                                  onChange={(e) => updateCost(rec.productId, parseFloat(e.target.value) || 0)}
                                  placeholder="0.00"
                                  className="w-24 px-2 py-1 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                                />
                              ) : (
                                <span className="text-gray-500 text-xs">{rec.purchasePrice ? formatCurrency(rec.purchasePrice) : '—'}</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-700 font-medium">
                              {isSelected && unitCost ? formatCurrency(estCost) : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => openAssign(rec.productId)}
                                className="text-xs text-blue-600 hover:text-blue-800 underline"
                              >
                                Assign Supplier
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {selectedItems.size > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-blue-900">
                      {selectedItems.size} product(s) selected
                    </p>
                    <p className="text-xs text-blue-700 mt-0.5">
                      Products with different suppliers will be grouped into separate purchase orders.
                    </p>
                  </div>
                  <button
                    onClick={handleCreateOrders}
                    disabled={pending}
                    className="px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {pending ? 'Creating...' : 'Create Purchase Order'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── TAB: Purchase Orders ─────────────────────────────────────────── */}
      {tab === 'orders' && (
        <div className="space-y-4">
          {initialOrders.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <p className="text-gray-500 text-sm">No purchase orders yet.</p>
              <p className="text-xs text-gray-400 mt-2">Select products from Recommended Purchases and create your first order.</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Order ID</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Supplier</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Items</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Total Amount</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Created</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {initialOrders.map((order) => {
                      const { label, badgeClass } = getPurchaseOrderStatusDisplay(order.status)
                      return (
                        <tr key={order.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs text-gray-500">{order.id.slice(0, 8)}...</td>
                          <td className="px-4 py-3 text-gray-700 font-medium">{order.suppliers?.name ?? <span className="text-gray-400 italic">No Supplier</span>}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${badgeClass}`}>
                              {label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-600">{order.purchase_order_items?.length ?? 0}</td>
                          <td className="px-4 py-3 font-semibold text-gray-900">
                            {Number(order.total_amount) > 0 ? formatCurrency(Number(order.total_amount)) : '—'}
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(order.created_at)}</td>
                          <td className="px-4 py-3">
                            <Link
                              href={`/purchases/${order.id}`}
                              className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                            >
                              View →
                            </Link>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: Suppliers ───────────────────────────────────────────────── */}
      {tab === 'suppliers' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowAddSupplier(true)}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              + Add Supplier
            </button>
          </div>

          {initialSuppliers.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <p className="text-gray-500 text-sm">No suppliers configured yet.</p>
              <p className="text-xs text-gray-400 mt-2">Add suppliers to assign them to products and enable grouped purchase orders.</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Supplier Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Contact</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Phone</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Email</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {initialSuppliers.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                      <td className="px-4 py-3 text-gray-500">{s.contact_name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{s.phone ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{s.email ?? '—'}</td>
                      <td className="px-4 py-3 flex gap-3">
                        <button onClick={() => setEditingSupplier(s)} className="text-blue-600 hover:text-blue-800 text-xs font-medium">Edit</button>
                        <button onClick={() => handleDeleteSupplier(s.id, s.name)} className="text-red-500 hover:text-red-700 text-xs font-medium">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Product-Supplier Assignments */}
          {uniqueProducts.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700">Product–Supplier Assignments</h3>
              </div>
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Product</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Assigned Supplier</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Purchase Price</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Primary</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {uniqueProducts.map((rec) => {
                    const assignments = initialProductSuppliers.filter((ps) => ps.product_id === rec.productId)
                    if (assignments.length === 0) {
                      return (
                        <tr key={rec.productId} className="hover:bg-gray-50/50">
                          <td className="px-4 py-3 font-medium text-gray-900">{rec.productName}</td>
                          <td className="px-4 py-3 text-gray-400 italic">None</td>
                          <td className="px-4 py-3 text-gray-400">—</td>
                          <td className="px-4 py-3 text-gray-400">—</td>
                          <td className="px-4 py-3">
                            <button onClick={() => openAssign(rec.productId)} className="text-blue-600 hover:text-blue-800 text-xs">Assign</button>
                          </td>
                        </tr>
                      )
                    }
                    return assignments.map((ps, idx) => (
                      <tr key={ps.id} className="hover:bg-gray-50/50">
                        <td className="px-4 py-3 font-medium text-gray-900">{idx === 0 ? rec.productName : ''}</td>
                        <td className="px-4 py-3 text-gray-700">{(ps as ProductSupplier & { suppliers?: { name: string } | null }).suppliers?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-gray-600">{ps.purchase_price ? formatCurrency(Number(ps.purchase_price)) : '—'}</td>
                        <td className="px-4 py-3">{ps.is_primary ? <span className="text-green-600 text-xs font-semibold">✓ Primary</span> : '—'}</td>
                        <td className="px-4 py-3 flex gap-2">
                          <button onClick={() => openAssign(rec.productId)} className="text-blue-600 hover:text-blue-800 text-xs">Add</button>
                          <button onClick={() => handleRemovePS(ps.id)} className="text-red-500 hover:text-red-700 text-xs">Remove</button>
                        </td>
                      </tr>
                    ))
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── MODALS ───────────────────────────────────────────────────────── */}

      {/* Add Supplier Modal */}
      {showAddSupplier && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">Add Supplier</h2>
            </div>
            <form action={handleAddSupplier} className="px-6 py-5 space-y-4">
              <SupplierFormFields />
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => setShowAddSupplier(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={pending} className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">Save Supplier</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Supplier Modal */}
      {editingSupplier && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">Edit Supplier</h2>
            </div>
            <form action={handleUpdateSupplier} className="px-6 py-5 space-y-4">
              <SupplierFormFields defaultValues={editingSupplier} />
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => setEditingSupplier(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={pending} className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">Update</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign Supplier Modal */}
      {showAssignModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">Assign Supplier</h2>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                <select
                  value={assignSupplierId}
                  onChange={(e) => setAssignSupplierId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">— Select supplier —</option>
                  {initialSuppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {initialSuppliers.length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">No suppliers yet. Add one in the Suppliers tab first.</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Purchase Price (₹) <span className="text-gray-400">(optional)</span></label>
                <input type="number" min="0" step="0.01" value={assignPrice} onChange={(e) => setAssignPrice(e.target.value)} placeholder="0.00" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier SKU <span className="text-gray-400">(optional)</span></label>
                <input type="text" value={assignSku} onChange={(e) => setAssignSku(e.target.value)} placeholder="e.g. MIL-001" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="isPrimary" checked={assignIsPrimary} onChange={(e) => setAssignIsPrimary(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-blue-600" />
                <label htmlFor="isPrimary" className="text-sm text-gray-700">Set as primary supplier</label>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button onClick={() => setShowAssignModal(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
                <button onClick={handleAssign} disabled={pending || !assignSupplierId} className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">Assign</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SupplierFormFields({ defaultValues }: { defaultValues?: Supplier }) {
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Supplier Name *</label>
        <input required name="name" defaultValue={defaultValues?.name} placeholder="e.g. ABC Distributors" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name</label>
        <input name="contact_name" defaultValue={defaultValues?.contact_name ?? ''} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
          <input name="phone" defaultValue={defaultValues?.phone ?? ''} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input name="email" type="email" defaultValue={defaultValues?.email ?? ''} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
        <textarea name="notes" rows={2} defaultValue={defaultValues?.notes ?? ''} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500 resize-none" />
      </div>
    </>
  )
}
