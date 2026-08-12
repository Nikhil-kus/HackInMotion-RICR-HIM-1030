'use client'

import React from 'react'

interface ChartDataPoint {
  date: string
  quantity: number
  isForecast: boolean
}

interface ForecastChartProps {
  data: ChartDataPoint[]
}

export default function ForecastChart({ data }: ForecastChartProps) {
  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center bg-gray-50 border border-dashed border-gray-200 rounded-xl text-sm text-gray-500">
        No demand data available to display.
      </div>
    )
  }

  // Dimensions
  const svgWidth = 600
  const svgHeight = 280
  const margin = { top: 25, right: 40, bottom: 45, left: 50 }

  const chartWidth = svgWidth - margin.left - margin.right
  const chartHeight = svgHeight - margin.top - margin.bottom

  // Calculations
  const maxVal = Math.max(...data.map((d) => d.quantity), 1)
  const yMax = Math.ceil(maxVal * 1.15) // Pad Y axis by 15%

  const pointsCount = data.length

  // Generate coordinates
  const getX = (index: number) => margin.left + (index / (pointsCount - 1)) * chartWidth
  const getY = (value: number) => margin.top + chartHeight - (value / yMax) * chartHeight

  // Create paths
  const histPoints: string[] = []
  const forePoints: string[] = []

  data.forEach((d, i) => {
    const x = getX(i)
    const y = getY(d.quantity)
    const coordStr = `${x.toFixed(1)},${y.toFixed(1)}`

    if (!d.isForecast) {
      histPoints.push(coordStr)
    } else {
      // Connect the last historical point to the first forecast point to avoid gaps
      if (histPoints.length > 0 && forePoints.length === 0) {
        forePoints.push(histPoints[histPoints.length - 1])
      }
      forePoints.push(coordStr)
    }
  })

  const historicalPath = histPoints.length > 0 ? `M ${histPoints.join(' L ')}` : ''
  const forecastedPath = forePoints.length > 0 ? `M ${forePoints.join(' L ')}` : ''

  // Y axis grid lines (4 divisions)
  const yGridLines = [0, 0.25, 0.5, 0.75, 1].map((p) => {
    const value = Math.round(yMax * p)
    const y = getY(value)
    return { value, y }
  })

  // Select 5 dates to display on X axis to prevent overlap
  const xLabelIndices = Array.from(
    { length: 5 },
    (_, i) => Math.round((i * (pointsCount - 1)) / 4)
  )

  const formatShortDate = (dateStr: string) => {
    const parts = dateStr.split('-')
    if (parts.length < 3) return dateStr
    return `${parts[2]}/${parts[1]}` // format as dd/mm
  }

  return (
    <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-4">
      {/* Legend & Title */}
      <div className="flex justify-between items-center text-xs">
        <span className="font-semibold text-gray-700">Demand Trend (Units / Day)</span>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-1.5">
            <span className="w-3 h-0.5 bg-blue-600 block border-t-2 border-blue-600"></span>
            <span className="text-gray-500 font-medium">Historical (Solid)</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-3 h-0.5 border-t-2 border-dashed border-purple-500 block"></span>
            <span className="text-gray-500 font-medium">Forecast (Dashed)</span>
          </div>
        </div>
      </div>

      {/* SVG Vector Chart */}
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full min-w-[500px] h-auto block"
        >
          {/* Horizontal Grid lines & Y labels */}
          {yGridLines.map((grid) => (
            <g key={grid.value} className="opacity-60">
              <line
                x1={margin.left}
                y1={grid.y}
                x2={svgWidth - margin.right}
                y2={grid.y}
                stroke="#E5E7EB"
                strokeWidth={1}
                strokeDasharray={grid.value === 0 ? '0' : '4 4'}
              />
              <text
                x={margin.left - 10}
                y={grid.y + 4}
                textAnchor="end"
                className="text-[10px] fill-gray-400 font-medium font-sans"
              >
                {grid.value}
              </text>
            </g>
          ))}

          {/* Area Gradients */}
          <defs>
            <linearGradient id="histGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#2563EB" stopOpacity="0.1" />
              <stop offset="95%" stopColor="#2563EB" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="foreGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#A855F7" stopOpacity="0.1" />
              <stop offset="95%" stopColor="#A855F7" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Area under curves */}
          {histPoints.length > 0 && (
            <path
              d={`${historicalPath} L ${getX(histPoints.length - 1)},${getY(0)} L ${getX(0)},${getY(0)} Z`}
              fill="url(#histGrad)"
            />
          )}
          {forePoints.length > 0 && (
            <path
              d={`${forecastedPath} L ${getX(pointsCount - 1)},${getY(0)} L ${getX(histPoints.length - 1)},${getY(0)} Z`}
              fill="url(#foreGrad)"
            />
          )}

          {/* Paths (Lines) */}
          {historicalPath && (
            <path
              d={historicalPath}
              fill="none"
              stroke="#2563EB"
              strokeWidth={2}
              strokeLinecap="round"
            />
          )}
          {forecastedPath && (
            <path
              d={forecastedPath}
              fill="none"
              stroke="#A855F7"
              strokeWidth={2}
              strokeDasharray="4 4"
              strokeLinecap="round"
            />
          )}

          {/* Interactivity dots on lines */}
          {data.map((d, i) => {
            const x = getX(i)
            const y = getY(d.quantity)
            const color = d.isForecast ? '#A855F7' : '#2563EB'
            
            // Only draw dots for every few historical items if list is long, to prevent crowding
            if (!d.isForecast && i % Math.max(1, Math.round(pointsCount / 15)) !== 0 && i !== histPoints.length - 1) {
              return null
            }

            return (
              <g key={i} className="group">
                <circle
                  cx={x}
                  cy={y}
                  r={d.isForecast ? 4 : 3}
                  fill={color}
                  stroke="#FFFFFF"
                  strokeWidth={1.5}
                />
                {/* Numeric values labeled above the projection dots */}
                {d.isForecast && (
                  <text
                    x={x}
                    y={y - 8}
                    textAnchor="middle"
                    className="text-[9px] font-bold fill-purple-700"
                  >
                    {d.quantity}
                  </text>
                )}
              </g>
            )
          })}

          {/* X axis labels */}
          {xLabelIndices.map((index) => {
            if (index < 0 || index >= pointsCount) return null
            const d = data[index]
            return (
              <text
                key={index}
                x={getX(index)}
                y={svgHeight - 15}
                textAnchor="middle"
                className={`text-[10px] font-medium font-sans ${
                  d.isForecast ? 'fill-purple-600 font-semibold' : 'fill-gray-400'
                }`}
              >
                {formatShortDate(d.date)}
              </text>
            )
          })}

          {/* Visually mark the division between history & prediction */}
          {histPoints.length > 0 && (
            <g>
              <line
                x1={getX(histPoints.length - 1)}
                y1={margin.top - 5}
                x2={getX(histPoints.length - 1)}
                y2={svgHeight - margin.bottom}
                stroke="#9CA3AF"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
              <text
                x={getX(histPoints.length - 1) + 5}
                y={margin.top + 5}
                className="text-[9px] fill-gray-500 font-bold"
              >
                Forecast Start
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Grid view of forecast details */}
      {data.some((d) => d.isForecast) && (
        <div className="pt-2 border-t border-gray-150">
          <span className="text-xs font-bold text-gray-700 block mb-2">7-Day Forecast Grid View:</span>
          <div className="grid grid-cols-2 sm:grid-cols-7 gap-2">
            {data.filter((d) => d.isForecast).map((d) => {
              const dowStr = new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' })
              return (
                <div key={d.date} className="bg-purple-50/50 border border-purple-100 rounded-lg p-2 text-center">
                  <span className="text-[10px] text-purple-600 font-semibold block">{dowStr} ({d.date.split('-')[2]})</span>
                  <span className="text-sm font-bold text-gray-900 mt-0.5 block">{d.quantity} units</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
