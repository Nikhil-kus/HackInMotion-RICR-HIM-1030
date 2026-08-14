'use client'

import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Papa from 'papaparse'
import { Sale, importSales, generateDemoSales, createRetailSale } from './actions'
import type { Product } from '@/app/inventory/types'
import { parseSpokenSalesText, normalizeForMatching } from '@/lib/voice-parser'

interface SalesClientProps {
  initialSales: Sale[]
  initialStats: {
    totalRecords: number
    totalUnits: number
    totalRevenue: number
  }
  products: Product[]
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

interface CartItem {
  product: Product
  quantity: number
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  const day = String(d.getUTCDate()).padStart(2, '0')
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const year = d.getUTCFullYear()
  return `${day}/${month}/${year}`
}

function formatPackInfo(product: Product): string | null {
  const parts: string[] = []
  if (product.brand) parts.push(product.brand)
  if (product.unit) parts.push(product.unit)
  if (product.pack_size != null && product.pack_size_unit) {
    parts.push(
      `${product.pack_size % 1 === 0 ? product.pack_size.toFixed(0) : product.pack_size} ${product.pack_size_unit}`
    )
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

export default function SalesClient({ initialSales, initialStats, products, fetchError }: SalesClientProps) {
  const router = useRouter()
  const [sales] = useState<Sale[]>(initialSales)
  const [stats] = useState(initialStats)
  const [activeTab, setActiveTab] = useState<'new_sale' | 'history' | 'csv'>('new_sale')

  // History filters
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' })
  const [productFilter, setProductFilter] = useState('')
  const [pending, setPending] = useState(false)

  // Messages state
  const [errorMsg, setErrorMsg] = useState<string | null>(fetchError || null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // ── New Sale / POS State
  const [posSearch, setPosSearch] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])

  // ── Phase 10F: Customer & Billing State
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [discountInput, setDiscountInput] = useState('0')

  // Receipt state — populated after a successful sale, null when no active receipt
  interface ReceiptLine { name: string; quantity: number; unitPrice: number; lineTotal: number }
  interface CompletedBill {
    receiptAt: string          // ISO timestamp string
    customerName: string
    customerPhone: string
    lines: ReceiptLine[]
    subtotal: number
    discount: number
    grandTotal: number
    totalUnits: number
  }
  const [completedBill, setCompletedBill] = useState<CompletedBill | null>(null)

  // ── Phase 10C: Voice Input State
  const [isListening, setIsListening] = useState(false)
  const [speechTranscript, setSpeechTranscript] = useState('')
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [voiceUnmatchedItems, setVoiceUnmatchedItems] = useState<string[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)

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

  // Clean up Web Speech API recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop()
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }, [])

  // ── Helper map for CSV matching
  const productMap = useMemo(() => {
    const map = new Map<string, Product>()
    products.forEach((p) => {
      map.set(p.name.trim().toLowerCase(), p)
    })
    return map
  }, [products])

  // ── Multi-field Search for New Sale (Name, Brand, Barcode, Aliases)
  const filteredPosProducts = useMemo(() => {
    const q = posSearch.toLowerCase().trim()
    if (!q) return products

    return products.filter((product) => {
      if (product.name.toLowerCase().includes(q)) return true
      if (product.brand?.toLowerCase().includes(q)) return true
      if (product.barcode?.toLowerCase().includes(q)) return true
      if (product.aliases?.some((a) => a.alias.toLowerCase().includes(q))) return true
      return false
    })
  }, [products, posSearch])

