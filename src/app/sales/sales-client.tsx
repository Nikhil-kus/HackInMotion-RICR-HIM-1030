'use client'

import React, { useState, useMemo, useRef } from 'react'
import Papa from 'papaparse'
import { Sale, importSales, generateDemoSales } from './actions'

interface ProductSimple {
  id: string
  name: string
  price: number
}

interface SalesClientProps {
  initialSales: Sale[]
  initialStats: {
    totalRecords: number
    totalUnits: number
    totalRevenue: number
  }
  products: ProductSimple[]
  fetchError?: string | null
}

interface CSVRow {
  date?: string
  product?: string
  quantity?: string
  revenue?: string
  [key: string]: string | undefined
}

interface ValidatedRecord {
  rowNumber: number
  date: string
  productName: string
  productId: string
  quantity: number
  revenue: number
  unitPrice: number
  isValid: boolean
  errors: string[]
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  const day = String(d.getUTCDate()).padStart(2, '0')
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const year = d.getUTCFullYear()
  return `${day}/${month}/${year}`
}

export default function SalesClient({ initialSales, initialStats, products, fetchError }: SalesClientProps) {
  const [sales] = useState<Sale[]>(initialSales)
  const [stats] = useState(initialStats)
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' })
  const [productFilter, setProductFilter] = useState('')
  const [pending, setPending] = useState(false)

  // Messages state
  const [errorMsg, setErrorMsg] = useState<string | null>(fetchError || null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // CSV states
  const [csvRecords, setCsvRecords] = useState<ValidatedRecord[]>([])
  const [hasParsed, setHasParsed] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  // Helper to map product names case-insensitively
  const productMap = useMemo(() => {
    const map = new Map<string, ProductSimple>()
    products.forEach((p) => {
      map.set(p.name.trim().toLowerCase(), p)
    })
    return map
  }, [products])

  // Filtered sales list
  const filteredSales = useMemo(() => {
    return sales.filter((sale) => {
      const matchesProduct = productFilter === '' || sale.product_id === productFilter
      
      let matchesDate = true
      if (dateFilter.start) {
        matchesDate = matchesDate && new Date(sale.sale_date) >= new Date(dateFilter.start)
      }
      if (dateFilter.end) {
        // Set end date to end of day
        const endOfDay = new Date(dateFilter.end)
        endOfDay.setHours(23, 59, 59, 999)
        matchesDate = matchesDate && new Date(sale.sale_date) <= endOfDay
      }

      return matchesProduct && matchesDate
    })
  }, [sales, productFilter, dateFilter])

  // Split parsed records into valid/invalid
  const { validRecords, invalidRecords } = useMemo(() => {
    const valid: ValidatedRecord[] = []
    const invalid: ValidatedRecord[] = []

    csvRecords.forEach((rec) => {
      if (rec.isValid) {
        valid.push(rec)
      } else {
        invalid.push(rec)
      }
    })

    return { validRecords: valid, invalidRecords: invalid }
  }, [csvRecords])

  // CSV upload handler
  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setErrorMsg(null)
    setCsvRecords([])
    setHasParsed(false)

    // Check file extension / type
    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      showToast('Invalid file format. Please upload a valid CSV file.', true)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    Papa.parse<CSVRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.data.length === 0) {
          showToast('The uploaded CSV file is empty.', true)
          return
        }

        const headers = results.meta.fields || []
        const required = ['date', 'product', 'quantity', 'revenue']
        const missing = required.filter(h => !headers.some(fh => fh.trim().toLowerCase() === h))

        if (missing.length > 0) {
          showToast(`Missing required columns: ${missing.join(', ')}`, true)
          return
        }

        // Validate each row
        const validated: ValidatedRecord[] = results.data.map((row, index) => {
          const rowNumber = index + 2 // 1-based, +1 for header row
          const errors: string[] = []

          // Extract columns case-insensitively
          const dateKey = headers.find(h => h.trim().toLowerCase() === 'date') || 'date'
          const productKey = headers.find(h => h.trim().toLowerCase() === 'product') || 'product'
          const quantityKey = headers.find(h => h.trim().toLowerCase() === 'quantity') || 'quantity'
          const revenueKey = headers.find(h => h.trim().toLowerCase() === 'revenue') || 'revenue'

          const rawDate = row[dateKey]?.toString().trim() || ''
          const rawProduct = row[productKey]?.toString().trim() || ''
          const rawQuantity = row[quantityKey]?.toString().trim() || ''
          const rawRevenue = row[revenueKey]?.toString().trim() || ''

          // 1. Validate product name matching
          let matchedProduct: ProductSimple | undefined
          if (!rawProduct) {
            errors.push('Product name is missing.')
          } else {
            matchedProduct = productMap.get(rawProduct.toLowerCase())
            if (!matchedProduct) {
              errors.push(`Product not found: "${rawProduct}"`)
            }
          }

          // 2. Validate date
          const dateObj = new Date(rawDate)
          if (!rawDate) {
            errors.push('Date is missing.')
          } else if (isNaN(dateObj.getTime())) {
            errors.push(`Invalid date format: "${rawDate}"`)
          }

          // 3. Validate quantity
          const quantity = parseInt(rawQuantity, 10)
          if (!rawQuantity) {
            errors.push('Quantity is missing.')
          } else if (isNaN(quantity) || quantity <= 0) {
            errors.push(`Quantity must be a positive integer: "${rawQuantity}"`)
          }

          // 4. Validate revenue
          const revenue = parseFloat(rawRevenue)
          if (!rawRevenue) {
            errors.push('Revenue is missing.')
          } else if (isNaN(revenue) || revenue < 0) {
            errors.push(`Revenue must be a non-negative number: "${rawRevenue}"`)
          }

          const unitPrice = quantity > 0 ? revenue / quantity : 0

          return {
            rowNumber,
            date: dateObj.toISOString().split('T')[0],
            productName: rawProduct,
            productId: matchedProduct?.id || '',
            quantity,
            revenue,
            unitPrice,
            isValid: errors.length === 0,
            errors
          }
        })

        setCsvRecords(validated)
        setHasParsed(true)
      },
      error: (error) => {
        showToast(`Failed to parse CSV: ${error.message}`, true)
      }
    })
  }

  // Trigger import submission
  async function handleImportSubmit() {
    if (validRecords.length === 0) return
    setPending(true)
    setErrorMsg(null)

    const payload = validRecords.map((r) => ({
      product_id: r.productId,
      sale_date: r.date,
      quantity: r.quantity,
      unit_price: r.unitPrice
    }))

    const result = await importSales(payload)

    if (result.error) {
      showToast(result.error, true)
      setPending(false)
    } else {
      showToast(
        `Import completed! Successfully imported ${result.importedCount} records. ${
          result.skippedCount ? `${result.skippedCount} duplicates skipped.` : ''
        }`
      )
      // Reset upload state
      setCsvRecords([])
      setHasParsed(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      
      // Reload window to update table and stats
      window.location.reload()
    }
  }

  // Trigger demo data generation
  async function handleDemoGenerate() {
    if (products.length === 0) {
      showToast('Cannot generate data: No products exist. Please create products first in Inventory.', true)
      return
    }

    setPending(true)
    setErrorMsg(null)

    const result = await generateDemoSales(products)

    if (result.error) {
      showToast(result.error, true)
      setPending(false)
    } else {
      showToast(result.message || 'Demo data generated successfully.')
      window.location.reload()
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Sales Data Import</h2>
        <p className="text-gray-500 text-sm mt-1">Import transactions via CSV or populate deterministic test sets.</p>
      </div>

      {/* KPI Stats widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <span className="text-gray-500 text-sm font-medium">Total Sales Transactions</span>
          <span className="block text-3xl font-bold text-gray-900 mt-2">{stats.totalRecords}</span>
        </div>
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <span className="text-gray-500 text-sm font-medium">Total Units Sold</span>
          <span className="block text-3xl font-bold text-gray-900 mt-2">{stats.totalUnits}</span>
        </div>
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <span className="text-gray-500 text-sm font-medium">Total Revenue</span>
          <span className="block text-3xl font-bold text-blue-600 mt-2">₹{stats.totalRevenue.toFixed(2)}</span>
        </div>
      </div>

      {/* Alert Messaging */}
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

      {/* CSV & Demo Upload Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* CSV Import Dropzone */}
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm lg:col-span-2 space-y-4">
          <h3 className="text-lg font-semibold text-gray-900">Import Sales CSV</h3>
          
          <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center hover:border-blue-500 transition-colors relative">
            <svg className="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm font-medium text-gray-900">Click to select CSV File</p>
            <p className="text-xs text-gray-500 mt-1">Columns required: date, product, quantity, revenue</p>
            <input
              type="file"
              ref={fileInputRef}
              accept=".csv"
              onChange={handleCSVUpload}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>

          {hasParsed && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm pt-2">
                <span className="font-semibold text-gray-900">CSV Results Preview:</span>
                <div className="space-x-4">
                  <span className="text-emerald-600 font-medium">Valid: {validRecords.length}</span>
                  <span className="text-red-600 font-medium">Invalid: {invalidRecords.length}</span>
                </div>
              </div>

              {/* Invalid Records Error Log */}
              {invalidRecords.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-h-48 overflow-y-auto space-y-2">
                  <span className="text-xs font-bold text-red-800 uppercase tracking-wider">Validation Errors to Resolve:</span>
                  <ul className="text-xs text-red-700 space-y-1 list-disc pl-4">
                    {invalidRecords.map((rec) => (
                      <li key={rec.rowNumber}>
                        Row {rec.rowNumber} ({rec.productName || 'Unnamed'}): {rec.errors.join(', ')}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end space-x-3 pt-2">
                <button
                  onClick={() => {
                    setCsvRecords([])
                    setHasParsed(false)
                    if (fileInputRef.current) fileInputRef.current.value = ''
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Clear Preview
                </button>
                <button
                  onClick={handleImportSubmit}
                  disabled={pending || validRecords.length === 0}
                  className="px-4 py-2 border border-transparent rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                >
                  {pending ? 'Importing...' : `Import ${validRecords.length} Valid Records`}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Demo Data Card */}
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4 flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Demo Data Utility</h3>
            <p className="text-gray-500 text-xs mt-1 leading-relaxed">
              Populate your dashboard with 90 days of deterministic, realistic demand patterns (weekly trends, seasonality, spikes) matching your existing inventory.
            </p>
          </div>
          <div className="space-y-3 pt-4">
            {products.length === 0 ? (
              <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 p-3 rounded-lg">
                ⚠️ Create products in your Inventory page first to generate demo sales.
              </div>
            ) : (
              <div className="text-xs text-gray-500 bg-gray-50 p-3 rounded-lg border border-gray-150">
                Connected to <span className="font-semibold">{products.length} active products</span>.
              </div>
            )}
            <button
              onClick={handleDemoGenerate}
              disabled={pending || products.length === 0}
              className="w-full inline-flex justify-center items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none disabled:opacity-50"
            >
              {pending ? 'Generating...' : 'Generate 90-Day Demo Sales'}
            </button>
          </div>
        </div>
      </div>

      {/* Filters & Recent Transactions List */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        {/* Table Filters header */}
        <div className="p-4 border-b border-gray-200 bg-gray-50/50 flex flex-col sm:flex-row gap-4 items-center justify-between">
          <h3 className="text-md font-bold text-gray-900">Transaction Records</h3>
          
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            {/* Product filter */}
            <select
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
            >
              <option value="">All Products</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {/* Start Date */}
            <input
              type="date"
              placeholder="Start Date"
              value={dateFilter.start}
              onChange={(e) => setDateFilter({ ...dateFilter, start: e.target.value })}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
            />
            {/* End Date */}
            <input
              type="date"
              placeholder="End Date"
              value={dateFilter.end}
              onChange={(e) => setDateFilter({ ...dateFilter, end: e.target.value })}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
            />
            {/* Reset */}
            {(productFilter || dateFilter.start || dateFilter.end) && (
              <button
                onClick={() => {
                  setProductFilter('')
                  setDateFilter({ start: '', end: '' })
                }}
                className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-350"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>

        {/* Transactions Table */}
        {filteredSales.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">
            No sales records found matching the active filters or database search query.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Product Name</th>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Quantity</th>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Revenue</th>
                  <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Source</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredSales.slice(0, 100).map((sale) => {
                  const revenue = sale.quantity * sale.unit_price
                  const sourceBadgeColors = 
                    sale.source === 'csv' ? 'bg-blue-100 text-blue-800 border-blue-200' :
                    sale.source === 'demo' ? 'bg-purple-100 text-purple-800 border-purple-200' :
                    'bg-amber-100 text-amber-800 border-amber-200' // retail
                  
                  return (
                    <tr key={sale.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatDate(sale.sale_date)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">
                        {sale.product_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {sale.quantity}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-semibold">
                        ₹{revenue.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${sourceBadgeColors}`}>
                          {sale.source}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {filteredSales.length > 100 && (
              <div className="p-3 text-center text-xs text-gray-400 border-t border-gray-150">
                Showing top 100 recent sales. Use date/product filters to narrow search.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
