'use client'

import React, { useState } from 'react'
import { DailySalesTrend } from './actions'

interface SalesTrendChartProps {
  data: DailySalesTrend[]
}

export default function SalesTrendChart({ data }: SalesTrendChartProps) {
  const [metric, setMetric] = useState<'quantity' | 'revenue'>('quantity')

  if (!data || data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center bg-gray-50 border border-gray-150 rounded-xl text-sm text-gray-400 font-medium">
        No sales data available for the selected period
      </div>
    )
  }

  // Dimensions
  const svgWidth = 700
  const svgHeight = 280
  const padding = { top: 30, right: 30, bottom: 40, left: 55 }

  // Extract values
  const values = data.map((d) => (metric === 'quantity' ? d.quantity : d.revenue))
  const maxValue = Math.max(...values, 1) // Avoid division by zero

  // Calculate coordinates
  const points = data.map((d, index) => {
    const val = metric === 'quantity' ? d.quantity : d.revenue
    const x = padding.left + (index / Math.max(1, data.length - 1)) * (svgWidth - padding.left - padding.right)
    const y = svgHeight - padding.bottom - (val / maxValue) * (svgHeight - padding.top - padding.bottom)
    return { x, y, val, label: d.label }
  })

  // Create path strings
  let linePath = ''
  let areaPath = ''

  if (points.length > 0) {
    linePath = `M ${points[0].x} ${points[0].y} `
    for (let i = 1; i < points.length; i++) {
      linePath += `L ${points[i].x} ${points[i].y} `
    }

    // Close the area path for shading
    areaPath = `${linePath} L ${points[points.length - 1].x} ${svgHeight - padding.bottom} L ${points[0].x} ${svgHeight - padding.bottom} Z`
  }

  // Formatting helper
  const formatYAxisVal = (val: number) => {
    if (metric === 'revenue') {
      if (val >= 100000) return `₹${(val / 1000).toFixed(0)}k`
      return `₹${val.toFixed(0)}`
    }
    return val.toFixed(0)
  }

  // Horizontal gridlines (4 sections)
  const gridLines = []
  for (let i = 0; i <= 4; i++) {
    const ratio = i / 4
    const y = svgHeight - padding.bottom - ratio * (svgHeight - padding.top - padding.bottom)
    const val = ratio * maxValue
    gridLines.push({ y, val })
  }

  // X Axis Date labels (show max 5 labels to prevent overlap)
  const labelInterval = Math.max(1, Math.floor(data.length / 5))
  const xAxisLabels = points.filter((_, idx) => idx % labelInterval === 0 || idx === points.length - 1)

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h3 className="text-md font-bold text-gray-950">Sales Analytics Trend</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Showing daily {metric === 'quantity' ? 'sales volume in units' : 'sales revenue in ₹'}
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50 self-end sm:self-auto">
          <button
            onClick={() => setMetric('quantity')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              metric === 'quantity'
                ? 'bg-white text-blue-600 shadow-sm border border-gray-150'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            Volume (Units)
          </button>
          <button
            onClick={() => setMetric('revenue')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              metric === 'revenue'
                ? 'bg-white text-blue-600 shadow-sm border border-gray-150'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            Revenue (₹)
          </button>
        </div>
      </div>

      <div className="relative w-full overflow-hidden" style={{ aspectRatio: '700/280' }}>
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          width="100%"
          height="100%"
          className="overflow-visible"
        >
          <defs>
            {/* Area Gradient */}
            <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0.00" />
            </linearGradient>
          </defs>

          {/* Horizontal Gridlines and Y Labels */}
          {gridLines.map((line, idx) => (
            <g key={idx}>
              <line
                x1={padding.left}
                y1={line.y}
                x2={svgWidth - padding.right}
                y2={line.y}
                stroke="#f3f4f6"
                strokeWidth={1}
                strokeDasharray={idx === 0 ? undefined : '4 4'}
              />
              <text
                x={padding.left - 10}
                y={line.y + 4}
                textAnchor="end"
                className="text-[10px] fill-gray-400 font-medium font-sans"
              >
                {formatYAxisVal(line.val)}
              </text>
            </g>
          ))}

          {/* Area Path */}
          {areaPath && (
            <path
              d={areaPath}
              fill="url(#chartGradient)"
            />
          )}

          {/* Line Path */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="#2563eb"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Interactive Dots */}
          {points.map((pt, idx) => {
            // Draw all dots if dataset is small, otherwise highlight key points
            const shouldDrawDot = points.length <= 15 || idx === 0 || idx === points.length - 1 || pt.val === maxValue
            if (!shouldDrawDot) return null

            return (
              <g key={idx} className="group cursor-pointer">
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={pt.val === maxValue ? 5 : 4}
                  className="fill-white stroke-blue-600 stroke-[2.5px] hover:r-6 transition-all"
                />
                {/* Tooltip on hover/display */}
                <g className="opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none duration-150">
                  <rect
                    x={Math.max(10, pt.x - 65)}
                    y={Math.max(5, pt.y - 45)}
                    width={130}
                    height={35}
                    rx={6}
                    className="fill-gray-900 shadow-lg"
                  />
                  <text
                    x={Math.max(10, pt.x - 65) + 65}
                    y={Math.max(5, pt.y - 45) + 15}
                    textAnchor="middle"
                    className="text-[9px] fill-gray-400 font-normal font-sans"
                  >
                    {pt.label}
                  </text>
                  <text
                    x={Math.max(10, pt.x - 65) + 65}
                    y={Math.max(5, pt.y - 45) + 26}
                    textAnchor="middle"
                    className="text-[10px] fill-white font-bold font-sans"
                  >
                    {metric === 'quantity' ? `${pt.val} units` : `₹${pt.val.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
                  </text>
                </g>
              </g>
            )
          })}

          {/* X Axis Labels */}
          {xAxisLabels.map((pt, idx) => (
            <g key={idx}>
              <line
                x1={pt.x}
                y1={svgHeight - padding.bottom}
                x2={pt.x}
                y2={svgHeight - padding.bottom + 5}
                stroke="#e5e7eb"
                strokeWidth={1}
              />
              <text
                x={pt.x}
                y={svgHeight - padding.bottom + 18}
                textAnchor="middle"
                className="text-[10px] fill-gray-400 font-medium font-sans"
              >
                {pt.label}
              </text>
            </g>
          ))}

          {/* Bottom baseline */}
          <line
            x1={padding.left}
            y1={svgHeight - padding.bottom}
            x2={svgWidth - padding.right}
            y2={svgHeight - padding.bottom}
            stroke="#e5e7eb"
            strokeWidth={1.5}
          />
        </svg>
      </div>
    </div>
  )
}