  // ── Phase 10C: Product Matcher for Spoken Queries (8-tier priority)
  // Tier 1–4: exact script-level matches (highest confidence, no transliteration needed)
  // Tier 5–8: normalized/transliterated matches (cross-script: Devanagari ↔ Latin)
  const matchProductFromQuery = (itemQuery: string): Product | null => {
    if (!itemQuery.trim()) return null

    const q = itemQuery.toLowerCase().trim()

    // ── Tier 1: Exact product name match
    for (const p of products) {
      if (p.name.toLowerCase() === q) return p
    }

    // ── Tier 2: Exact alias match
    for (const p of products) {
      if (p.aliases?.some((a) => a.alias.toLowerCase() === q)) return p
    }

    // ── Tier 3: Exact barcode match
    for (const p of products) {
      if (p.barcode?.toLowerCase() === q) return p
    }

    // ── Tier 4: Exact brand match
    for (const p of products) {
      if (p.brand?.toLowerCase() === q) return p
    }

    // ── Tiers 5–8 use normalizeForMatching on both sides (transliterates Devanagari → Latin)
    const qNorm = normalizeForMatching(itemQuery)
    if (!qNorm) return null

    // ── Tier 5: Normalized exact product name match
    for (const p of products) {
      if (normalizeForMatching(p.name) === qNorm) return p
    }

    // ── Tier 6: Normalized exact alias match
    for (const p of products) {
      if (p.aliases?.some((a) => normalizeForMatching(a.alias) === qNorm)) return p
    }

    // ── Tier 7: Normalized exact brand match
    for (const p of products) {
      if (p.brand && normalizeForMatching(p.brand) === qNorm) return p
    }

    // ── Tier 8: Normalized substring match — query contains product name OR product name contains query.
    // To avoid false positives, only match when either the query or the catalog field
    // is fully contained in the other (not just any shared substring).
    const candidates: Array<{ product: Product; score: number }> = []

    for (const p of products) {
      const pNameNorm = normalizeForMatching(p.name)
      const pBrandNorm = p.brand ? normalizeForMatching(p.brand) : ''

      // Score = length of the matched field (longer = more specific = higher confidence)
      if (pNameNorm && (pNameNorm.includes(qNorm) || qNorm.includes(pNameNorm))) {
        candidates.push({ product: p, score: pNameNorm.length })
      } else if (pBrandNorm && (pBrandNorm.includes(qNorm) || qNorm.includes(pBrandNorm))) {
        candidates.push({ product: p, score: pBrandNorm.length })
      } else if (
        p.aliases?.some((a) => {
          const aliasNorm = normalizeForMatching(a.alias)
          return aliasNorm && (aliasNorm.includes(qNorm) || qNorm.includes(aliasNorm))
        })
      ) {
        candidates.push({ product: p, score: 1 })
      }
    }

    if (candidates.length === 1) {
      // Single unambiguous candidate — return it
      return candidates[0].product
    }

    if (candidates.length > 1) {
      // Multiple candidates — pick highest scoring one only if it scores strictly higher
      // than all others. If there's a tie, treat as ambiguous and return null.
      candidates.sort((a, b) => b.score - a.score)
      if (candidates[0].score > candidates[1].score) {
        return candidates[0].product
      }
      // Ambiguous — do not guess
      return null
    }

    return null
  }


  // ── Phase 10C: Process Spoken Transcript into POS Cart
  const processSpokenTranscript = (transcriptText: string) => {
    setSpeechTranscript(transcriptText)
    const parsedItems = parseSpokenSalesText(transcriptText)

    if (parsedItems.length === 0) return

    const unmatched: string[] = []

    parsedItems.forEach(({ quantity, itemQuery }) => {
      const matched = matchProductFromQuery(itemQuery)
      if (matched) {
        if (matched.current_stock <= 0) {
          showToast(`"${matched.name}" is out of stock.`, true)
          return
        }

        setCart((prev) => {
          const existingIndex = prev.findIndex((c) => c.product.id === matched.id)

          if (existingIndex >= 0) {
            const currentQty = prev[existingIndex].quantity
            const combined = currentQty + quantity
            const capped = Math.min(combined, matched.current_stock)

            if (combined > matched.current_stock) {
              // Schedule the toast after this state update
              setTimeout(() => {
                showToast(
                  `Stock limit reached for "${matched.name}". Quantity set to available stock (${matched.current_stock}).`,
                  true
                )
              }, 0)
            }

            const updated = [...prev]
            updated[existingIndex] = {
              ...updated[existingIndex],
              quantity: capped,
            }
            return updated
          }

          // New item — cap at available stock
          const targetQty = Math.min(quantity, matched.current_stock)
          return [...prev, { product: matched, quantity: targetQty }]
        })
      } else {
        unmatched.push(itemQuery)
      }
    })

    setVoiceUnmatchedItems(unmatched)
  }

  // ── Phase 10C: Web Speech API Toggle Handler
  const toggleSpeechRecognition = () => {
    if (isListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop()
        } catch {
          // Ignore
        }
      }
      setIsListening(false)
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

    if (!SpeechRecognition) {
      showToast('Speech recognition is not supported in this browser. Please use Chrome or Edge.', true)
      return
    }

