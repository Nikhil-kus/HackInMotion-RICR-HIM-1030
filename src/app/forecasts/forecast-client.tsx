'use client'

import React, { useState, useMemo } from 'react'
import { calculateAllForecasts, ProductSimple, ProductForecastDetails, ForecastRecord } from './actions'
import ForecastChart from './forecast-chart'

interface ForecastClientProps {
  products: ProductSimple[]
  initialSummaries: ProductForecastDetails[]
  fetchError?: string | null
}

export default function ForecastClient({
  products,
  initialSummaries,
  fetchError
}: ForecastClientProps) {
  const [summaries, setSummaries] = useState<ProductForecastDetails[]>(initialSummaries)
  const [selectedProductId, setSelectedProductId] = useState<string>(products[0]?.id || '')
  const [pending, setPending] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(fetchError || null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Find details of selected product
  const selectedDetails = useMemo(() => {
    return summaries.find((s) => s.productId === selectedProductId)
  }, [summaries, selectedProductId])

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

  // Calculate stats for selected forecast
  const selectedStats = useMemo(() => {
    if (!selectedDetails || selectedDetails.insufficientData) return null

    const forecastList = selectedDetails.forecastList
    const next7DaysTotal = forecastList.reduce((sum, f) => sum + f.predictedDemand, 0)
    
    // Build combined chart data (history + forecast)
    // Show last 21 days of history + 7 days forecast
    const historyData = selectedDetails.historicalDemand.slice(-21).map((d) => ({
      date: d.date,
      quantity: d.quantity,
      isForecast: false
    }))

    const forecastData = forecastList.map((f) => ({
      date: f.forecastDate,
      quantity: f.predictedDemand,
      isForecast: true
    }))

    const chartData = [...historyData, ...forecastData]

    return {
      next7DaysTotal,
      chartData
    }
  }, [selectedDetails])

  // Run calculation Server Action
  async function handleRecalculate() {
    setPending(true)
    setErrorMsg(null)
    setSuccessMsg(null)

    const result = await calculateAllForecasts(products)

    if (result.error) {
      showToast(result.error, true)
      setPending(false)
    } else {
      showToast('Engine run completed! Re-evaluated forecasts for all products.')
      if (result.summaries) {
        setSummaries(result.summaries)
        // Retain selected ID or fallback
        if (!selectedProductId && products[0]?.id) {
          setSelectedProductId(products[0].id)
        }
      }
      setPending(false)
    }
  }

  // Helper for trend styles
  const getTrendBadge = (trend: 'Increasing' | 'Stable' | 'Decreasing') => {
    switch (trend) {
      case 'Increasing':
        return {
          label: 'Increasing Trend',
          colorClass: 'bg-emerald-100 text-emerald-800 border-emerald-200'
        }
      case 'Decreasing':
        return {
          label: 'Decreasing Trend',
          colorClass: 'bg-red-100 text-red-800 border-red-200'
        }
      case 'Stable':
      default:
        return {
          label: 'Stable Demand',
          colorClass: 'bg-blue-100 text-blue-800 border-blue-200'
        }
    }
  }

  // Helper for confidence styles
  const getConfidenceLevel = (score: number) => {
    if (score >= 70) {
      return {
        label: 'High Confidence',
        colorClass: 'bg-emerald-100 text-emerald-800 border-emerald-200'
      }
    } else if (score >= 40) {
      return {
        label: 'Medium Confidence',
        colorClass: 'bg-amber-100 text-amber-800 border-amber-200'
      }
    } else {
      return {
        label: 'Low Confidence',
        colorClass: 'bg-red-100 text-red-800 border-red-200'
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* Title & Action */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Demand Forecasting Engine</h2>
          <p className="text-gray-500 text-sm mt-1">
            Data-driven daily predictions computed using Weighted Moving Averages, trends, and seasonal components.
          </p>
        </div>
        <button
          onClick={handleRecalculate}
          disabled={pending || products.length === 0}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          {pending ? 'Calculating...' : 'Run Demand Model'}
        </button>
      </div>

      {/* Messaging alerts */}
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

      {products.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-sm">
          <h3 className="text-lg font-medium text-gray-900">No products configured</h3>
          <p className="text-gray-500 text-sm mt-1">
            You must register products in your inventory before the demand forecasting engine can run.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
          {/* Products Sidebar Select Panel */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden lg:col-span-1">
            <div className="bg-gray-50 p-4 border-b border-gray-200">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Product Inventory</span>
            </div>
            <div className="divide-y divide-gray-200 max-h-[500px] overflow-y-auto">
              {products.map((product) => {
                const summary = summaries.find((s) => s.productId === product.id)
                const isSelected = selectedProductId === product.id
                
                return (
                  <button
                    key={product.id}
                    onClick={() => setSelectedProductId(product.id)}
                    className={`w-full text-left p-4 hover:bg-gray-50/50 transition-colors flex flex-col space-y-1 ${
                      isSelected ? 'bg-purple-50/40 border-l-4 border-purple-500' : ''
                    }`}
                  >
                    <span className="text-sm font-semibold text-gray-900 truncate">{product.name}</span>
                    <div className="flex items-center justify-between text-xs w-full pt-1">
                      {summary ? (
                        summary.insufficientData ? (
                          <span className="text-amber-600 font-medium bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100">
                            Insufficient Data
                          </span>
                        ) : (
                          <>
                            <span className="text-gray-400">Score: {summary.confidenceScore}</span>
                            <span className={`px-1.5 py-0.5 rounded border font-medium ${
                              summary.trend === 'Increasing' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                              summary.trend === 'Decreasing' ? 'bg-red-50 text-red-700 border-red-100' :
                              'bg-blue-50 text-blue-700 border-blue-100'
                            }`}>
                              {summary.trend}
                            </span>
                          </>
                        )
                      ) : (
                        <span className="text-gray-400">Not Modelled</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Forecast Analysis Main view */}
          <div className="lg:col-span-3 space-y-6">
            {!selectedDetails ? (
              <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-sm">
                <p className="text-gray-500 text-sm">Select a product from the list to view its statistical forecast.</p>
              </div>
            ) : selectedDetails.insufficientData ? (
              <div className="bg-white border border-gray-200 rounded-xl p-8 shadow-sm space-y-4">
                <div className="flex items-center space-x-2 text-amber-600">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <h3 className="text-md font-bold text-gray-900">Insufficient Data Points</h3>
                </div>
                <p className="text-sm text-gray-600 leading-relaxed">
                  The demand forecasting engine requires **at least 14 days of historical sales data** to generate reliable statistical models.
                  This product currently only has **{selectedDetails.daysOfHistory} records** logged.
                </p>
                <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-lg text-xs leading-relaxed">
                  💡 You can populate realistic 90-day test histories by clicking &quot;Generate 90-Day Demo Sales&quot; in the **Sales** page!
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Stats row & details */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                    <span className="text-gray-500 text-xs font-semibold block uppercase">Total Predicted Demand (Next 7d)</span>
                    <span className="text-2xl font-bold text-purple-700 block mt-1">
                      {selectedStats?.next7DaysTotal} units
                    </span>
                  </div>

                  <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between">
                    <span className="text-gray-500 text-xs font-semibold block uppercase">Confidence Rating</span>
                    <div className="mt-1 flex items-center space-x-2">
                      <span className="text-xl font-bold text-gray-900">{selectedDetails.confidenceScore}%</span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${
                        getConfidenceLevel(selectedDetails.confidenceScore).colorClass
                      }`}>
                        {getConfidenceLevel(selectedDetails.confidenceScore).label}
                      </span>
                    </div>
                  </div>

                  <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between">
                    <span className="text-gray-500 text-xs font-semibold block uppercase">Calculated Trend Direction</span>
                    <div className="mt-1 flex items-center">
                      <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-semibold border ${
                        getTrendBadge(selectedDetails.trend).colorClass
                      }`}>
                        {getTrendBadge(selectedDetails.trend).label}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Narrative metric explanation */}
                <div className="bg-purple-50/50 border border-purple-100 rounded-xl p-4 shadow-sm">
                  <h4 className="text-xs font-bold text-purple-700 uppercase tracking-wider mb-1">Model Analytical Summary</h4>
                  <p className="text-sm text-gray-800 leading-relaxed font-medium">
                    &quot;{selectedDetails.explanation}&quot;
                  </p>
                  <span className="text-[10px] text-gray-400 block mt-2 font-mono">
                    Model Version: {selectedDetails.forecastList[0]?.modelVersion}
                  </span>
                </div>

                {/* Customized SVG Line chart */}
                {selectedStats && (
                  <ForecastChart data={selectedStats.chartData} />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
