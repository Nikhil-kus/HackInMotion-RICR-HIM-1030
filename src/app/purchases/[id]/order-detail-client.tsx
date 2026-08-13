'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  PurchaseOrderRecord,
  PurchaseOrderItem,
  receiveStock,
  updatePurchaseOrderStatus,
} from '../actions'
import {
  getPurchaseOrderStatusDisplay,
  calculateRemainingQuantity,
  calculateReceivedQuantityStatus,
} from '@/lib/purchasing/engine'

interface OrderDetailClientProps {
  order: PurchaseOrderRecord
}

function formatCurrency(val: number) {
  return `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(str: string | null | undefined) {
  if (!str) return '—'
  const d = new Date(str)
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
}

export default function OrderDetailClient({ order }: OrderDetailClientProps) {
  const [pending, startTransition] = useTransition()
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  // Receive quantities input state (per item)
  const [receiveQtys, setReceiveQtys] = useState<Map<string, number>>(new Map())
  const [showReceiveForm, setShowReceiveForm] = useState(false)

  const items: PurchaseOrderItem[] = (order.purchase_order_items as PurchaseOrderItem[]) ?? []
  const { label, badgeClass } = getPurchaseOrderStatusDisplay(order.status)

  function notify(err?: string | null, ok?: string | null) {
    setActionError(err ?? null)
    setActionSuccess(ok ?? null)
    setTimeout(() => { setActionError(null); setActionSuccess(null) }, 5000)
  }

  function handleMarkOrdered() {
    startTransition(async () => {
      const result = await updatePurchaseOrderStatus(order.id, 'ordered')
      if (result.error) { notify(result.error); return }
      notify(null, 'Order marked as Ordered.')
    })
  }

  function handleCancel() {
    if (!confirm('Cancel this purchase order? This cannot be undone.')) return
    startTransition(async () => {
      const result = await updatePurchaseOrderStatus(order.id, 'cancelled')
      if (result.error) { notify(result.error); return }
      notify(null, 'Order cancelled.')
    })
  }

  function handleReceive() {
    const receives: Array<{ itemId: string; receiveQuantity: number }> = []
    for (const [itemId, qty] of receiveQtys.entries()) {
      if (qty > 0) receives.push({ itemId, receiveQuantity: qty })
    }

    if (receives.length === 0) { notify('Enter at least one receive quantity.'); return }

    startTransition(async () => {
      const result = await receiveStock(order.id, receives)
      if (result.error) { notify(result.error); return }
      setShowReceiveForm(false)
      setReceiveQtys(new Map())
      notify(null, `Stock received! Order status: ${result.newStatus?.replace('_', ' ')}.`)
    })
  }

  const canMarkOrdered = order.status === 'draft'
  const canReceive = order.status === 'ordered' || order.status === 'partially_received'
  const canCancel = order.status === 'draft' || order.status === 'ordered'

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <Link href="/purchases" className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1 mb-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Purchase Orders
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Purchase Order</h1>
          <p className="text-xs font-mono text-gray-400 mt-1">{order.id}</p>
        </div>
        <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold border ${badgeClass} self-start`}>
          {label}
        </span>
      </div>

      {/* Notifications */}
      {actionError && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{actionError}</div>}
      {actionSuccess && <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">{actionSuccess}</div>}

      {/* Order Info Card */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Order Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-y-4 gap-x-6 text-sm">
          <div>
            <p className="text-xs text-gray-500 uppercase font-medium mb-0.5">Supplier</p>
            <p className="text-gray-900 font-medium">{order.suppliers?.name ?? <span className="text-gray-400 italic">No Supplier</span>}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase font-medium mb-0.5">Status</p>
            <p className="text-gray-900">{label}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase font-medium mb-0.5">Created</p>
            <p className="text-gray-900">{formatDate(order.created_at)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase font-medium mb-0.5">Ordered On</p>
            <p className="text-gray-900">{formatDate(order.ordered_at)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase font-medium mb-0.5">Expected Delivery</p>
            <p className="text-gray-900">{formatDate(order.expected_at)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase font-medium mb-0.5">Received On</p>
            <p className="text-gray-900">{formatDate(order.received_at)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase font-medium mb-0.5">Order Total</p>
            <p className="text-gray-900 font-semibold text-base">
              {Number(order.total_amount) > 0 ? formatCurrency(Number(order.total_amount)) : '—'}
            </p>
          </div>
          {order.notes && (
            <div className="col-span-2">
              <p className="text-xs text-gray-500 uppercase font-medium mb-0.5">Notes</p>
              <p className="text-gray-700">{order.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Line Items */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-700">Order Items</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Product</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">AI Recommended</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Ordered Qty</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Received Qty</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Remaining</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Unit Cost</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Line Total</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Receipt Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {items.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-sm">No items in this order.</td></tr>
              ) : items.map((item) => {
                const remaining = calculateRemainingQuantity(item.ordered_quantity, item.received_quantity)
                const recvStatus = calculateReceivedQuantityStatus(item.ordered_quantity, item.received_quantity)
                const statusBadge = recvStatus === 'fully_received'
                  ? 'bg-green-100 text-green-700 border-green-200'
                  : recvStatus === 'partially_received'
                    ? 'bg-amber-100 text-amber-700 border-amber-200'
                    : 'bg-gray-100 text-gray-600 border-gray-200'
                const statusLabel = recvStatus === 'fully_received' ? 'Received'
                  : recvStatus === 'partially_received' ? 'Partial'
                  : 'Pending'

                return (
                  <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{(item as PurchaseOrderItem & { products?: { name: string } | null }).products?.name ?? item.product_id.slice(0, 8)}</td>
                    <td className="px-4 py-3 text-blue-700 font-semibold">{item.recommended_quantity}</td>
                    <td className="px-4 py-3 text-gray-700 font-semibold">{item.ordered_quantity}</td>
                    <td className="px-4 py-3 text-gray-700">{item.received_quantity}</td>
                    <td className="px-4 py-3 text-gray-700">{remaining}</td>
                    <td className="px-4 py-3 text-gray-600">{item.unit_cost ? formatCurrency(Number(item.unit_cost)) : '—'}</td>
                    <td className="px-4 py-3 font-semibold text-gray-900">{Number(item.line_total) > 0 ? formatCurrency(Number(item.line_total)) : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${statusBadge}`}>
                        {statusLabel}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Receive Form */}
      {showReceiveForm && canReceive && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-blue-900">Enter Received Quantities</h3>
          <div className="space-y-3">
            {items.filter((i) => calculateRemainingQuantity(i.ordered_quantity, i.received_quantity) > 0).map((item) => {
              const remaining = calculateRemainingQuantity(item.ordered_quantity, item.received_quantity)
              const currentInput = receiveQtys.get(item.id) ?? 0
              return (
                <div key={item.id} className="flex items-center gap-4">
                  <span className="text-sm font-medium text-gray-800 flex-1">
                    {(item as PurchaseOrderItem & { products?: { name: string } | null }).products?.name ?? 'Product'}
                    <span className="text-xs text-gray-500 ml-2">(Remaining: {remaining})</span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={remaining}
                    value={currentInput}
                    onChange={(e) => {
                      const val = Math.min(remaining, Math.max(0, parseInt(e.target.value) || 0))
                      setReceiveQtys((prev) => {
                        const next = new Map(prev)
                        next.set(item.id, val)
                        return next
                      })
                    }}
                    className="w-24 px-2 py-1.5 border border-blue-300 rounded-md text-sm text-gray-900 font-semibold focus:ring-blue-500 focus:border-blue-500 bg-white"
                  />
                </div>
              )
            })}
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleReceive}
              disabled={pending}
              className="px-5 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {pending ? 'Processing...' : 'Confirm Receipt'}
            </button>
            <button
              onClick={() => { setShowReceiveForm(false); setReceiveQtys(new Map()) }}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-blue-700">
            ⚠️ Stock will be added to inventory immediately. This cannot be undone.
          </p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3">
        {canMarkOrdered && (
          <button
            onClick={handleMarkOrdered}
            disabled={pending}
            className="px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            Mark as Ordered
          </button>
        )}
        {canReceive && !showReceiveForm && (
          <button
            onClick={() => setShowReceiveForm(true)}
            className="px-5 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors"
          >
            Receive Stock
          </button>
        )}
        {canCancel && (
          <button
            onClick={handleCancel}
            disabled={pending}
            className="px-5 py-2.5 bg-white border border-red-300 text-red-600 text-sm font-semibold rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
          >
            Cancel Order
          </button>
        )}
        <Link href="/purchases" className="px-5 py-2.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
          ← Back to Orders
        </Link>
      </div>
    </div>
  )
}