    try {
      const recognition = new SpeechRecognition()
      recognition.lang = 'hi-IN' // Primary: Hindi India
      recognition.continuous = true
      recognition.interimResults = true

      recognition.onstart = () => {
        setIsListening(true)
        setVoiceError(null)
        setSpeechTranscript('')
        setVoiceUnmatchedItems([])
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onresult = (event: any) => {
        let currentTranscript = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          currentTranscript += event.results[i][0].transcript
        }
        if (currentTranscript.trim()) {
          processSpokenTranscript(currentTranscript)
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onerror = (event: any) => {
        if (event.error !== 'no-speech') {
          console.error('Speech recognition error:', event.error)
          setVoiceError(`Voice recognition error: ${event.error}`)
          setIsListening(false)
        }
      }

      recognition.onend = () => {
        setIsListening(false)
      }

      recognitionRef.current = recognition
      recognition.start()
    } catch (err) {
      console.error('Failed to start speech recognition:', err)
      showToast('Could not access microphone.', true)
    }
  }

  // ── Cart Handlers
  const addToCart = (product: Product) => {
    if (product.current_stock <= 0) {
      showToast(`"${product.name}" is out of stock.`, true)
      return
    }

    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id)
      if (existing) {
        if (existing.quantity >= product.current_stock) {
          showToast(`Cannot add more than available stock (${product.current_stock}).`, true)
          return prev
        }
        return prev.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        )
      }
      return [...prev, { product, quantity: 1 }]
    })
  }

  const updateCartQuantity = (productId: string, newQty: number) => {
    const item = cart.find((c) => c.product.id === productId)
    if (!item) return

    if (newQty <= 0) {
      removeFromCart(productId)
      return
    }

    if (newQty > item.product.current_stock) {
      showToast(`Cannot exceed available stock (${item.product.current_stock} units).`, true)
      return
    }

    setCart((prev) =>
      prev.map((c) => (c.product.id === productId ? { ...c, quantity: newQty } : c))
    )
  }

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((c) => c.product.id !== productId))
  }

  const clearCart = () => {
    setCart([])
  }

  // ── Phase 10E: Barcode Scanner Handler
  // Resolves an exact barcode string to a product and adds/increments in cart.
  // Priority: exact barcode (case-insensitive) before any other matching.
  const handleBarcodeScanned = (rawBarcode: string) => {
    const barcode = rawBarcode.trim()
    if (!barcode) return

    // Tier 0: Exact barcode lookup — highest priority
    const matched = products.find(
      (p) => p.barcode && p.barcode.toLowerCase() === barcode.toLowerCase()
    )

    if (!matched) {
      showToast(`Barcode not found: "${barcode}". Check product catalog.`, true)
      return
    }

    if (matched.current_stock <= 0) {
      showToast(`"${matched.name}" is out of stock.`, true)
      return
    }

    // Increment by 1, capped at available stock (same logic as addToCart)
    setCart((prev) => {
      const existingIndex = prev.findIndex((c) => c.product.id === matched.id)

      if (existingIndex >= 0) {
        const currentQty = prev[existingIndex].quantity

        if (currentQty >= matched.current_stock) {
          setTimeout(() => {
            showToast(
              `Stock limit reached for "${matched.name}" (${matched.current_stock} available).`,
              true
            )
          }, 0)
          return prev
        }

        const updated = [...prev]
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: currentQty + 1,
        }
        return updated
      }

      return [...prev, { product: matched, quantity: 1 }]
    })

    showToast(`Added "${matched.name}" to cart.`)
  }

  // ── Phase 10E: Search field keydown — intercept Enter for barcode scanner
  // USB/Bluetooth barcode scanners type the barcode rapidly and send Enter.
  // When Enter is pressed on the search field:
  //   1. Attempt exact barcode lookup first.
  //   2. If matched → add to cart and clear the search field.
  //   3. If no barcode match → leave field value so normal text search results
  //      remain visible (does not disrupt manual typing workflow).
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    const query = posSearch.trim()
    if (!query) return

    // Check for exact barcode match
    const barcodeMatch = products.find(
      (p) => p.barcode && p.barcode.toLowerCase() === query.toLowerCase()
    )

    if (barcodeMatch) {
      e.preventDefault()
      handleBarcodeScanned(query)
      setPosSearch('')
    }
    // No barcode match — let Enter do nothing; keep text in field so the
    // filtered product list remains visible for manual selection.
  }

  // Grand totals for cart (Phase 10F: subtotal + discount-aware grandTotal)
  const cartTotals = useMemo(() => {
    const totalItems = cart.length
    const totalUnits = cart.reduce((sum, c) => sum + c.quantity, 0)
    const subtotal = cart.reduce((sum, c) => sum + c.quantity * c.product.price, 0)
    const discountAmt = Math.min(Math.max(parseFloat(discountInput) || 0, 0), subtotal)
    const grandTotal = subtotal - discountAmt
    return { totalItems, totalUnits, subtotal, discountAmt, grandTotal }
  }, [cart, discountInput])

  // Complete Retail Sale trigger (Atomic PL/pgSQL RPC execution)
  const handleCompleteSale = async () => {
    if (cart.length === 0) return

    // ── Phase 10F: Validate discount before submitting
    const discountVal = parseFloat(discountInput) || 0
    if (discountVal < 0) {
      showToast('Discount cannot be negative.', true)
      return
    }
    if (discountVal > cartTotals.subtotal) {
      showToast('Discount cannot exceed the subtotal.', true)
      return
    }

    setPending(true)
    setErrorMsg(null)

    const cartPayload = cart.map((item) => ({
      product_id: item.product.id,
      quantity: item.quantity,
    }))

    // Snapshot the bill before the cart is cleared — the RPC uses authoritative
    // DB prices, so totalRevenue from the RPC is the financial source of truth.
    // We display the client-side prices for the receipt (identical since price
    // is read-only from the product catalog and cannot change mid-transaction).
    const billSnapshot = {
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      lines: cart.map((item) => ({
        name: item.product.name,
        quantity: item.quantity,
        unitPrice: item.product.price,
        lineTotal: item.quantity * item.product.price,
      })),
      subtotal: cartTotals.subtotal,
      discount: cartTotals.discountAmt,
      grandTotal: cartTotals.grandTotal,
      totalUnits: cartTotals.totalUnits,
    }

    const result = await createRetailSale(cartPayload)

    if (result.error) {
      showToast(result.error, true)
      setPending(false)
    } else {
      // Populate receipt with RPC-authoritative revenue for accuracy
      setCompletedBill({
        receiptAt: new Date().toISOString(),
        ...billSnapshot,
        // Override grandTotal with RPC total_revenue (authoritative DB price)
        grandTotal: Number(result.totalRevenue ?? billSnapshot.grandTotal),
      })
      setCart([])
      setCustomerName('')
      setCustomerPhone('')
      setDiscountInput('0')
      setPending(false)
      router.refresh()
    }
  }

  // ── Phase 10F: Start a new sale from the receipt screen
  const handleNewSale = () => {
    setCompletedBill(null)
    setCart([])
    setCustomerName('')
    setCustomerPhone('')
    setDiscountInput('0')
    setErrorMsg(null)
    setSuccessMsg(null)
  }

  // ── Filtered Sales History List
  const filteredSales = useMemo(() => {
    return sales.filter((sale) => {
      const matchesProduct = productFilter === '' || sale.product_id === productFilter

      let matchesDate = true
      if (dateFilter.start) {
        matchesDate = matchesDate && new Date(sale.sale_date) >= new Date(dateFilter.start)
      }
      if (dateFilter.end) {
        const endOfDay = new Date(dateFilter.end)
        endOfDay.setHours(23, 59, 59, 999)
        matchesDate = matchesDate && new Date(sale.sale_date) <= endOfDay
      }

      return matchesProduct && matchesDate
    })
  }, [sales, productFilter, dateFilter])

  // Split parsed CSV records into valid/invalid
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
        const missing = required.filter(
          (h) => !headers.some((fh) => fh.trim().toLowerCase() === h)
        )

        if (missing.length > 0) {
          showToast(`Missing required columns: ${missing.join(', ')}`, true)
          return
        }

        const validated: ValidatedRecord[] = results.data.map((row, index) => {
          const rowNumber = index + 2
          const errors: string[] = []

          const dateKey = headers.find((h) => h.trim().toLowerCase() === 'date') || 'date'
          const productKey = headers.find((h) => h.trim().toLowerCase() === 'product') || 'product'
          const quantityKey =
            headers.find((h) => h.trim().toLowerCase() === 'quantity') || 'quantity'
          const revenueKey = headers.find((h) => h.trim().toLowerCase() === 'revenue') || 'revenue'

          const rawDate = row[dateKey]?.toString().trim() || ''
          const rawProduct = row[productKey]?.toString().trim() || ''
          const rawQuantity = row[quantityKey]?.toString().trim() || ''
          const rawRevenue = row[revenueKey]?.toString().trim() || ''

          let matchedProduct: Product | undefined
          if (!rawProduct) {
            errors.push('Product name is missing.')
          } else {
            matchedProduct = productMap.get(rawProduct.toLowerCase())
            if (!matchedProduct) {
              errors.push(`Product not found: "${rawProduct}"`)
            }
          }

          const dateObj = new Date(rawDate)
          if (!rawDate) {
            errors.push('Date is missing.')
          } else if (isNaN(dateObj.getTime())) {
            errors.push(`Invalid date format: "${rawDate}"`)
          }

          const quantity = parseInt(rawQuantity, 10)
          if (!rawQuantity) {
            errors.push('Quantity is missing.')
          } else if (isNaN(quantity) || quantity <= 0) {
            errors.push(`Quantity must be a positive integer: "${rawQuantity}"`)
          }

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
            errors,
          }
        })

        setCsvRecords(validated)
        setHasParsed(true)
      },
      error: (error) => {
        showToast(`Failed to parse CSV: ${error.message}`, true)
      },
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
      unit_price: r.unitPrice,
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
      setCsvRecords([])
      setHasParsed(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
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

    const simpleProducts = products.map((p) => ({ id: p.id, name: p.name, price: p.price }))
    const result = await generateDemoSales(simpleProducts)

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
      {/* ── Phase 10F: Print styles — hides all POS UI except the receipt */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #pos-receipt, #pos-receipt * { visibility: visible !important; }
          #pos-receipt {
            position: fixed !important;
            top: 0 !important; left: 0 !important;
            width: 80mm !important;
            padding: 8mm !important;
            font-size: 11px !important;
            background: white !important;
            box-shadow: none !important;
            border: none !important;
          }
          .print-hide { display: none !important; }
        }
      `}</style>
      {/* Header & Modes/Tabs */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-200 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Sales Management</h2>
          <p className="text-gray-500 text-sm mt-1">
            Fast Kirana POS counter, Hindi voice sales, transaction history, and CSV data imports.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-gray-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('new_sale')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center gap-2 ${
              activeTab === 'new_sale'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <span>🧾</span> New Sale (POS)
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center gap-2 ${
              activeTab === 'history'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <span>📊</span> Sales History
          </button>
          <button
            onClick={() => setActiveTab('csv')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center gap-2 ${
              activeTab === 'csv'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <span>📥</span> Import CSV
          </button>
        </div>
      </div>

      {/* Notifications */}
      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-red-500 hover:text-red-700">
            ✕
          </button>
        </div>
      )}
      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-lg text-sm flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-700">
            ✕
          </button>
        </div>
      )}

      {/* ── TAB 1: NEW SALE (POS COUNTER & VOICE) ──────────────────────────── */}
      {activeTab === 'new_sale' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Product Search, Voice Controls & Results (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            {/* Search + Voice Control Bar */}
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Fast Search &amp; Hindi Voice Input
                </label>

                <div className="flex items-center gap-2">
                  {/* 📷 Barcode scanner hint badge */}
                  <span className="px-2 py-1 rounded-md bg-gray-100 border border-gray-200 text-gray-500 text-xs font-medium flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h1M4 10h1M4 14h1M4 18h1M8 6h1M8 18h1M12 6v12M16 6h1M16 18h1M20 6h1M20 10h1M20 14h1M20 18h1" />
                    </svg>
                    Scan barcode
                  </span>

                  {/* 🎤 Voice Recognition Button */}
                  <button
                    onClick={toggleSpeechRecognition}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 shadow-sm ${
                      isListening
                        ? 'bg-red-600 text-white animate-pulse'
                        : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700'
                    }`}
                  >
                    <span>{isListening ? '🛑 Stop Mic' : '🎤 बोलकर बिक्री करें (Voice)'}</span>
                  </button>
                </div>
              </div>

              <div className="relative">
                <input
                  type="text"
                  placeholder="Search name, brand, barcode, or Hindi alias (e.g. Amul, 890..., दूध)…"
                  value={posSearch}
                  onChange={(e) => setPosSearch(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  autoFocus
                />
                <span className="absolute left-3 top-3 text-gray-400">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </span>
                {posSearch && (
                  <button
                    onClick={() => setPosSearch('')}
                    className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 text-sm"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* 🎤 Live Voice Overlay & Status */}
              {isListening && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-red-700">
                    <span className="w-2 h-2 rounded-full bg-red-600 animate-ping"></span>
                    <span>Listening for Hindi/Hinglish speech (e.g. &quot;दो दूध और तीन कुरकुरे&quot;)…</span>
                  </div>

                  {speechTranscript ? (
                    <p className="text-sm font-semibold text-gray-900 bg-white p-2 rounded border border-red-100 italic">
                      &quot;{speechTranscript}&quot;
                    </p>
                  ) : (
                    <p className="text-xs text-gray-500 italic">Speak item name and quantity into microphone…</p>
                  )}
                </div>
              )}

              {/* Voice Error Notice */}
              {voiceError && (
                <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg flex items-center justify-between">
                  <span>{voiceError}</span>
                  <button onClick={() => setVoiceError(null)} className="text-amber-600 hover:text-amber-800 font-bold">
                    ✕
                  </button>
                </div>
              )}

              {/* Unmatched Voice Items Notice */}
              {voiceUnmatchedItems.length > 0 && (
                <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-lg space-y-1">
                  <span className="font-bold">⚠️ Spoken item(s) not matched in catalog:</span>
                  <div className="flex flex-wrap gap-1">
                    {voiceUnmatchedItems.map((item, idx) => (
                      <span key={idx} className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-mono">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Results Grid */}
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {filteredPosProducts.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-xl p-8 text-center shadow-sm">
                  <p className="text-gray-500 text-sm">No products found matching &quot;{posSearch}&quot;</p>
                </div>
              ) : (
                filteredPosProducts.map((product) => {
                  const packInfo = formatPackInfo(product)
                  const cartItem = cart.find((c) => c.product.id === product.id)
                  const isOut = product.current_stock <= 0
                  const isLow = product.current_stock > 0 && product.current_stock < 10

                  return (
                    <div
                      key={product.id}
                      className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between gap-4 hover:border-blue-300 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-gray-900 text-base truncate">{product.name}</h4>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                            {product.category}
                          </span>
                        </div>

                        {packInfo && <p className="text-xs text-gray-500 mt-0.5">{packInfo}</p>}

                        {product.barcode && (
                          <p className="text-xs text-gray-400 font-mono mt-0.5">Barcode: {product.barcode}</p>
                        )}

                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-lg font-bold text-emerald-700">₹{product.price.toFixed(2)}</span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                              isOut
                                ? 'bg-red-100 text-red-800 border-red-200'
                                : isLow
                                ? 'bg-amber-100 text-amber-800 border-amber-200'
                                : 'bg-emerald-100 text-emerald-800 border-emerald-200'
                            }`}
                          >
                            {isOut ? 'Out of Stock' : isLow ? `Low Stock: ${product.current_stock}` : `Stock: ${product.current_stock}`}
                          </span>
                        </div>
                      </div>

                      {/* Add Button or Stepper */}
                      <div>
                        {cartItem ? (
                          <div className="flex items-center border border-blue-600 rounded-lg bg-blue-50 overflow-hidden">
                            <button
                              onClick={() => updateCartQuantity(product.id, cartItem.quantity - 1)}
                              className="px-3 py-1.5 text-blue-700 font-bold hover:bg-blue-100"
                            >
                              -
                            </button>
                            <span className="px-3 text-sm font-bold text-blue-900">{cartItem.quantity}</span>
                            <button
                              onClick={() => updateCartQuantity(product.id, cartItem.quantity + 1)}
                              disabled={cartItem.quantity >= product.current_stock}
                              className="px-3 py-1.5 text-blue-700 font-bold hover:bg-blue-100 disabled:opacity-30"
                            >
                              +
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => addToCart(product)}
                            disabled={isOut}
                            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors shadow-sm"
                          >
                            + Add
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Right: Cart & Checkout Counter (5 cols) */}
          <div className="lg:col-span-5">
            {/* ── Phase 10F: Receipt View — shown after successful sale */}
            {completedBill ? (
              <div id="pos-receipt" className="bg-white border border-gray-200 rounded-xl shadow-md p-5 space-y-4">
                {/* Receipt Header */}
                <div className="text-center border-b border-gray-200 pb-3">
                  <h3 className="text-lg font-bold text-gray-900">StockMind AI</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Kirana POS Receipt</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(completedBill.receiptAt).toLocaleString('en-IN', {
                      day: '2-digit', month: 'short', year: 'numeric',
                      hour: '2-digit', minute: '2-digit', hour12: true,
                    })}
                  </p>
                </div>

                {/* Customer Info */}
                {(completedBill.customerName || completedBill.customerPhone) && (
                  <div className="text-xs text-gray-600 space-y-0.5 border-b border-gray-100 pb-2">
                    {completedBill.customerName && (
                      <p><span className="font-semibold">Customer:</span> {completedBill.customerName}</p>
                    )}
                    {completedBill.customerPhone && (
                      <p><span className="font-semibold">Phone:</span> {completedBill.customerPhone}</p>
                    )}
                  </div>
                )}

                {/* Line Items */}
                <div className="space-y-1.5">
                  <div className="grid grid-cols-12 text-xs font-semibold text-gray-400 uppercase tracking-wider pb-1 border-b border-gray-100">
                    <span className="col-span-5">Item</span>
                    <span className="col-span-2 text-right">Qty</span>
                    <span className="col-span-2 text-right">Price</span>
                    <span className="col-span-3 text-right">Total</span>
                  </div>
                  {completedBill.lines.map((line, idx) => (
                    <div key={idx} className="grid grid-cols-12 text-xs text-gray-800">
                      <span className="col-span-5 font-medium truncate">{line.name}</span>
                      <span className="col-span-2 text-right">{line.quantity}</span>
                      <span className="col-span-2 text-right">₹{line.unitPrice.toFixed(2)}</span>
                      <span className="col-span-3 text-right font-semibold">₹{line.lineTotal.toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                {/* Bill Summary */}
                <div className="border-t border-gray-200 pt-3 space-y-1.5 text-sm">
                  <div className="flex justify-between text-gray-600">
                    <span>Subtotal</span>
                    <span>₹{completedBill.subtotal.toFixed(2)}</span>
                  </div>
                  {completedBill.discount > 0 && (
                    <div className="flex justify-between text-emerald-700">
                      <span>Discount</span>
                      <span>− ₹{completedBill.discount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-base text-gray-900 pt-1 border-t border-gray-200">
                    <span>Grand Total</span>
                    <span className="text-emerald-700">₹{completedBill.grandTotal.toFixed(2)}</span>
                  </div>
                </div>

                {/* Action Buttons — hidden when printing */}
                <div className="print-hide flex gap-3 pt-2">
                  <button
                    onClick={() => window.print()}
                    className="flex-1 py-2 border border-gray-300 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                  >
                    🖨️ Print Bill
                  </button>
                  <button
                    onClick={handleNewSale}
                    className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    🧾 New Sale
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-xl shadow-md p-5 sticky top-4 space-y-4">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <div>
                  <h3 className="font-bold text-gray-900 text-lg flex items-center gap-2">
                    🛒 Counter Cart
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {cartTotals.totalItems} product{cartTotals.totalItems === 1 ? '' : 's'} · {cartTotals.totalUnits} unit{cartTotals.totalUnits === 1 ? '' : 's'}
                  </p>
                </div>
                {cart.length > 0 && (
                  <button
                    onClick={clearCart}
                    className="text-xs text-red-600 hover:text-red-800 font-medium transition-colors"
                  >
                    Clear Cart
                  </button>
                )}
              </div>

              {/* Cart List */}
              <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
                {cart.length === 0 ? (
                  <div className="py-10 text-center border-2 border-dashed border-gray-200 rounded-lg">
                    <p className="text-gray-400 text-sm">Cart is empty.</p>
                    <p className="text-xs text-gray-400 mt-1">Search or use 🎤 Voice Input to build sale.</p>
                  </div>
                ) : (
                  cart.map((item) => {
                    const packInfo = formatPackInfo(item.product)
                    const lineTotal = item.quantity * item.product.price

                    return (
                      <div key={item.product.id} className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h5 className="font-medium text-gray-900 text-sm leading-snug">{item.product.name}</h5>
                            {packInfo && <p className="text-xs text-gray-500">{packInfo}</p>}
                          </div>
                          <button
                            onClick={() => removeFromCart(item.product.id)}
                            className="text-gray-400 hover:text-red-600 text-xs p-1"
                            title="Remove item"
                          >
                            ✕
                          </button>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          {/* Stepper */}
                          <div className="flex items-center border border-gray-300 rounded bg-white overflow-hidden">
                            <button
                              onClick={() => updateCartQuantity(item.product.id, item.quantity - 1)}
                              className="px-2 py-0.5 text-gray-600 hover:bg-gray-100 text-xs font-bold"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min="1"
                              max={item.product.current_stock}
                              value={item.quantity}
                              onChange={(e) => {
                                const val = parseInt(e.target.value, 10)
                                if (!isNaN(val)) updateCartQuantity(item.product.id, val)
                              }}
                              className="w-12 text-center text-xs font-bold text-gray-900 border-none focus:outline-none"
                            />
                            <button
                              onClick={() => updateCartQuantity(item.product.id, item.quantity + 1)}
                              disabled={item.quantity >= item.product.current_stock}
                              className="px-2 py-0.5 text-gray-600 hover:bg-gray-100 text-xs font-bold disabled:opacity-30"
                            >
                              +
                            </button>
                          </div>

                          <div className="text-right">
                            <span className="text-xs text-gray-500 mr-2">@ ₹{item.product.price.toFixed(2)}</span>
                            <span className="font-bold text-gray-900 text-sm">₹{lineTotal.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* ── Phase 10F: Customer Information (Optional) */}
              {cart.length > 0 && (
                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Customer (Optional)</p>
                  <input
                    type="text"
                    placeholder="Customer name"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                  />
                  <input
                    type="tel"
                    placeholder="Phone number"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                  />
                </div>
              )}

              {/* ── Phase 10F: Bill Summary, Discount & Complete Sale */}
              {cart.length > 0 && (
                <div className="border-t border-gray-200 pt-3 space-y-3">
                  {/* Subtotal */}
                  <div className="flex items-center justify-between text-sm text-gray-600">
                    <span>Subtotal</span>
                    <span className="font-semibold">₹{cartTotals.subtotal.toFixed(2)}</span>
                  </div>

                  {/* Discount */}
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-sm text-gray-600 shrink-0">Discount (₹)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={discountInput}
                      onChange={(e) => setDiscountInput(e.target.value)}
                      onBlur={() => {
                        // Clamp on blur: negative → 0, exceeds subtotal → subtotal
                        const val = parseFloat(discountInput) || 0
                        if (val < 0) setDiscountInput('0')
                        else if (val > cartTotals.subtotal)
                          setDiscountInput(cartTotals.subtotal.toFixed(2))
                      }}
                      className="w-28 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 text-right focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                    />
                  </div>

                  {/* Grand Total */}
                  <div className="flex items-center justify-between font-bold text-base text-gray-900 border-t border-gray-100 pt-2">
                    <span>Grand Total</span>
                    <span className="text-xl text-emerald-700">₹{cartTotals.grandTotal.toFixed(2)}</span>
                  </div>

                  <button
                    onClick={handleCompleteSale}
                    disabled={pending}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-base rounded-xl transition-colors shadow-md disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {pending ? (
                      <span>Processing Sale…</span>
                    ) : (
                      <>
                        <span>Complete Sale</span>
                        <span>(₹{cartTotals.grandTotal.toFixed(2)})</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 2: SALES HISTORY ────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="space-y-6">
          {/* KPI Stats widgets */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Total Sales Records</p>
              <h3 className="text-2xl font-bold text-gray-900 mt-1">{stats.totalRecords.toLocaleString()}</h3>
            </div>
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Total Units Sold</p>
              <h3 className="text-2xl font-bold text-gray-900 mt-1">{stats.totalUnits.toLocaleString()}</h3>
            </div>
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Total Sales Revenue</p>
              <h3 className="text-2xl font-bold text-emerald-600 mt-1">₹{stats.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row gap-4">
            <div className="flex-1 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
                <input
                  type="date"
                  value={dateFilter.start}
                  onChange={(e) => setDateFilter((prev) => ({ ...prev, start: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
                <input
                  type="date"
                  value={dateFilter.end}
                  onChange={(e) => setDateFilter((prev) => ({ ...prev, end: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="md:w-64">
              <label className="block text-xs font-medium text-gray-600 mb-1">Filter by Product</label>
              <select
                value={productFilter}
                onChange={(e) => setProductFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Products</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Table */}
          {filteredSales.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-sm">
              <h3 className="text-lg font-medium text-gray-900">No sales transactions found</h3>
              <p className="text-gray-500 text-sm mt-1">Try clearing filters or completing a sale in New Sale POS.</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3.5 text-left font-semibold text-gray-500 uppercase tracking-wider text-xs">Date</th>
                      <th className="px-6 py-3.5 text-left font-semibold text-gray-500 uppercase tracking-wider text-xs">Product</th>
                      <th className="px-6 py-3.5 text-left font-semibold text-gray-500 uppercase tracking-wider text-xs">Source</th>
                      <th className="px-6 py-3.5 text-left font-semibold text-gray-500 uppercase tracking-wider text-xs">Quantity</th>
                      <th className="px-6 py-3.5 text-left font-semibold text-gray-500 uppercase tracking-wider text-xs">Unit Price</th>
                      <th className="px-6 py-3.5 text-left font-semibold text-gray-500 uppercase tracking-wider text-xs">Total Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredSales.map((sale) => (
                      <tr key={sale.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap text-gray-900">{formatDate(sale.sale_date)}</td>
                        <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{sale.product_name}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                              sale.source === 'retail'
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                : sale.source === 'csv'
                                ? 'bg-blue-100 text-blue-800 border-blue-200'
                                : 'bg-amber-100 text-amber-800 border-amber-200'
                            }`}
                          >
                            {sale.source === 'retail' ? 'Counter POS' : sale.source === 'csv' ? 'CSV Import' : 'Demo Set'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-900">{sale.quantity}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-900">₹{sale.unit_price.toFixed(2)}</td>
                        <td className="px-6 py-4 whitespace-nowrap font-bold text-gray-900">₹{(sale.quantity * sale.unit_price).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 3: IMPORT CSV ────────────────────────────────────────────────── */}
      {activeTab === 'csv' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Upload Sales CSV</h3>
            <p className="text-sm text-gray-500">
              CSV file must include columns: <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-800">date</code>,{' '}
              <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-800">product</code>,{' '}
              <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-800">quantity</code>,{' '}
              <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-800">revenue</code>.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleCSVUpload}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
              <button
                onClick={handleDemoGenerate}
                disabled={pending}
                className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-semibold rounded-lg shrink-0 transition-colors disabled:opacity-50"
              >
                Generate Demo Data
              </button>
            </div>
          </div>

          {/* Validation & Preview */}
          {hasParsed && (
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-gray-900">CSV Validation Results</h4>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Found {validRecords.length} valid record{validRecords.length === 1 ? '' : 's'}, {invalidRecords.length} invalid record{invalidRecords.length === 1 ? '' : 's'}.
                  </p>
                </div>

                <button
                  onClick={handleImportSubmit}
                  disabled={pending || validRecords.length === 0}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-lg transition-colors disabled:opacity-40 shadow-sm"
                >
                  {pending ? 'Importing…' : `Import ${validRecords.length} Valid Records`}
                </button>
              </div>

              {/* Records preview table */}
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="min-w-full divide-y divide-gray-200 text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold text-gray-500">Row</th>
                      <th className="px-4 py-2 text-left font-semibold text-gray-500">Date</th>
                      <th className="px-4 py-2 text-left font-semibold text-gray-500">Product</th>
                      <th className="px-4 py-2 text-left font-semibold text-gray-500">Qty</th>
                      <th className="px-4 py-2 text-left font-semibold text-gray-500">Revenue</th>
                      <th className="px-4 py-2 text-left font-semibold text-gray-500">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {csvRecords.map((rec) => (
                      <tr key={rec.rowNumber} className={rec.isValid ? 'bg-emerald-50/40' : 'bg-red-50/40'}>
                        <td className="px-4 py-2 font-mono">{rec.rowNumber}</td>
                        <td className="px-4 py-2">{rec.date}</td>
                        <td className="px-4 py-2 font-medium">{rec.productName}</td>
                        <td className="px-4 py-2">{rec.quantity}</td>
                        <td className="px-4 py-2">₹{rec.revenue}</td>
                        <td className="px-4 py-2">
                          {rec.isValid ? (
                            <span className="text-emerald-700 font-semibold">Ready to Import</span>
                          ) : (
                            <span className="text-red-600">{rec.errors.join('; ')}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
