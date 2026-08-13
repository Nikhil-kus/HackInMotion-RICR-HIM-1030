'use client'

import React, { useState, useTransition } from 'react'
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
    const confirm = window.confirm('Are you sure you want to resolve this alert?')
    if (!confirm) return

    const result = await resolveAlert(alertId)
    if (result.error) {
      alert(result.error)
    } else {
      // Reload current metrics
      const res = await fetchDashboardAnalytics(days)
      if (res.data) {
        setData(res.data)
      }
    }
  }

  // Derived metrics for UI
  const { kpis, healthDistribution, salesAnalytics, topProducts, slowProducts, forecastInsights, needsAttention, purchasing, expiryRisks, aiInsights } = data

  const totalHealthCount =
    healthDistribution.healthy +
    healthDistribution.low +
    healthDistribution.critical +
    healthDistribution.outOfStock +
    healthDistribution.overstock

  const getPercent = (count: number) => {
    if (totalHealthCount === 0) return 0
    return Math.round((count / totalHealthCount) * 100)
  }

  return (
    <div className="space-y-6">
      {/* Header & Date Picker */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Analytics & BI Dashboard</h2>
          <p className="text-gray-500 text-sm mt-1 font-normal">
            Real-time stock health, sales velocity, expiry risks, and AI recommendations.
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
              {d} Days
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Main Grid Wrapper with loading opacity */}
      <div className={`space-y-6 transition-opacity duration-200 ${isPending ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
        
        {/* SECTION H: StockMind AI Natural Language Insights (Highlighted at top for primary actionability) */}
        <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-blue-600">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 21l-.813-5.096L3 15l5.096-.813L9 9l.813 5.096L15 15l-5.096.813ZM19.071 5.929 18 10l-1.071-4.071L12.858 5 16.93 3.929 18 0l1.071 3.929 4.072 1.071-4.072 1.072Z" />
            </svg>
            <h3 className="text-md font-bold text-blue-900">StockMind AI Insights</h3>
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

        {/* SECTION A: Executive Summary KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm">
            <span className="text-gray-400 text-xs font-medium uppercase tracking-wider block">Total Products</span>
            <span className="text-2xl font-bold text-gray-900 mt-2 block">{kpis.totalProducts}</span>
          </div>

          <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm">
            <span className="text-gray-400 text-xs font-medium uppercase tracking-wider block">Inventory Units</span>
            <span className="text-2xl font-bold text-gray-900 mt-2 block">{kpis.inventoryUnits}</span>
          </div>

          <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm">
            <span className="text-gray-400 text-xs font-medium uppercase tracking-wider block">Inventory Value</span>
            <span className="text-2xl font-bold text-green-700 mt-2 block">
              ₹{kpis.inventoryValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
          </div>

          <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm">
            <span className="text-gray-400 text-xs font-medium uppercase tracking-wider block">Sales ({days}d)</span>
            <span className="text-xl font-bold text-gray-900 mt-2 block">
              {kpis.salesVolume} units
              <span className="text-xs text-blue-600 block font-bold mt-1">
                ₹{kpis.salesRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </span>
            </span>
          </div>

          <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm">
            <span className="text-gray-400 text-xs font-medium uppercase tracking-wider block">Forecast (7d)</span>
            <span className="text-2xl font-bold text-purple-700 mt-2 block">{kpis.forecastUnits7Days} <span className="text-[10px] text-gray-400 font-medium">units</span></span>
          </div>

          <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm">
            <span className="text-gray-400 text-xs font-medium uppercase tracking-wider block">Reorder Value</span>
            <span className="text-2xl font-bold text-amber-700 mt-2 block">
              ₹{kpis.reorderValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>

        {/* SECTION B: Inventory Health Visual Distribution */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-md font-bold text-gray-950">Inventory Stock Health</h3>
            <span className="text-xs font-medium text-gray-400">Total Analyzed: {totalHealthCount} Products</span>
          </div>

          {/* Segmented Distribution Bar */}
          <div className="h-4 w-full rounded-full bg-gray-100 overflow-hidden flex mb-6">
            <div
              style={{ width: `${getPercent(healthDistribution.healthy)}%` }}
              title={`Healthy: ${healthDistribution.healthy}`}
              className="bg-emerald-500 h-full transition-all duration-300"
            />
            <div
              style={{ width: `${getPercent(healthDistribution.low)}%` }}
              title={`Low Stock: ${healthDistribution.low}`}
              className="bg-amber-400 h-full transition-all duration-300"
            />
            <div
              style={{ width: `${getPercent(healthDistribution.critical)}%` }}
              title={`Critical: ${healthDistribution.critical}`}
              className="bg-orange-500 h-full transition-all duration-300"
            />
            <div
              style={{ width: `${getPercent(healthDistribution.outOfStock)}%` }}
              title={`Out of Stock: ${healthDistribution.outOfStock}`}
              className="bg-red-500 h-full transition-all duration-300"
            />
            <div
              style={{ width: `${getPercent(healthDistribution.overstock)}%` }}
              title={`Overstock: ${healthDistribution.overstock}`}
              className="bg-blue-400 h-full transition-all duration-300"
            />
          </div>

          {/* Distribution Stats Table */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <div className="flex items-center gap-3">
              <span className="w-3 h-3 rounded-full bg-emerald-500 shrink-0" />
              <div>
                <span className="block text-xs font-semibold text-gray-500">Healthy</span>
                <span className="text-sm font-bold text-gray-900">
                  {healthDistribution.healthy} ({getPercent(healthDistribution.healthy)}%)
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-3 h-3 rounded-full bg-amber-400 shrink-0" />
              <div>
                <span className="block text-xs font-semibold text-gray-500">Low Stock</span>
                <span className="text-sm font-bold text-gray-900">
                  {healthDistribution.low} ({getPercent(healthDistribution.low)}%)
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-3 h-3 rounded-full bg-orange-500 shrink-0" />
              <div>
                <span className="block text-xs font-semibold text-gray-500">Critical</span>
                <span className="text-sm font-bold text-gray-900">
                  {healthDistribution.critical} ({getPercent(healthDistribution.critical)}%)
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-3 h-3 rounded-full bg-red-500 shrink-0" />
              <div>
                <span className="block text-xs font-semibold text-gray-500">Out of Stock</span>
                <span className="text-sm font-bold text-gray-900">
                  {healthDistribution.outOfStock} ({getPercent(healthDistribution.outOfStock)}%)
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-3 h-3 rounded-full bg-blue-400 shrink-0" />
              <div>
                <span className="block text-xs font-semibold text-gray-500">Overstock</span>
                <span className="text-sm font-bold text-gray-900">
                  {healthDistribution.overstock} ({getPercent(healthDistribution.overstock)}%)
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION C: Sales Analytics SVG Line Chart & Velocity Info */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3">
            <SalesTrendChart data={salesAnalytics.trend} />
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col justify-between">
            <div>
              <h3 className="text-sm font-bold text-gray-950 uppercase tracking-wider mb-4">Sales Velocity</h3>
              
              <div className="space-y-4">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <span className="block text-xs font-semibold text-gray-500">Avg. Daily Velocity</span>
                  <span className="text-2xl font-bold text-blue-600 mt-1 block">
                    {salesAnalytics.avgDailyVelocity.toFixed(1)} <span className="text-xs text-gray-400 font-medium">units/day</span>
                  </span>
                </div>

                <div className="bg-gray-50 p-4 rounded-lg">
                  <span className="block text-xs font-semibold text-gray-500">Peak Sales Volume</span>
                  <span className="text-xl font-bold text-gray-800 mt-1 block">
                    {salesAnalytics.peakSalesDay ? `${salesAnalytics.peakSalesDay.quantity} units` : '0 units'}
                  </span>
                  <span className="text-[10px] text-gray-400 font-medium block mt-0.5">
                    {salesAnalytics.peakSalesDay ? new Date(salesAnalytics.peakSalesDay.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : 'N/A'}
                  </span>
                </div>
              </div>
            </div>

            <div className="border-t border-gray-150 pt-4 mt-6">
              <Link href="/sales" className="w-full inline-flex justify-center items-center px-4 py-2 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 transition-colors shadow-sm">
                Manage & Import Sales
              </Link>
            </div>
          </div>
        </div>

        {/* SECTION D: Top 5 & Slow-Moving Products */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Products */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <h3 className="text-md font-bold text-gray-950 mb-4">Top 5 Products by Sales Volume</h3>
            {topProducts.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-xs">No sales registered in the selected timeframe.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs text-gray-700">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-400 uppercase font-semibold">
                      <th className="py-2 text-left">Product</th>
                      <th className="py-2 text-center">Units Sold</th>
                      <th className="py-2 text-right">Revenue</th>
                      <th className="py-2 text-right">Trend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 font-medium">
                    {topProducts.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50/50">
                        <td className="py-3 font-semibold text-gray-900">{p.name}</td>
                        <td className="py-3 text-center font-bold text-gray-900">{p.salesVolume}</td>
                        <td className="py-3 text-right text-green-700 font-bold">₹{p.salesRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                        <td className="py-3 text-right">
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            p.trend === 'Increasing' ? 'bg-emerald-100 text-emerald-800' :
                            p.trend === 'Decreasing' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {p.trend}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Slow-Moving Products */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <h3 className="text-md font-bold text-gray-950 mb-4">Slow-Moving / Low Sales Velocity</h3>
            {slowProducts.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-xs">No products registered.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs text-gray-700">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-400 uppercase font-semibold">
                      <th className="py-2 text-left">Product</th>
                      <th className="py-2 text-center">Units Sold ({days}d)</th>
                      <th className="py-2 className text-center">Stock</th>
                      <th className="py-2 text-right">Capital Tied Up</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 font-medium">
                    {slowProducts.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50/50">
                        <td className="py-3 font-semibold text-gray-900">{p.name}</td>
                        <td className="py-3 text-center">{p.salesVolume}</td>
                        <td className="py-3 text-center">{p.current_stock} units</td>
                        <td className="py-3 text-right text-gray-900 font-semibold">
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

        {/* SECTION E: Demand Forecast Insights */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-md font-bold text-gray-950 mb-4">Demand Forecasting Trajectories</h3>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            
            {/* Split counts */}
            <div className="space-y-3">
              <div className="border border-gray-100 p-3.5 rounded-lg bg-emerald-50/20 flex justify-between items-center">
                <span className="text-xs font-semibold text-emerald-800">Increasing Demand</span>
                <span className="text-lg font-bold text-emerald-700">{forecastInsights.trendCounts.Increasing}</span>
              </div>
              <div className="border border-gray-100 p-3.5 rounded-lg bg-gray-50 flex justify-between items-center">
                <span className="text-xs font-semibold text-gray-600">Stable Demand</span>
                <span className="text-lg font-bold text-gray-700">{forecastInsights.trendCounts.Stable}</span>
              </div>
              <div className="border border-gray-100 p-3.5 rounded-lg bg-red-50/20 flex justify-between items-center">
                <span className="text-xs font-semibold text-red-800">Decreasing Demand</span>
                <span className="text-lg font-bold text-red-700">{forecastInsights.trendCounts.Decreasing}</span>
              </div>
            </div>

            {/* Top 5 Growth list */}
            <div className="lg:col-span-3">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">High Confidence Demand Growth Products</h4>
              {forecastInsights.growthProducts.length === 0 ? (
                <div className="text-center py-6 text-gray-400 text-xs bg-gray-50 border border-gray-100 rounded-lg">
                  No products currently showing upward demand trajectory.
                </div>
              ) : (
                <div className="overflow-x-auto border border-gray-100 rounded-lg">
                  <table className="min-w-full text-xs text-gray-700">
                    <thead className="bg-gray-50 text-gray-500 font-semibold uppercase">
                      <tr>
                        <th className="px-4 py-2.5 text-left">Product</th>
                        <th className="px-4 py-2.5 text-center">Forecast Velocity</th>
                        <th className="px-4 py-2.5 text-center">Confidence Score</th>
                        <th className="px-4 py-2.5 text-right">Lead Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 font-medium">
                      {forecastInsights.growthProducts.map((p) => (
                        <tr key={p.id} className="hover:bg-gray-50/50">
                          <td className="px-4 py-3 font-semibold text-gray-900">{p.name}</td>
                          <td className="px-4 py-3 text-center font-semibold text-purple-700">{(p.salesVolume / days * 1.2).toFixed(1)} units/day (est)</td>
                          <td className="px-4 py-3 text-center">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">
                              {p.confidenceScore.toFixed(0)}% Conf.
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-500">{p.supplier_lead_time_days} days</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* SECTION F: Needs Attention (Smart Actions) */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <div>
              <h3 className="text-md font-bold text-gray-950">Needs Attention (Active Alerts)</h3>
              <p className="text-xs text-gray-400 mt-0.5">Critical reorder recommendations, stockouts, and risk factors</p>
            </div>
            <Link href="/alerts" className="text-xs text-blue-600 font-semibold hover:underline">
              Go to Alerts Manager →
            </Link>
          </div>
          {needsAttention.length === 0 ? (
            <div className="p-12 text-center text-gray-400 text-sm">
              All quiet! No active low stock, critical, or stockout alerts logged.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-xs">
                <thead className="bg-gray-50 text-gray-500 font-semibold uppercase">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left">Product</th>
                    <th scope="col" className="px-6 py-3 text-center">Type</th>
                    <th scope="col" className="px-6 py-3 text-center">Severity</th>
                    <th scope="col" className="px-6 py-3 text-center">Current Stock</th>
                    <th scope="col" className="px-6 py-3 text-center">Reorder Quantity</th>
                    <th scope="col" className="px-6 py-3 text-left">Recommendation Details</th>
                    <th scope="col" className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200 text-gray-700 font-medium">
                  {needsAttention.slice(0, 10).map((alert) => (
                    <tr key={alert.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4 font-bold text-gray-900">{alert.product_name}</td>
                      <td className="px-6 py-4 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${
                          alert.alert_type === 'stockout' ? 'bg-red-100 text-red-800 border-red-200' :
                          alert.alert_type === 'overstock' ? 'bg-blue-100 text-blue-800 border-blue-200' :
                          'bg-amber-100 text-amber-800 border-amber-200'
                        }`}>
                          {alert.alert_type}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                          alert.severity === 'critical' ? 'bg-red-200 text-red-900' :
                          alert.severity === 'high' ? 'bg-orange-100 text-orange-800' :
                          alert.severity === 'medium' ? 'bg-amber-100 text-amber-800' :
                          'bg-blue-50 text-blue-700'
                        }`}>
                          {alert.severity}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center font-bold">{alert.current_stock} units</td>
                      <td className="px-6 py-4 text-center font-bold text-blue-600">
                        {alert.recommended_quantity > 0 ? `${alert.recommended_quantity} units` : '0'}
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-500 max-w-sm truncate">{alert.reason}</td>
                      <td className="px-6 py-4 text-right space-x-2 shrink-0 whitespace-nowrap">
                        {alert.recommended_quantity > 0 && (
                          <Link href="/purchases" className="inline-flex items-center px-2.5 py-1 border border-transparent rounded text-[10px] font-bold text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-sm">
                            Order
                          </Link>
                        )}
                        <button
                          onClick={() => handleResolveAlert(alert.id)}
                          className="inline-flex items-center px-2.5 py-1 border border-gray-300 rounded text-[10px] font-semibold text-gray-700 bg-white hover:bg-gray-50 transition-colors shadow-sm"
                        >
                          Resolve
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* SECTION G: Purchase Analytics & Expiry/Overstock Risk */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Phase 8 Purchase Summary */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col justify-between">
            <div>
              <h3 className="text-md font-bold text-gray-950 mb-4">Purchasing Pipeline</h3>
              <div className="space-y-4">
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
            
            <div className="border-t border-gray-150 pt-4 mt-6">
              <Link href="/purchases" className="w-full inline-flex justify-center items-center px-4 py-2 border border-transparent rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-sm">
                Go to Purchases Manager
              </Link>
            </div>
          </div>

          {/* Expiry Risk Products */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm lg:col-span-2">
            <h3 className="text-md font-bold text-gray-950 mb-1">Expiry & Wastage Risk</h3>
            <p className="text-xs text-gray-400 mb-4">Products where days of stock exceeds remaining shelf life</p>
            {expiryRisks.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-xs bg-gray-50 border border-gray-100 rounded-lg">
                No active shelf life expiry/overstock wastage risks detected.
              </div>
            ) : (
              <div className="overflow-x-auto border border-gray-100 rounded-lg">
                <table className="min-w-full text-xs text-gray-700">
                  <thead className="bg-gray-50 text-gray-500 font-semibold uppercase">
                    <tr>
                      <th className="px-4 py-2.5 text-left">Product</th>
                      <th className="px-4 py-2.5 text-center">Current Stock</th>
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
                        <td className="px-4 py-3 text-center text-amber-700 font-bold">{p.shelf_life_days} days</td>
                        <td className="px-4 py-3 text-center text-red-600 font-bold">{p.daysOfStock.toFixed(0)} days</td>
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

      </div>
    </div>
  )
}
