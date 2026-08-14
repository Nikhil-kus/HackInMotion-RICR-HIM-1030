'use client'

import React, { useState, useMemo } from 'react'
import { DBAlertRecord, resolveAlert, calculateAndStoreAlerts } from './actions'
interface AlertsClientProps {
  initialAlerts: DBAlertRecord[]
  fetchError?: string | null
}

interface AlertDetailInfo {
  reason: string
  currentStock: number
  onOrderStock?: number
  avgDailyDemand: number
  leadTimeDays: number
  shelfLifeDays?: number | null
  replenishmentCycleDays: number
  expectedDemand: number
  safetyStock: number
  maxSellableDemand?: number | null
  recommendedQty: number
}

function formatDateTime(dateStr: string) {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  const day = String(d.getUTCDate()).padStart(2, '0')
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const year = d.getUTCFullYear()
  const hours = String(d.getUTCHours()).padStart(2, '0')
  const minutes = String(d.getUTCMinutes()).padStart(2, '0')
  const seconds = String(d.getUTCSeconds()).padStart(2, '0')
  return `${day}/${month}/${year}, ${hours}:${minutes}:${seconds} UTC`
}

export default function AlertsClient({ initialAlerts, fetchError }: AlertsClientProps) {
  const alerts = initialAlerts
  const [pending, setPending] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('all') // all, critical, warning, info
  const [typeFilter, setTypeFilter] = useState('all') // all, stockout, overstock, reorder
  const [statusFilter, setStatusFilter] = useState('active') // active, resolved, all

  const [errorMsg, setErrorMsg] = useState<string | null>(fetchError || null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const showToast = (message: string, isError = false) => {
    if (isError) {
      setErrorMsg(message)
      setSuccessMsg(null)
    } else {
      setSuccessMsg(message)
      setErrorMsg(null)
    }
    setTimeout(() => {
      setErrorMsg(null)
      setSuccessMsg(null)
    }, 6000)
  }

  // Parse days remaining and average daily demand from message for display
  const parsedAlerts = useMemo(() => {
    return alerts.map((a) => {
      const stock = a.products?.current_stock ?? 0
      
      // Parse days remaining using Regex matching from structured engine reason
      let daysRemaining = 999
      if (stock <= 0) {
        daysRemaining = 0
      } else {
        const match = a.message.match(/~(\d+(\.\d+)?)\s+days/)
        if (match) {
          daysRemaining = parseFloat(match[1])
        }
      }

      // Calculate avg daily demand: Stock / DaysRemaining
      const avgDailyDemand = (daysRemaining > 0 && daysRemaining !== 999)
        ? stock / daysRemaining
        : 0

      return {
        ...a,
        daysRemaining,
        avgDailyDemand
      }
    })
  }, [alerts])

  // Filtered lists
  const filteredAlerts = useMemo(() => {
    return parsedAlerts.filter((a) => {
      // 1. Search Query
      const name = a.products?.name ?? ''
      const matchesSearch = name.toLowerCase().includes(searchQuery.toLowerCase())

      // 2. Status Filter
      let matchesStatus = true
      if (statusFilter === 'active') {
        matchesStatus = !a.resolved
      } else if (statusFilter === 'resolved') {
        matchesStatus = a.resolved
      }

      // 3. Priority Filter
      let matchesPriority = true
      if (priorityFilter !== 'all') {
        const mappedSeverity = priorityFilter === 'critical' ? 'critical'
          : priorityFilter === 'warning' ? 'medium'
          : 'low'
        matchesPriority = a.severity === mappedSeverity
      }

      // 4. Type Filter
      let matchesType = true
      if (typeFilter !== 'all') {
        matchesType = a.alert_type === typeFilter
      }

      return matchesSearch && matchesStatus && matchesPriority && matchesType
    })
  }, [parsedAlerts, searchQuery, statusFilter, priorityFilter, typeFilter])

  // Summary Card Statistics (based only on active alerts)
  const stats = useMemo(() => {
    const active = parsedAlerts.filter((a) => !a.resolved)
    const totalActive = active.length
    const criticalCount = active.filter((a) => a.severity === 'critical').length
    const reorderCount = active.filter((a) => a.alert_type === 'reorder' || a.alert_type === 'stockout').length
    const totalReorderUnits = active.reduce((sum, a) => sum + a.recommended_quantity, 0)

    return {
      totalActive,
      criticalCount,
      reorderCount,
      totalReorderUnits
    }
  }, [parsedAlerts])

  // Recommended Reorder list (active alerts that require ordering)
  const reorderRecommendations = useMemo(() => {
    return parsedAlerts.filter((a) => !a.resolved && a.recommended_quantity > 0)
  }, [parsedAlerts])

  // Run alert calculation engine
  async function handleRecalculate() {
    setPending(true)
    setErrorMsg(null)
    setSuccessMsg(null)

    const result = await calculateAndStoreAlerts()

    if (result.error) {
      showToast(result.error, true)
      setPending(false)
    } else {
      showToast(
        `Alerts updated! Analyzed ${result.analyzedCount} products. ${result.insertedCount} new alerts, ${result.resolvedCount} resolved.`
      )
      window.location.reload()
    }
  }

  // Resolve trigger
  async function handleResolve(alertId: string) {
    setPending(true)
    setErrorMsg(null)

    const result = await resolveAlert(alertId)

    if (result.error) {
      showToast(result.error, true)
      setPending(false)
    } else {
      showToast('Alert resolved successfully.')
      window.location.reload()
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Smart Inventory Alerts</h2>
          <p className="text-gray-500 text-sm mt-1">
            Automated stock alerts and recommended reorder quantities based on current stock, demand, and lead time.
          </p>
        </div>
        <button
          onClick={handleRecalculate}
          disabled={pending}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {pending ? 'Analyzing...' : 'Recalculate Alerts'}
        </button>
      </div>

      {/* Messages toasts */}
      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-red-500 hover:text-red-700">✕</button>
        </div>
      )}
      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-lg text-sm flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-700">✕</button>
        </div>
      )}

      {/* Statistics summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <span className="text-gray-500 text-sm font-medium">Active Alerts</span>
          <span className="block text-3xl font-bold text-gray-900 mt-2">{stats.totalActive}</span>
        </div>
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <span className="text-gray-500 text-sm font-medium">Critical Alerts</span>
          <span className="block text-3xl font-bold text-red-600 mt-2">{stats.criticalCount}</span>
        </div>
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <span className="text-gray-500 text-sm font-medium">Products Needing Reorder</span>
          <span className="block text-3xl font-bold text-amber-600 mt-2">{stats.reorderCount}</span>
        </div>
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <span className="text-gray-500 text-sm font-medium">Estimated Reorder Units</span>
          <span className="block text-3xl font-bold text-blue-600 mt-2">{stats.totalReorderUnits}</span>
        </div>
      </div>

      {/* Filters and search section */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row gap-4">
        {/* Search */}
        <div className="flex-1 relative">
          <input
            type="text"
            placeholder="Search by product name..."
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

        {/* Priority Filter */}
        <div className="w-full md:w-44">
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
          >
            <option value="all">All Priorities</option>
            <option value="critical">🔴 Critical</option>
            <option value="warning">🟠 Warning</option>
            <option value="info">🔵 Info</option>
          </select>
        </div>

        {/* Type Filter */}
        <div className="w-full md:w-44">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
          >
            <option value="all">All Types</option>
            <option value="stockout">Stockout Alerts</option>
            <option value="reorder">Reorder Alerts</option>
            <option value="overstock">Overstock Alerts</option>
          </select>
        </div>

        {/* Status Filter */}
        <div className="w-full md:w-44">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
          >
            <option value="active">Active Alerts</option>
            <option value="resolved">Resolved Alerts</option>
            <option value="all">All Statuses</option>
          </select>
        </div>
      </div>

      {/* Main Alerts List Table */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
          <h3 className="text-md font-bold text-gray-900">Active Alert Logs</h3>
        </div>
        {filteredAlerts.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">
            No alerts logged matching the selected filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Priority</th>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Product Name</th>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Alert Type</th>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Details</th>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Reorder Qty</th>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Timestamp</th>
                  <th scope="col" className="relative px-6 py-3.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredAlerts.map((a) => {
                  const severityBadge =
                    a.severity === 'critical' ? 'bg-red-100 text-red-700 border-red-200 font-bold' :
                    a.severity === 'medium' ? 'bg-amber-100 text-amber-700 border-amber-200 font-bold' :
                    'bg-blue-100 text-blue-700 border-blue-200 font-bold'

                  const severityLabel =
                    a.severity === 'critical' ? '🔴 Critical' :
                    a.severity === 'medium' ? '🟠 Warning' :
                    '🔵 Info'

                  let displayMessage = a.message
                  let detailInfo: AlertDetailInfo | null = null
                  try {
                    const parsed = JSON.parse(a.message)
                    if (parsed && typeof parsed === 'object' && parsed.reason) {
                      displayMessage = parsed.reason
                      detailInfo = parsed as AlertDetailInfo
                    }
                  } catch {
                    // fallback
                  }

                  return (
                    <tr key={a.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${severityBadge}`}>
                          {severityLabel}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {a.products?.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                        {a.alert_type}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700 max-w-sm">
                        <div className="line-clamp-2 font-medium">{displayMessage}</div>
                        <div className="text-[10px] text-gray-400 mt-1.5 flex flex-wrap gap-x-2 gap-y-1">
                          <span>Stock: {detailInfo ? detailInfo.currentStock : (a.products?.current_stock ?? 0)}</span>
                          {detailInfo && (detailInfo.onOrderStock ?? 0) > 0 && (
                            <><span>•</span><span className="text-blue-500">On Order: +{detailInfo.onOrderStock}</span></>
                          )}
                          <span>•</span>
                          <span>Demand: {detailInfo ? detailInfo.avgDailyDemand.toFixed(2) : a.avgDailyDemand.toFixed(2)}/day</span>
                          <span>•</span>
                          <span>Lead Time: {detailInfo ? detailInfo.leadTimeDays : (a.products?.supplier_lead_time_days ?? 0)} days</span>
                          {detailInfo && detailInfo.shelfLifeDays && (
                            <>
                              <span>•</span>
                              <span>Shelf Life: {detailInfo.shelfLifeDays} days</span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                        {a.recommended_quantity > 0 ? `${a.recommended_quantity} units` : '--'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-400">
                        {formatDateTime(a.created_at)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        {!a.resolved && (
                          <button
                            onClick={() => handleResolve(a.id)}
                            disabled={pending}
                            className="text-blue-600 hover:text-blue-900 disabled:opacity-50"
                          >
                            Resolve
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reorder Recommendations section */}
      {statusFilter === 'active' && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
            <h3 className="text-md font-bold text-gray-900">Recommended Reorder Purchase Plans</h3>
          </div>
          {reorderRecommendations.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">
              All product stock levels cover forecasted lead times. No reorders needed currently.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase">
                  <tr>
                    <th scope="col" className="px-6 py-3.5 text-left">Product</th>
                    <th scope="col" className="px-6 py-3.5 text-left">Current Stock</th>
                    <th scope="col" className="px-6 py-3.5 text-left">Avg Daily Demand</th>
                    <th scope="col" className="px-6 py-3.5 text-left">Supplier Lead Time</th>
                    <th scope="col" className="px-6 py-3.5 text-left">Shelf Life</th>
                    <th scope="col" className="px-6 py-3.5 text-left">Expected Demand</th>
                    <th scope="col" className="px-6 py-3.5 text-left">Safety Stock</th>
                    <th scope="col" className="px-6 py-3.5 text-left text-blue-600 font-bold">Recommended Order</th>
                    <th scope="col" className="px-6 py-3.5 text-left">Trigger Reason</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200 text-gray-900">
                  {reorderRecommendations.map((r) => {
                    let displayMessage = r.message
                    let detailInfo: AlertDetailInfo | null = null
                    try {
                      const parsed = JSON.parse(r.message)
                      if (parsed && typeof parsed === 'object' && parsed.reason) {
                        displayMessage = parsed.reason
                        detailInfo = parsed as AlertDetailInfo
                      }
                    } catch {
                      // fallback
                    }

                    const leadTime = detailInfo ? detailInfo.leadTimeDays : (r.products?.supplier_lead_time_days ?? 0)
                    const shelfLife = detailInfo ? detailInfo.shelfLifeDays : (r.products?.shelf_life_days ?? null)
                    const safetyStockVal = detailInfo ? detailInfo.safetyStock : 0
                    const expectedDemandVal = detailInfo ? detailInfo.expectedDemand : 0

                    return (
                      <tr key={r.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-6 py-4 font-medium">{r.products?.name}</td>
                        <td className="px-6 py-4">{detailInfo ? detailInfo.currentStock : r.products?.current_stock} units</td>
                        <td className="px-6 py-4">{(detailInfo ? detailInfo.avgDailyDemand : r.avgDailyDemand).toFixed(2)} units/day</td>
                        <td className="px-6 py-4">{leadTime} days</td>
                        <td className="px-6 py-4">{shelfLife ? `${shelfLife} days` : 'N/A'}</td>
                        <td className="px-6 py-4">{detailInfo ? `${expectedDemandVal} units` : '--'}</td>
                        <td className="px-6 py-4">{detailInfo ? `${safetyStockVal} units` : '--'}</td>
                        <td className="px-6 py-4 font-bold text-blue-600">{r.recommended_quantity} units</td>
                        <td className="px-6 py-4 text-xs text-gray-500 max-w-xs">{displayMessage}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
