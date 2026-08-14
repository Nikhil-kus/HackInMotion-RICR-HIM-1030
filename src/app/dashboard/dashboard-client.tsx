'use client'

import React, { useState, useTransition, useMemo } from 'react'
import Link from 'next/link'
import { fetchDashboardAnalytics, DashboardAnalyticsData } from './actions'
import { resolveAlert } from '@/app/alerts/actions'
import SalesTrendChart from './sales-trend-chart'

interface DashboardClientProps {
  initialData: DashboardAnalyticsData
  initialDays: number
}

export default function DashboardClient({ initialData, initialDays }: DashboardClientProps) {
  const [data, setData] = useState<DashboardAnalyticsData>(initialData)
  const [days, setDays] = useState<number>(initialDays)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleRangeChange = (newDays: number) => {
    if (newDays === days || isPending) return
    setError(null)
    setDays(newDays)
    startTransition(async () => {
      const res = await fetchDashboardAnalytics(newDays)
      if (res.error) {
        setError(res.error)
      } else if (res.data) {
        setData(res.data)
      }
    })
  }

  const handleResolveAlert = async (alertId: string) => {
    const confirm = window.confirm('यह alert resolve करें?')
    if (!confirm) return
    const result = await resolveAlert(alertId)
    if (result.error) {
      alert(result.error)
    } else {
      const res = await fetchDashboardAnalytics(days)
      if (res.data) setData(res.data)
    }
  }

  const {
    kpis,
    healthDistribution,
    salesAnalytics,
    topProducts,
    slowProducts,
    forecastInsights,
    needsAttention,
    purchasing,
    expiryRisks,
    aiInsights,
  } = data

  // ── Today's stats: use the last date key in the trend array — this is the
  // same UTC date key the server computed when building the trend map, so the
  // lookup is guaranteed to match regardless of the client's local timezone.
  const todayStats = useMemo(() => {
    if (salesAnalytics.trend.length === 0) return { revenue: 0, units: 0 }
    // The trend array is sorted chronologically (oldest → newest) by the server.
    // The last entry is always the server's "today" in UTC.
    const todayEntry = salesAnalytics.trend[salesAnalytics.trend.length - 1]
    return {
      revenue: todayEntry.revenue,
      units: todayEntry.quantity,
    }
  }, [salesAnalytics.trend])

  // ── Average bill value: today's revenue / today's transaction proxy
  // We don't have per-transaction count for today in the existing data shape,
  // so we show revenue and units only — no fabricated transaction count.

  // ── Stock health helpers
  const totalHealthCount =
    healthDistribution.healthy +
    healthDistribution.low +
    healthDistribution.critical +
    healthDistribution.outOfStock +
    healthDistribution.overstock

  const getPercent = (count: number) =>
    totalHealthCount === 0 ? 0 : Math.round((count / totalHealthCount) * 100)

  // ── Kirana action items — priority ordered from needsAttention
  const actionItems = useMemo(() => {
    return needsAttention.slice(0, 8).map((alert) => {
      let emoji = '🟡'
      let actionText = ''
      if (alert.alert_type === 'stockout' || alert.severity === 'critical') {
        emoji = '🔴'
        actionText = `Stock सिर्फ ${alert.current_stock} है। अभी मंगवाएं!`
        if (alert.recommended_quantity > 0) {
          actionText = `Stock सिर्फ ${alert.current_stock} है। ${alert.recommended_quantity} units मंगवाने की सलाह।`
        }
      } else if (alert.alert_type === 'overstock') {
        emoji = '🔵'
        actionText = `बहुत ज़्यादा Stock है। अभी Order बंद रखें।`
      } else if (alert.severity === 'high') {
        emoji = '🟠'
        actionText = `Stock कम हो रहा है। ${alert.recommended_quantity > 0 ? `${alert.recommended_quantity} units मंगवाएं।` : 'Stock check करें।'}`
      } else {
        emoji = '🟡'
        actionText = `Stock थोड़ा कम है। ${alert.recommended_quantity > 0 ? `${alert.recommended_quantity} units मंगवाने की सलाह।` : 'नज़र रखें।'}`
      }
      return { ...alert, emoji, actionText }
    })
  }, [needsAttention])

  // ── Reorder items from needsAttention (type reorder or stockout with recommended_quantity > 0)
  const reorderItems = useMemo(() =>
    needsAttention.filter(
      (a) => (a.alert_type === 'reorder' || a.alert_type === 'stockout') && a.recommended_quantity > 0
    ).slice(0, 8),
    [needsAttention]
  )

  return (
    <div className="space-y-6">

      {/* ── KIRANA HEADER ────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Namaste! 👋 आज का Business</h2>
          <p className="text-gray-500 text-sm mt-1">
            Apni dukaan ka stock, bikri aur agla order ek nazar mein dekhein.
          </p>
        </div>

        {/* Date Filter Tabs */}
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50 self-stretch md:self-auto">
          {([7, 30, 90] as const).map((d) => (
            <button
              key={d}
              onClick={() => handleRangeChange(d)}
              disabled={isPending}
              className={`flex-1 md:flex-initial px-4 py-2 text-xs font-semibold rounded-md transition-all ${
                days === d
                  ? 'bg-white text-blue-600 shadow-sm border border-gray-150'
                  : 'text-gray-500 hover:text-gray-800 disabled:opacity-50'
              }`}
            >
              {d} दिन
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Main content with loading opacity */}
      <div className={`space-y-6 transition-opacity duration-200 ${isPending ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>

        {/* ── SECTION: Kirana KPI Cards ─────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">

          {/* Card 1: Aaj ki Bikri */}
          <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm">
            <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider block">💰 आज की Sale</span>
            <span className="text-2xl font-bold text-emerald-700 mt-2 block">
              ₹{todayStats.revenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
            <span className="text-xs text-gray-400 mt-1 block">{todayStats.units} units आज</span>
          </div>

          {/* Card 2: Aaj Bika */}
          <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm">
            <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider block">🛒 आज Bika</span>
            <span className="text-2xl font-bold text-gray-900 mt-2 block">{todayStats.units}</span>
            <span className="text-xs text-gray-400 mt-1 block">units sold आज</span>
          </div>

          {/* Card 3: Stock ki Value */}
          <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm">
            <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider block">📦 Stock की Value</span>
            <span className="text-2xl font-bold text-blue-700 mt-2 block">
              ₹{kpis.inventoryValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
            <span className="text-xs text-gray-400 mt-1 block">{kpis.inventoryUnits} units total</span>
          </div>

          {/* Card 4: Stock Kam Hai */}
          <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm">
            <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider block">⚠️ Stock कम है</span>
            <span className="text-2xl font-bold text-amber-700 mt-2 block">
              {healthDistribution.low + healthDistribution.critical + healthDistribution.outOfStock}
            </span>
            <span className="text-xs text-gray-400 mt-1 block">
              {healthDistribution.outOfStock} Khatam · {healthDistribution.critical} Critical
            </span>
          </div>

          {/* Card 5: Maal Mangwana Hai */}
          <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm">
            <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider block">🛍️ Maal मंगवाना है</span>
            <span className="text-2xl font-bold text-purple-700 mt-2 block">
              {reorderItems.length}
            </span>
            <span className="text-xs text-gray-400 mt-1 block">
              ₹{kpis.reorderValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })} estimated
            </span>
          </div>

          {/* Card 6: Pending Purchase */}
          <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm">
            <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider block">💸 Pending Purchase</span>
            <span className="text-2xl font-bold text-orange-700 mt-2 block">
              ₹{purchasing.pendingValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
            <span className="text-xs text-gray-400 mt-1 block">{purchasing.pendingCount} orders pending</span>
          </div>
        </div>

        {/* ── SECTION: Aaj Kya Karna Hai? ──────────────────────────────── */}
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-md font-bold text-amber-900">🔔 आज क्या करना है?</h3>
            <Link href="/alerts" className="text-xs text-amber-700 font-semibold hover:underline">
              सारे Alerts →
            </Link>
          </div>

          {actionItems.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-emerald-700 font-semibold text-sm">🎉 आज कोई urgent action नहीं है।</p>
              <p className="text-xs text-gray-500 mt-1">सब ठीक है! Stock levels normal हैं।</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {actionItems.map((item) => (
                <li
                  key={item.id}
                  className="bg-white rounded-lg px-4 py-3 flex items-start justify-between gap-3 border border-amber-100 shadow-sm"
                >
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="text-base shrink-0 mt-0.5">{item.emoji}</span>
                    <div className="min-w-0">
                      <span className="font-bold text-gray-900 text-sm">{item.product_name}</span>
                      <span className="text-xs text-gray-500 block mt-0.5">{item.actionText}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.recommended_quantity > 0 && item.alert_type !== 'overstock' && (
                      <Link
                        href="/purchases"
                        className="px-2.5 py-1 text-[10px] font-bold text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                      >
                        Order करें
                      </Link>
                    )}
                    <button
                      onClick={() => handleResolveAlert(item.id)}
                      className="px-2.5 py-1 text-[10px] font-semibold text-gray-600 border border-gray-200 bg-white hover:bg-gray-50 rounded transition-colors"
                    >
                      Resolve करें
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── SECTION: आपका Stock (Health Distribution) ───────────────── */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-md font-bold text-gray-950">📦 आपका Stock</h3>
            <span className="text-xs font-medium text-gray-400">Total: {totalHealthCount} products</span>
          </div>

          {/* Segmented Distribution Bar */}
          <div className="h-4 w-full rounded-full bg-gray-100 overflow-hidden flex mb-5">
            <div style={{ width: `${getPercent(healthDistribution.healthy)}%` }} title={`Stock ठीक है: ${healthDistribution.healthy}`} className="bg-emerald-500 h-full transition-all duration-300" />
            <div style={{ width: `${getPercent(healthDistribution.low)}%` }} title={`Stock कम है: ${healthDistribution.low}`} className="bg-amber-400 h-full transition-all duration-300" />
            <div style={{ width: `${getPercent(healthDistribution.critical)}%` }} title={`Critical: ${healthDistribution.critical}`} className="bg-orange-500 h-full transition-all duration-300" />
            <div style={{ width: `${getPercent(healthDistribution.outOfStock)}%` }} title={`Stock Khatam: ${healthDistribution.outOfStock}`} className="bg-red-500 h-full transition-all duration-300" />
            <div style={{ width: `${getPercent(healthDistribution.overstock)}%` }} title={`Zyada Stock: ${healthDistribution.overstock}`} className="bg-blue-400 h-full transition-all duration-300" />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {[
              { dot: 'bg-emerald-500', label: 'Stock ठीक है', count: healthDistribution.healthy },
              { dot: 'bg-amber-400', label: 'Stock कम है', count: healthDistribution.low },
              { dot: 'bg-orange-500', label: 'Critical', count: healthDistribution.critical },
              { dot: 'bg-red-500', label: 'Stock Khatam', count: healthDistribution.outOfStock },
              { dot: 'bg-blue-400', label: 'ज़्यादा Stock', count: healthDistribution.overstock },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${item.dot} shrink-0`} />
                <div>
                  <span className="block text-xs font-semibold text-gray-500">{item.label}</span>
                  <span className="text-sm font-bold text-gray-900">
                    {item.count} ({getPercent(item.count)}%)
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── SECTION: Aaj ki Bikri — Daily Sales Focus ────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3">
            <SalesTrendChart data={salesAnalytics.trend} />
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col justify-between">
            <div>
              <h3 className="text-sm font-bold text-gray-950 uppercase tracking-wider mb-4">💰 आज की Sale</h3>
              <div className="space-y-3">
                <div className="bg-emerald-50 p-4 rounded-lg border border-emerald-100">
                  <span className="block text-xs font-semibold text-emerald-700">आज का Revenue</span>
                  <span className="text-2xl font-bold text-emerald-700 mt-1 block">
                    ₹{todayStats.revenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <span className="block text-xs font-semibold text-gray-500">आज Bika</span>
                  <span className="text-xl font-bold text-gray-900 mt-1 block">{todayStats.units} units</span>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <span className="block text-xs font-semibold text-gray-500">Avg Daily ({days}d)</span>
                  <span className="text-lg font-bold text-blue-600 mt-1 block">
                    {salesAnalytics.avgDailyVelocity.toFixed(1)} <span className="text-xs text-gray-400 font-normal">units/दिन</span>
                  </span>
                </div>
                {salesAnalytics.peakSalesDay && (
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <span className="block text-xs font-semibold text-gray-500">सबसे अच्छा दिन</span>
                    <span className="text-lg font-bold text-gray-800 mt-1 block">{salesAnalytics.peakSalesDay.quantity} units</span>
                    <span className="text-[10px] text-gray-400 block mt-0.5">
                      {new Date(salesAnalytics.peakSalesDay.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="border-t border-gray-100 pt-4 mt-4">
              <Link href="/sales" className="w-full inline-flex justify-center items-center px-4 py-2 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 transition-colors shadow-sm">
                Sales Manage करें
              </Link>
            </div>
          </div>
        </div>

        {/* ── SECTION: Tez Bikne Wale & Dheere Bikne Wale ─────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Top / Tez Bikne Wale */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <h3 className="text-md font-bold text-gray-950 mb-4">🔥 तेज़ बिकने वाले Samaan</h3>
            {topProducts.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-xs">इस period में कोई Sales नहीं है।</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs text-gray-700">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-400 uppercase font-semibold">
                      <th className="py-2 text-left">Product</th>
                      <th className="py-2 text-center">Units Bika</th>
                      <th className="py-2 text-center">Stock</th>
                      <th className="py-2 text-right">Demand</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 font-medium">
                    {topProducts.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50/50">
                        <td className="py-3 font-semibold text-gray-900">{p.name}</td>
                        <td className="py-3 text-center font-bold text-gray-900">{p.salesVolume}</td>
                        <td className="py-3 text-center">
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            p.status === 'out_of_stock' ? 'bg-red-100 text-red-800' :
                            p.status === 'critical' ? 'bg-orange-100 text-orange-800' :
                            p.status === 'low' ? 'bg-amber-100 text-amber-800' :
                            'bg-emerald-100 text-emerald-800'
                          }`}>
                            {p.status === 'out_of_stock' ? 'Stock Khatam' :
                             p.status === 'critical' ? 'Critical' :
                             p.status === 'low' ? 'Stock कम' :
                             `${p.current_stock}`}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            p.trend === 'Increasing' ? 'bg-emerald-100 text-emerald-800' :
                            p.trend === 'Decreasing' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {p.trend === 'Increasing' ? '📈 Demand बढ़ रही है' :
                             p.trend === 'Decreasing' ? '📉 Demand कम हो रही है' :
                             '➡️ Demand Stable है'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Slow / Dheere Bikne Wale */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <h3 className="text-md font-bold text-gray-950 mb-1">🐢 धीरे बिकने वाले Samaan</h3>
            <p className="text-xs text-gray-400 mb-4">जहाँ पैसा Stock में अटका हुआ है</p>
            {slowProducts.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-xs">कोई products नहीं हैं।</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs text-gray-700">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-400 uppercase font-semibold">
                      <th className="py-2 text-left">Product</th>
                      <th className="py-2 text-center">Units Bika</th>
                      <th className="py-2 text-center">Stock</th>
                      <th className="py-2 text-right">Capital अटका</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 font-medium">
                    {slowProducts.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50/50">
                        <td className="py-3 font-semibold text-gray-900">{p.name}</td>
                        <td className="py-3 text-center">{p.salesVolume}</td>
                        <td className="py-3 text-center">{p.current_stock} units</td>
                        <td className="py-3 text-right text-amber-700 font-semibold">
                          ₹{p.capitalAtRisk.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── SECTION: Kya Mangwana Hai? (Purchase Intelligence) ───────── */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="bg-indigo-50 px-6 py-4 border-b border-indigo-100 flex justify-between items-center">
            <div>
              <h3 className="text-md font-bold text-indigo-900">🛍️ क्या मंगवाना है?</h3>
              <p className="text-xs text-indigo-600 mt-0.5">Phase 7 reorder recommendations — अभी Order करें</p>
            </div>
            <Link href="/purchases" className="text-xs text-indigo-700 font-semibold hover:underline">
              Purchases →
            </Link>
          </div>

          {reorderItems.length === 0 ? (
            <div className="p-10 text-center text-gray-400 text-sm">
              🎉 अभी कोई reorder नहीं करना है। सब Stock ठीक है!
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-xs">
                <thead className="bg-gray-50 text-gray-500 font-semibold uppercase">
                  <tr>
                    <th className="px-6 py-3 text-left">Product</th>
                    <th className="px-6 py-3 text-center">Current Stock</th>
                    <th className="px-6 py-3 text-center">कितना मंगवाएं</th>
                    <th className="px-6 py-3 text-left">Alert Type</th>
                    <th className="px-6 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200 text-gray-700 font-medium">
                  {reorderItems.map((alert) => (
                    <tr key={alert.id} className="hover:bg-gray-50/50">
                      <td className="px-6 py-4 font-bold text-gray-900">{alert.product_name}</td>
                      <td className="px-6 py-4 text-center">{alert.current_stock} units</td>
                      <td className="px-6 py-4 text-center font-bold text-blue-700">
                        {alert.recommended_quantity} units मंगवाएं
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold border ${
                          alert.alert_type === 'stockout'
                            ? 'bg-red-100 text-red-800 border-red-200'
                            : 'bg-amber-100 text-amber-800 border-amber-200'
                        }`}>
                          {alert.alert_type === 'stockout' ? '🔴 Stock Khatam' : '🟡 Reorder'}                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          href="/purchases"
                          className="inline-flex items-center px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold rounded transition-colors"
                        >
                          Order करें
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── SECTION: Aane Wali Demand (Forecast Insights) ────────────── */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-md font-bold text-gray-950 mb-4">📈 आने वाली Demand</h3>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

            {/* Trend counts */}
            <div className="space-y-3">
              <div className="border border-emerald-100 p-3.5 rounded-lg bg-emerald-50 flex justify-between items-center">
                <span className="text-xs font-semibold text-emerald-800">📈 Demand बढ़ रही है</span>
                <span className="text-lg font-bold text-emerald-700">{forecastInsights.trendCounts.Increasing}</span>
              </div>
              <div className="border border-gray-100 p-3.5 rounded-lg bg-gray-50 flex justify-between items-center">
                <span className="text-xs font-semibold text-gray-600">➡️ Demand Stable है</span>
                <span className="text-lg font-bold text-gray-700">{forecastInsights.trendCounts.Stable}</span>
              </div>
              <div className="border border-red-100 p-3.5 rounded-lg bg-red-50 flex justify-between items-center">
                <span className="text-xs font-semibold text-red-800">📉 Demand कम हो रही है</span>
                <span className="text-lg font-bold text-red-700">{forecastInsights.trendCounts.Decreasing}</span>
              </div>
              <Link href="/forecasts" className="block text-center text-xs text-blue-600 font-semibold hover:underline pt-1">
                Forecast Details →
              </Link>
            </div>

            {/* Growth products */}
            <div className="lg:col-span-3">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Top Growing Products (High Confidence)</h4>
              {forecastInsights.growthProducts.length === 0 ? (
                <div className="text-center py-6 text-gray-400 text-xs bg-gray-50 border border-gray-100 rounded-lg">
                  अभी कोई product upward trend में नहीं है।
                </div>
              ) : (
                <div className="overflow-x-auto border border-gray-100 rounded-lg">
                  <table className="min-w-full text-xs text-gray-700">
                    <thead className="bg-gray-50 text-gray-500 font-semibold uppercase">
                      <tr>
                        <th className="px-4 py-2.5 text-left">Product</th>
                        <th className="px-4 py-2.5 text-center">Est. Velocity</th>
                        <th className="px-4 py-2.5 text-center">Confidence</th>
                        <th className="px-4 py-2.5 text-right">Lead Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 font-medium">
                      {forecastInsights.growthProducts.map((p) => (
                        <tr key={p.id} className="hover:bg-gray-50/50">
                          <td className="px-4 py-3 font-semibold text-gray-900">{p.name}</td>
                          <td className="px-4 py-3 text-center font-semibold text-purple-700">
                            {(p.salesVolume / days * 1.2).toFixed(1)} units/din (est)
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">
                              {p.confidenceScore.toFixed(0)}% Conf.
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-500">{p.supplier_lead_time_days} दिन</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── SECTION: Expiry / Overstock Risk & Purchasing Pipeline ───── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Purchasing Pipeline */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col justify-between">
            <div>
              <h3 className="text-md font-bold text-gray-950 mb-4">💸 Purchase Pipeline</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                  <span className="text-xs font-semibold text-gray-500">Draft Orders</span>
                  <span className="text-lg font-bold text-gray-700">{purchasing.draftCount}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-blue-50/30 border border-blue-50 rounded-lg">
                  <span className="text-xs font-semibold text-blue-800">Pending Orders</span>
                  <span className="text-lg font-bold text-blue-700">{purchasing.pendingCount}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-green-50/20 border border-green-50 rounded-lg">
                  <span className="text-xs font-semibold text-green-800">Pending Value</span>
                  <span className="text-md font-bold text-green-700">
                    ₹{purchasing.pendingValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>
            <div className="border-t border-gray-100 pt-4 mt-6">
              <Link href="/purchases" className="w-full inline-flex justify-center items-center px-4 py-2 border border-transparent rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-sm">
                Purchases Manager
              </Link>            </div>
          </div>

          {/* Expiry / Overstock Risk */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm lg:col-span-2">
            <h3 className="text-md font-bold text-gray-950 mb-1">⏳ Expiry / Overstock Risk</h3>
            <p className="text-xs text-gray-400 mb-4">जहाँ Stock shelf life से ज़्यादा है — waste होने का डर</p>
            {expiryRisks.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-xs bg-gray-50 border border-gray-100 rounded-lg">
                अभी कोई Expiry/Overstock risk नहीं है।
              </div>
            ) : (
              <div className="overflow-x-auto border border-gray-100 rounded-lg">
                <table className="min-w-full text-xs text-gray-700">
                  <thead className="bg-gray-50 text-gray-500 font-semibold uppercase">
                    <tr>
                      <th className="px-4 py-2.5 text-left">Product</th>
                      <th className="px-4 py-2.5 text-center">Stock</th>
                      <th className="px-4 py-2.5 text-center">Shelf Life</th>
                      <th className="px-4 py-2.5 text-center">Days of Stock</th>
                      <th className="px-4 py-2.5 text-right">Capital at Risk</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 font-medium">
                    {expiryRisks.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50/50">
                        <td className="px-4 py-3 font-semibold text-gray-900">{p.name}</td>
                        <td className="px-4 py-3 text-center">{p.current_stock} units</td>
                        <td className="px-4 py-3 text-center text-amber-700 font-bold">{p.shelf_life_days} दिन</td>
                        <td className="px-4 py-3 text-center text-red-600 font-bold">{p.daysOfStock.toFixed(0)} दिन</td>
                        <td className="px-4 py-3 text-right text-red-700 font-bold">
                          ₹{p.capitalAtRisk.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── SECTION: StockMind ki Salah ───────────────────────────────── */}
        <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-blue-600">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 21l-.813-5.096L3 15l5.096-.813L9 9l.813 5.096L15 15l-5.096.813ZM19.071 5.929 18 10l-1.071-4.071L12.858 5 16.93 3.929 18 0l1.071 3.929 4.072 1.071-4.072 1.072Z" />
            </svg>
            <h3 className="text-md font-bold text-blue-900">🧠 StockMind की सलाह</h3>
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {aiInsights.map((insight, idx) => (
              <li key={idx} className="bg-white/80 border border-blue-50/50 rounded-lg p-3 text-xs font-semibold text-blue-950 flex items-start gap-2.5">
                <span className="inline-flex items-center justify-center bg-blue-100 text-blue-800 rounded-full w-5 h-5 text-[10px] font-bold shrink-0 mt-0.5">
                  {idx + 1}
                </span>
                <span className="leading-relaxed">{insight}</span>
              </li>
            ))}
          </ul>
        </div>

      </div>
    </div>
  )
}
