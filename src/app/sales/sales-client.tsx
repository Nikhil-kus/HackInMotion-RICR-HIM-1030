'use client'

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import Papa from 'papaparse'
import { Sale, importSales, generateDemoSales, createRetailSale } from './actions'
import type { Product } from '@/app/inventory/types'
import { parseSpokenSalesText, normalizeForMatching } from '@/lib/voice-parser'

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface ReceiptLine {
  name: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

interface CompletedBill {
  receiptAt: string
  customerName: string
  customerPhone: string
  lines: ReceiptLine[]
  subtotal: number
  discount: number
  grandTotal: number
  totalUnits: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Maps a lowercase product name to its product artwork SVG. */
function getProductImage(name: string): string {
  const n = name.toLowerCase().trim()
  if (n.includes('maggi') || n.includes('noodle')) return '/products/maggi.svg'
  if (n.includes('kurkure') || n.includes('kurkurey')) return '/products/kurkure.svg'
  if (n.includes('chip') || n.includes('lays') || n.includes('bingo')) return '/products/chips.svg'
  if (n.includes('bread') || n.includes('pav') || n.includes('bun')) return '/products/bread.svg'
  if (n.includes('milk') || n.includes('doodh') || n.includes('दूध')) return '/products/milk.svg'
  return '/products/placeholder.svg'
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

// ─── ProductCard ─────────────────────────────────────────────────────────────

interface ProductCardProps {
  product: Product
  cartItem: CartItem | undefined
  onAdd: (product: Product) => void
  onUpdate: (productId: string, qty: number) => void
}

function ProductCard({ product, cartItem, onAdd, onUpdate }: ProductCardProps) {
  const isOut = product.current_stock <= 0
  const isLow = product.current_stock > 0 && product.current_stock < 10
  const packInfo = formatPackInfo(product)
  const imgSrc = getProductImage(product.name)

  return (
    <div
      className={`bg-white rounded-2xl border flex flex-col overflow-hidden transition-shadow hover:shadow-md ${
        isOut ? 'opacity-60 border-gray-200' : 'border-gray-200 shadow-sm'
      }`}
    >
      {/* Product Image */}
      <div className="relative w-full aspect-square bg-gray-50 overflow-hidden">
        <Image
          src={imgSrc}
          alt={product.name}
          fill
          className="object-contain p-3"
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          onError={() => {/* fallback handled by src default */}}
        />
        {isOut && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-1 rounded-full border border-red-200">
              Out of Stock
            </span>
          </div>
        )}
        {isLow && !isOut && (
          <div className="absolute top-2 right-2">
            <span className="bg-amber-100 text-amber-700 text-xs font-semibold px-1.5 py-0.5 rounded-full border border-amber-200">
              Low
            </span>
          </div>
        )}
      </div>

      {/* Card Body */}
      <div className="flex flex-col flex-1 p-3 gap-1">
        <h4 className="font-semibold text-gray-900 text-sm leading-tight line-clamp-2">{product.name}</h4>
        {packInfo && <p className="text-xs text-gray-400 leading-tight line-clamp-1">{packInfo}</p>}
        {!isOut && (
          <p className="text-xs text-gray-400 mt-0.5">
            {isLow ? `केवल ${product.current_stock} बचे` : `Stock: ${product.current_stock}`}
          </p>
        )}

        {/* Price + Add control */}
        <div className="flex items-center justify-between mt-auto pt-2">
          <span className="text-base font-bold text-emerald-700">₹{product.price.toFixed(0)}</span>

          {isOut ? (
            <span className="text-xs text-red-500 font-medium">Unavailable</span>
          ) : cartItem ? (
            <div className="flex items-center gap-0 bg-blue-600 rounded-xl overflow-hidden">
              <button
                onClick={() => onUpdate(product.id, cartItem.quantity - 1)}
                className="w-8 h-8 flex items-center justify-center text-white font-bold text-lg hover:bg-blue-700 transition-colors"
                aria-label={`Remove one ${product.name}`}
              >
                −
              </button>
              <span className="w-7 text-center text-sm font-bold text-white">{cartItem.quantity}</span>
              <button
                onClick={() => onUpdate(product.id, cartItem.quantity + 1)}
                disabled={cartItem.quantity >= product.current_stock}
                className="w-8 h-8 flex items-center justify-center text-white font-bold text-lg hover:bg-blue-700 transition-colors disabled:opacity-40"
                aria-label={`Add one more ${product.name}`}
              >
                +
              </button>
            </div>
          ) : (
            <button
              onClick={() => onAdd(product)}
              className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-1.5 rounded-xl transition-colors shadow-sm"
              aria-label={`Add ${product.name} to cart`}
            >
              + जोड़ें
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── CartSheet ────────────────────────────────────────────────────────────────
// Shown when user taps the bottom cart bar on mobile, or always-visible on desktop.

interface CartSheetProps {
  cart: CartItem[]
  cartTotals: { totalItems: number; totalUnits: number; subtotal: number; discountAmt: number; grandTotal: number }
  customerName: string
  customerPhone: string
  discountInput: string
  pending: boolean
  completedBill: CompletedBill | null
  onClose: () => void
  onUpdate: (productId: string, qty: number) => void
  onRemove: (productId: string) => void
  onClear: () => void
  onCustomerName: (v: string) => void
  onCustomerPhone: (v: string) => void
  onDiscount: (v: string) => void
  onDiscountBlur: () => void
  onCompleteSale: () => void
  onNewSale: () => void
}

function CartSheet({
  cart, cartTotals, customerName, customerPhone, discountInput,
  pending, completedBill, onClose, onUpdate, onRemove, onClear,
  onCustomerName, onCustomerPhone, onDiscount, onDiscountBlur,
  onCompleteSale, onNewSale,
}: CartSheetProps) {

  if (completedBill) {
    return (
      <div id="pos-receipt" className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">🧾 Bill / Receipt</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 print-hide" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <div className="text-center">
            <p className="text-xs text-gray-400">
              {new Date(completedBill.receiptAt).toLocaleString('en-IN', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: true,
              })}
            </p>
          </div>
          {(completedBill.customerName || completedBill.customerPhone) && (
            <div className="text-xs text-gray-600 bg-gray-50 rounded-lg p-2 space-y-0.5">
              {completedBill.customerName && <p><span className="font-semibold">Customer:</span> {completedBill.customerName}</p>}
              {completedBill.customerPhone && <p><span className="font-semibold">Phone:</span> {completedBill.customerPhone}</p>}
            </div>
          )}
          <div className="space-y-1.5">
            <div className="grid grid-cols-12 text-xs font-semibold text-gray-400 uppercase border-b border-gray-100 pb-1">
              <span className="col-span-5">Item</span>
              <span className="col-span-2 text-right">Qty</span>
              <span className="col-span-2 text-right">Price</span>
              <span className="col-span-3 text-right">Total</span>
            </div>
            {completedBill.lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-12 text-xs text-gray-800">
                <span className="col-span-5 font-medium truncate">{line.name}</span>
                <span className="col-span-2 text-right">{line.quantity}</span>
                <span className="col-span-2 text-right">₹{line.unitPrice.toFixed(0)}</span>
                <span className="col-span-3 text-right font-semibold">₹{line.lineTotal.toFixed(0)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-200 pt-2 space-y-1.5 text-sm">
            <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>₹{completedBill.subtotal.toFixed(0)}</span></div>
            {completedBill.discount > 0 && (
              <div className="flex justify-between text-emerald-700"><span>Discount</span><span>− ₹{completedBill.discount.toFixed(0)}</span></div>
            )}
            <div className="flex justify-between font-bold text-base text-gray-900 border-t border-gray-200 pt-1">
              <span>कुल / Grand Total</span>
              <span className="text-emerald-700">₹{completedBill.grandTotal.toFixed(0)}</span>
            </div>
          </div>
        </div>

        <div className="print-hide px-4 pb-4 pt-2 border-t border-gray-100 flex gap-3">
          <button onClick={() => window.print()} className="flex-1 py-2.5 border border-gray-300 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-50">🖨️ Print</button>
          <button onClick={onNewSale} className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl">🧾 नई बिक्री</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-100">
        <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
          🛒 कार्ट
          {cartTotals.totalUnits > 0 && (
            <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">{cartTotals.totalUnits}</span>
          )}
        </h3>
        <div className="flex items-center gap-3">
          {cart.length > 0 && (
            <button onClick={onClear} className="text-xs text-red-500 hover:text-red-700 font-medium">Clear</button>
          )}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 lg:hidden" aria-label="Close cart">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
        {cart.length === 0 ? (
          <div className="py-12 text-center">
            <div className="text-4xl mb-3">🛒</div>
            <p className="text-gray-400 text-sm">कार्ट खाली है</p>
            <p className="text-xs text-gray-300 mt-1">Products add करें या Voice से बोलें</p>
          </div>
        ) : (
          cart.map((item) => {
            const packInfo = formatPackInfo(item.product)
            return (
              <div key={item.product.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
                <div className="relative w-10 h-10 shrink-0 rounded-lg overflow-hidden bg-white border border-gray-100">
                  <Image src={getProductImage(item.product.name)} alt={item.product.name} fill className="object-contain p-1" sizes="40px"/>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 leading-tight truncate">{item.product.name}</p>
                  {packInfo && <p className="text-xs text-gray-400 truncate">{packInfo}</p>}
                  <p className="text-xs text-gray-500 mt-0.5">₹{item.product.price.toFixed(0)} × {item.quantity} = <span className="font-bold text-gray-800">₹{(item.quantity * item.product.price).toFixed(0)}</span></p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <button onClick={() => onRemove(item.product.id)} className="text-gray-300 hover:text-red-500 transition-colors" aria-label={`Remove ${item.product.name}`}>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                  </button>
                  <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <button onClick={() => onUpdate(item.product.id, item.quantity - 1)} className="w-7 h-7 flex items-center justify-center text-gray-600 hover:bg-gray-100 font-bold text-sm">−</button>
                    <span className="w-6 text-center text-xs font-bold text-gray-900">{item.quantity}</span>
                    <button onClick={() => onUpdate(item.product.id, item.quantity + 1)} disabled={item.quantity >= item.product.current_stock} className="w-7 h-7 flex items-center justify-center text-gray-600 hover:bg-gray-100 font-bold text-sm disabled:opacity-30">+</button>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {cart.length > 0 && (
        <div className="px-4 pb-4 pt-2 border-t border-gray-100 space-y-3">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Customer (Optional)</p>
            <input type="text" placeholder="Customer name" value={customerName} onChange={(e) => onCustomerName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <input type="tel" placeholder="Phone number" value={customerPhone} onChange={(e) => onCustomerPhone(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div className="space-y-1.5 text-sm border-t border-gray-100 pt-2">
            <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>₹{cartTotals.subtotal.toFixed(0)}</span></div>
            <div className="flex items-center justify-between gap-3">
              <label className="text-gray-600 shrink-0">Discount (₹)</label>
              <input type="number" min="0" step="1" value={discountInput} onChange={(e) => onDiscount(e.target.value)} onBlur={onDiscountBlur}
                className="w-24 px-2 py-1 border border-gray-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="flex justify-between font-bold text-base text-gray-900 border-t border-gray-100 pt-1">
              <span>कुल</span>
              <span className="text-emerald-700">₹{cartTotals.grandTotal.toFixed(0)}</span>
            </div>
          </div>
          <button onClick={onCompleteSale} disabled={pending}
            className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-base rounded-2xl transition-colors shadow-md flex items-center justify-center gap-2">
            {pending ? 'Processing…' : <><span>बिक्री पूरी करें</span><span className="text-emerald-200 font-normal text-sm">(₹{cartTotals.grandTotal.toFixed(0)})</span></>}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SalesClient({ initialSales, initialStats, products, fetchError }: SalesClientProps) {
  const router = useRouter()
  const [sales] = useState<Sale[]>(initialSales)
  const [stats] = useState(initialStats)
  const [activeTab, setActiveTab] = useState<'new_sale' | 'history' | 'csv'>('new_sale')

  // History filters
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' })
  const [productFilter, setProductFilter] = useState('')
  const [pending, setPending] = useState(false)

  // Notifications
  const [errorMsg, setErrorMsg] = useState<string | null>(fetchError || null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // POS state
  const [posSearch, setPosSearch] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)

  // Customer & billing
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [discountInput, setDiscountInput] = useState('0')
  const [completedBill, setCompletedBill] = useState<CompletedBill | null>(null)

  // Voice state
  const [isListening, setIsListening] = useState(false)
  const [speechTranscript, setSpeechTranscript] = useState('')
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [voiceUnmatchedItems, setVoiceUnmatchedItems] = useState<string[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)

  // CSV state
  const [csvRecords, setCsvRecords] = useState<ValidatedRecord[]>([])
  const [hasParsed, setHasParsed] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const showToast = useCallback((message: string, isError = false) => {
    if (isError) { setErrorMsg(message); setSuccessMsg(null) }
    else { setSuccessMsg(message); setErrorMsg(null) }
    setTimeout(() => { setErrorMsg(null); setSuccessMsg(null) }, 6000)
  }, [])

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop() } catch { /* ignore */ }
      }
    }
  }, [])

  const productMap = useMemo(() => {
    const map = new Map<string, Product>()
    products.forEach((p) => map.set(p.name.trim().toLowerCase(), p))
    return map
  }, [products])

  // ── Multi-field search: name, brand, barcode, alias
  const filteredPosProducts = useMemo(() => {
    const q = posSearch.toLowerCase().trim()
    if (!q) return products
    return products.filter((p) => {
      if (p.name.toLowerCase().includes(q)) return true
      if (p.brand?.toLowerCase().includes(q)) return true
      if (p.barcode?.toLowerCase().includes(q)) return true
      if (p.aliases?.some((a) => a.alias.toLowerCase().includes(q))) return true
      return false
    })
  }, [products, posSearch])

  // ── 8-tier product matcher (voice)
  const matchProductFromQuery = useCallback((itemQuery: string): Product | null => {
    if (!itemQuery.trim()) return null
    const q = itemQuery.toLowerCase().trim()
    for (const p of products) { if (p.name.toLowerCase() === q) return p }
    for (const p of products) { if (p.aliases?.some((a) => a.alias.toLowerCase() === q)) return p }
    for (const p of products) { if (p.barcode?.toLowerCase() === q) return p }
    for (const p of products) { if (p.brand?.toLowerCase() === q) return p }
    const qNorm = normalizeForMatching(itemQuery)
    if (!qNorm) return null
    for (const p of products) { if (normalizeForMatching(p.name) === qNorm) return p }
    for (const p of products) { if (p.aliases?.some((a) => normalizeForMatching(a.alias) === qNorm)) return p }
    for (const p of products) { if (p.brand && normalizeForMatching(p.brand) === qNorm) return p }
    const candidates: Array<{ product: Product; score: number }> = []
    for (const p of products) {
      const pNameNorm = normalizeForMatching(p.name)
      const pBrandNorm = p.brand ? normalizeForMatching(p.brand) : ''
      if (pNameNorm && (pNameNorm.includes(qNorm) || qNorm.includes(pNameNorm))) {
        candidates.push({ product: p, score: pNameNorm.length })
      } else if (pBrandNorm && (pBrandNorm.includes(qNorm) || qNorm.includes(pBrandNorm))) {
        candidates.push({ product: p, score: pBrandNorm.length })
      } else if (p.aliases?.some((a) => { const an = normalizeForMatching(a.alias); return an && (an.includes(qNorm) || qNorm.includes(an)) })) {
        candidates.push({ product: p, score: 1 })
      }
    }
    if (candidates.length === 1) return candidates[0].product
    if (candidates.length > 1) {
      candidates.sort((a, b) => b.score - a.score)
      if (candidates[0].score > candidates[1].score) return candidates[0].product
    }
    return null
  }, [products])

  // ── Voice transcript processor
  const processSpokenTranscript = useCallback((transcriptText: string) => {
    setSpeechTranscript(transcriptText)
    const parsedItems = parseSpokenSalesText(transcriptText)
    if (parsedItems.length === 0) return
    const unmatched: string[] = []
    parsedItems.forEach(({ quantity, itemQuery }) => {
      const matched = matchProductFromQuery(itemQuery)
      if (matched) {
        if (matched.current_stock <= 0) { showToast(`"${matched.name}" is out of stock.`, true); return }
        setCart((prev) => {
          const existingIndex = prev.findIndex((c) => c.product.id === matched.id)
          if (existingIndex >= 0) {
            const combined = prev[existingIndex].quantity + quantity
            const capped = Math.min(combined, matched.current_stock)
            if (combined > matched.current_stock) {
              setTimeout(() => showToast(`Stock limit for "${matched.name}": ${matched.current_stock} units max.`, true), 0)
            }
            const updated = [...prev]
            updated[existingIndex] = { ...updated[existingIndex], quantity: capped }
            return updated
          }
          return [...prev, { product: matched, quantity: Math.min(quantity, matched.current_stock) }]
        })
      } else {
        unmatched.push(itemQuery)
      }
    })
    setVoiceUnmatchedItems(unmatched)
  }, [matchProductFromQuery, showToast])

  // ── Voice toggle
  const toggleSpeechRecognition = useCallback(() => {
    if (isListening) {
      try { recognitionRef.current?.stop() } catch { /* ignore */ }
      setIsListening(false)
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      showToast('Speech recognition requires Chrome or Edge.', true)
      return
    }
    try {
      const recognition = new SpeechRecognition()
      recognition.lang = 'hi-IN'
      recognition.continuous = true
      recognition.interimResults = true
      recognition.onstart = () => { setIsListening(true); setVoiceError(null); setSpeechTranscript(''); setVoiceUnmatchedItems([]) }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onresult = (event: any) => {
        let t = ''
        for (let i = event.resultIndex; i < event.results.length; i++) t += event.results[i][0].transcript
        if (t.trim()) processSpokenTranscript(t)
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onerror = (event: any) => {
        if (event.error !== 'no-speech') { setVoiceError(`Voice error: ${event.error}`); setIsListening(false) }
      }
      recognition.onend = () => setIsListening(false)
      recognitionRef.current = recognition
      recognition.start()
    } catch { showToast('Could not access microphone.', true) }
  }, [isListening, processSpokenTranscript, showToast])

  // ── Cart handlers
  const addToCart = useCallback((product: Product) => {
    if (product.current_stock <= 0) { showToast(`"${product.name}" is out of stock.`, true); return }
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id)
      if (existing) {
        if (existing.quantity >= product.current_stock) { showToast(`Max stock: ${product.current_stock}`, true); return prev }
        return prev.map((item) => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item)
      }
      return [...prev, { product, quantity: 1 }]
    })
  }, [showToast])

  const updateCartQuantity = useCallback((productId: string, newQty: number) => {
    const item = cart.find((c) => c.product.id === productId)
    if (!item) return
    if (newQty <= 0) { setCart((prev) => prev.filter((c) => c.product.id !== productId)); return }
    if (newQty > item.product.current_stock) { showToast(`Cannot exceed ${item.product.current_stock} units.`, true); return }
    setCart((prev) => prev.map((c) => c.product.id === productId ? { ...c, quantity: newQty } : c))
  }, [cart, showToast])

  const removeFromCart = useCallback((productId: string) => {
    setCart((prev) => prev.filter((c) => c.product.id !== productId))
  }, [])

  const clearCart = useCallback(() => setCart([]), [])

  // ── Barcode scanner (Enter key on search field)
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    const query = posSearch.trim()
    if (!query) return
    const barcodeMatch = products.find((p) => p.barcode && p.barcode.toLowerCase() === query.toLowerCase())
    if (barcodeMatch) {
      e.preventDefault()
      if (barcodeMatch.current_stock <= 0) { showToast(`"${barcodeMatch.name}" is out of stock.`, true); setPosSearch(''); return }
      setCart((prev) => {
        const existingIndex = prev.findIndex((c) => c.product.id === barcodeMatch.id)
        if (existingIndex >= 0) {
          const cq = prev[existingIndex].quantity
          if (cq >= barcodeMatch.current_stock) { setTimeout(() => showToast(`Stock limit: ${barcodeMatch.current_stock}`, true), 0); return prev }
          const updated = [...prev]; updated[existingIndex] = { ...updated[existingIndex], quantity: cq + 1 }; return updated
        }
        return [...prev, { product: barcodeMatch, quantity: 1 }]
      })
      showToast(`Added "${barcodeMatch.name}"`)
      setPosSearch('')
    }
  }, [posSearch, products, showToast])

  // ── Cart totals
  const cartTotals = useMemo(() => {
    const totalItems = cart.length
    const totalUnits = cart.reduce((sum, c) => sum + c.quantity, 0)
    const subtotal = cart.reduce((sum, c) => sum + c.quantity * c.product.price, 0)
    const discountAmt = Math.min(Math.max(parseFloat(discountInput) || 0, 0), subtotal)
    const grandTotal = subtotal - discountAmt
    return { totalItems, totalUnits, subtotal, discountAmt, grandTotal }
  }, [cart, discountInput])

  // ── Complete sale (atomic RPC — unchanged)
  const handleCompleteSale = async () => {
    if (cart.length === 0) return
    const discountVal = parseFloat(discountInput) || 0
    if (discountVal < 0) { showToast('Discount cannot be negative.', true); return }
    if (discountVal > cartTotals.subtotal) { showToast('Discount cannot exceed subtotal.', true); return }
    setPending(true); setErrorMsg(null)
    const cartPayload = cart.map((item) => ({ product_id: item.product.id, quantity: item.quantity }))
    const billSnapshot = {
      customerName: customerName.trim(), customerPhone: customerPhone.trim(),
      lines: cart.map((item) => ({ name: item.product.name, quantity: item.quantity, unitPrice: item.product.price, lineTotal: item.quantity * item.product.price })),
      subtotal: cartTotals.subtotal, discount: cartTotals.discountAmt, grandTotal: cartTotals.grandTotal, totalUnits: cartTotals.totalUnits,
    }
    const result = await createRetailSale(cartPayload)
    if (result.error) { showToast(result.error, true); setPending(false) }
    else {
      setCompletedBill({ receiptAt: new Date().toISOString(), ...billSnapshot, grandTotal: Number(result.totalRevenue ?? billSnapshot.grandTotal) })
      setCart([]); setCustomerName(''); setCustomerPhone(''); setDiscountInput('0'); setPending(false)
      setCartOpen(true) // show receipt in cart sheet
      router.refresh()
    }
  }

  const handleNewSale = useCallback(() => {
    setCompletedBill(null); setCart([]); setCustomerName(''); setCustomerPhone('')
    setDiscountInput('0'); setErrorMsg(null); setSuccessMsg(null); setCartOpen(false)
  }, [])

  // ── Sales history filter
  const filteredSales = useMemo(() => {
    return sales.filter((sale) => {
      const matchesProduct = productFilter === '' || sale.product_id === productFilter
      let matchesDate = true
      if (dateFilter.start) matchesDate = matchesDate && new Date(sale.sale_date) >= new Date(dateFilter.start)
      if (dateFilter.end) {
        const endOfDay = new Date(dateFilter.end); endOfDay.setHours(23, 59, 59, 999)
        matchesDate = matchesDate && new Date(sale.sale_date) <= endOfDay
      }
      return matchesProduct && matchesDate
    })
  }, [sales, productFilter, dateFilter])

  // ── CSV helpers
  const { validRecords, invalidRecords } = useMemo(() => {
    const valid: ValidatedRecord[] = [], invalid: ValidatedRecord[] = []
    csvRecords.forEach((rec) => (rec.isValid ? valid : invalid).push(rec))
    return { validRecords: valid, invalidRecords: invalid }
  }, [csvRecords])

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setErrorMsg(null); setCsvRecords([]); setHasParsed(false)
    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) { showToast('Please upload a .csv file.', true); if (fileInputRef.current) fileInputRef.current.value = ''; return }
    Papa.parse<CSVRow>(file, {
      header: true, skipEmptyLines: true,
      complete: (results) => {
        if (results.data.length === 0) { showToast('CSV file is empty.', true); return }
        const headers = results.meta.fields || []
        const required = ['date', 'product', 'quantity', 'revenue']
        const missing = required.filter((h) => !headers.some((fh) => fh.trim().toLowerCase() === h))
        if (missing.length > 0) { showToast(`Missing columns: ${missing.join(', ')}`, true); return }
        const validated: ValidatedRecord[] = results.data.map((row, index) => {
          const rowNumber = index + 2; const errors: string[] = []
          const dk = headers.find((h) => h.trim().toLowerCase() === 'date') || 'date'
          const pk = headers.find((h) => h.trim().toLowerCase() === 'product') || 'product'
          const qk = headers.find((h) => h.trim().toLowerCase() === 'quantity') || 'quantity'
          const rk = headers.find((h) => h.trim().toLowerCase() === 'revenue') || 'revenue'
          const rawDate = row[dk]?.toString().trim() || ''; const rawProduct = row[pk]?.toString().trim() || ''
          const rawQuantity = row[qk]?.toString().trim() || ''; const rawRevenue = row[rk]?.toString().trim() || ''
          let matchedProduct: Product | undefined
          if (!rawProduct) { errors.push('Product name is missing.') }
          else { matchedProduct = productMap.get(rawProduct.toLowerCase()); if (!matchedProduct) errors.push(`Product not found: "${rawProduct}"`) }
          const dateObj = new Date(rawDate)
          if (!rawDate) errors.push('Date is missing.'); else if (isNaN(dateObj.getTime())) errors.push(`Invalid date: "${rawDate}"`)
          const quantity = parseInt(rawQuantity, 10)
          if (!rawQuantity) errors.push('Quantity missing.'); else if (isNaN(quantity) || quantity <= 0) errors.push(`Invalid quantity: "${rawQuantity}"`)
          const revenue = parseFloat(rawRevenue)
          if (!rawRevenue) errors.push('Revenue missing.'); else if (isNaN(revenue) || revenue < 0) errors.push(`Invalid revenue: "${rawRevenue}"`)
          const unitPrice = quantity > 0 ? revenue / quantity : 0
          return { rowNumber, date: dateObj.toISOString().split('T')[0], productName: rawProduct, productId: matchedProduct?.id || '', quantity, revenue, unitPrice, isValid: errors.length === 0, errors }
        })
        setCsvRecords(validated); setHasParsed(true)
      },
      error: (error) => showToast(`CSV parse error: ${error.message}`, true),
    })
  }

  async function handleImportSubmit() {
    if (validRecords.length === 0) return
    setPending(true); setErrorMsg(null)
    const payload = validRecords.map((r) => ({ product_id: r.productId, sale_date: r.date, quantity: r.quantity, unit_price: r.unitPrice }))
    const result = await importSales(payload)
    if (result.error) { showToast(result.error, true); setPending(false) }
    else {
      showToast(`Imported ${result.importedCount} records.${result.skippedCount ? ` ${result.skippedCount} duplicates skipped.` : ''}`)
      setCsvRecords([]); setHasParsed(false); if (fileInputRef.current) fileInputRef.current.value = ''; window.location.reload()
    }
  }

  async function handleDemoGenerate() {
    if (products.length === 0) { showToast('No products found. Add products in Inventory first.', true); return }
    setPending(true); setErrorMsg(null)
    const result = await generateDemoSales(products.map((p) => ({ id: p.id, name: p.name, price: p.price })))
    if (result.error) { showToast(result.error, true); setPending(false) }
    else { showToast(result.message || 'Demo data generated!'); window.location.reload() }
  }

  const discountBlurHandler = useCallback(() => {
    const val = parseFloat(discountInput) || 0
    if (val < 0) setDiscountInput('0')
    else if (val > cartTotals.subtotal) setDiscountInput(cartTotals.subtotal.toFixed(2))
  }, [discountInput, cartTotals.subtotal])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-0">
      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #pos-receipt, #pos-receipt * { visibility: visible !important; }
          #pos-receipt { position: fixed !important; top:0 !important; left:0 !important; width:80mm !important; padding:8mm !important; font-size:11px !important; background:white !important; box-shadow:none !important; border:none !important; }
          .print-hide { display: none !important; }
        }
      `}</style>

      {/* ── Top navigation tabs */}
      <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-2xl mb-4 w-fit mx-auto sm:mx-0">
        {([['new_sale', '🛒', 'POS / बिक्री'], ['history', '📊', 'History'], ['csv', '📥', 'Import CSV']] as const).map(([tab, icon, label]) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl transition-colors ${activeTab === tab ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
            <span>{icon}</span><span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* ── Toasts */}
      {errorMsg && (
        <div className="mb-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="ml-3 text-red-500 hover:text-red-700 shrink-0">✕</button>
        </div>
      )}
      {successMsg && (
        <div className="mb-3 bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="ml-3 text-emerald-500 hover:text-emerald-700 shrink-0">✕</button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 1 — NEW SALE (POS)
          Mobile: product grid + bottom cart bar + slide-up cart sheet
          Desktop: product grid (left) + sticky cart panel (right)
         ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'new_sale' && (
        <div className="flex flex-col lg:flex-row gap-0 lg:gap-6 relative">

          {/* LEFT: Product Browser */}
          <div className="flex-1 flex flex-col min-w-0 pb-24 lg:pb-0">

            {/* Search + Voice row */}
            <div className="flex items-center gap-2 mb-3">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="खोजें — name, brand, barcode, दूध…"
                  value={posSearch}
                  onChange={(e) => setPosSearch(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  className="w-full pl-10 pr-9 py-3 border border-gray-200 rounded-2xl text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  aria-label="Search products"
                  autoFocus
                />
                <span className="absolute left-3.5 top-3.5 text-gray-400 pointer-events-none">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                  </svg>
                </span>
                {posSearch && (
                  <button onClick={() => setPosSearch('')} className="absolute right-3.5 top-3.5 text-gray-400 hover:text-gray-600" aria-label="Clear search">✕</button>
                )}
              </div>

              {/* Microphone button */}
              <button
                onClick={toggleSpeechRecognition}
                aria-label={isListening ? 'Stop voice input' : 'बोलकर बिक्री करें'}
                title={isListening ? 'Stop' : 'बोलकर बिक्री करें'}
                className={`shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center transition-all shadow-sm ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-400 hover:text-blue-600'}`}
              >
                <svg className="w-5 h-5" fill={isListening ? 'white' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 016 0v6a3 3 0 01-3 3z"/>
                </svg>
              </button>
            </div>

            {/* Voice listening status */}
            {isListening && (
              <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-2xl">
                <div className="flex items-center gap-2 text-xs font-bold text-red-700 mb-1">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-ping inline-block"></span>
                  <span>सुन रहा हूँ… बोलें: &ldquo;दो दूध और तीन कुरकुरे&rdquo;</span>
                </div>
                {speechTranscript && <p className="text-sm text-gray-800 bg-white rounded-lg px-3 py-1.5 border border-red-100 italic">&ldquo;{speechTranscript}&rdquo;</p>}
              </div>
            )}
            {voiceError && (
              <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl flex justify-between items-center">
                <span>{voiceError}</span>
                <button onClick={() => setVoiceError(null)} className="ml-2 font-bold text-amber-600 hover:text-amber-800">✕</button>
              </div>
            )}
            {voiceUnmatchedItems.length > 0 && (
              <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-xl space-y-1">
                <span className="font-bold">⚠️ Not matched:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {voiceUnmatchedItems.map((item, idx) => (
                    <span key={idx} className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-mono">{item}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Product grid: 2 cols mobile, 3 tablet, 4-5 desktop */}
            {filteredPosProducts.length === 0 ? (
              <div className="flex-1 flex items-center justify-center py-16 border-2 border-dashed border-gray-200 rounded-2xl">
                <div className="text-center">
                  <div className="text-4xl mb-3">🔍</div>
                  <p className="text-gray-500 text-sm">No products found for &ldquo;{posSearch}&rdquo;</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                {filteredPosProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    cartItem={cart.find((c) => c.product.id === product.id)}
                    onAdd={addToCart}
                    onUpdate={updateCartQuantity}
                  />
                ))}
              </div>
            )}
          </div>

          {/* RIGHT: Desktop cart panel (hidden on mobile — use bottom bar instead) */}
          <div className="hidden lg:flex lg:w-80 xl:w-96 shrink-0 flex-col">
            <div className="sticky top-4 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden" style={{ maxHeight: 'calc(100vh - 6rem)' }}>
              <CartSheet
                cart={cart} cartTotals={cartTotals}
                customerName={customerName} customerPhone={customerPhone}
                discountInput={discountInput} pending={pending} completedBill={completedBill}
                onClose={() => {}}
                onUpdate={updateCartQuantity} onRemove={removeFromCart} onClear={clearCart}
                onCustomerName={setCustomerName} onCustomerPhone={setCustomerPhone}
                onDiscount={setDiscountInput} onDiscountBlur={discountBlurHandler}
                onCompleteSale={handleCompleteSale} onNewSale={handleNewSale}
              />
            </div>
          </div>

          {/* MOBILE: Bottom cart bar */}
          {cart.length > 0 && !cartOpen && (
            <button
              onClick={() => setCartOpen(true)}
              className="lg:hidden fixed bottom-0 left-0 right-0 z-30 mx-3 mb-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl shadow-xl px-5 py-4 flex items-center justify-between transition-colors"
              aria-label="View cart"
            >
              <div className="flex items-center gap-3">
                <span className="bg-white text-blue-700 text-xs font-extrabold w-6 h-6 rounded-full flex items-center justify-center">{cartTotals.totalUnits}</span>
                <span className="font-semibold text-sm">{cartTotals.totalItems} item{cartTotals.totalItems !== 1 ? 's' : ''}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-bold text-base">₹{cartTotals.grandTotal.toFixed(0)}</span>
                <span className="text-blue-200 text-sm font-semibold">कार्ट देखें →</span>
              </div>
            </button>
          )}

          {/* MOBILE: Cart sheet overlay */}
          {cartOpen && (
            <div className="lg:hidden fixed inset-0 z-40 flex flex-col justify-end">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !completedBill && setCartOpen(false)} />
              <div className="relative bg-white rounded-t-3xl shadow-2xl flex flex-col" style={{ maxHeight: '90dvh' }}>
                <CartSheet
                  cart={cart} cartTotals={cartTotals}
                  customerName={customerName} customerPhone={customerPhone}
                  discountInput={discountInput} pending={pending} completedBill={completedBill}
                  onClose={() => setCartOpen(false)}
                  onUpdate={updateCartQuantity} onRemove={removeFromCart} onClear={clearCart}
                  onCustomerName={setCustomerName} onCustomerPhone={setCustomerPhone}
                  onDiscount={setDiscountInput} onDiscountBlur={discountBlurHandler}
                  onCompleteSale={handleCompleteSale} onNewSale={handleNewSale}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 2 — SALES HISTORY
         ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'history' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: 'Total Records', value: stats.totalRecords.toLocaleString(), color: 'text-gray-900' },
              { label: 'Total Units Sold', value: stats.totalUnits.toLocaleString(), color: 'text-gray-900' },
              { label: 'Total Revenue', value: `₹${stats.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: 'text-emerald-600' },
            ].map((kpi) => (
              <div key={kpi.label} className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{kpi.label}</p>
                <h3 className={`text-2xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</h3>
              </div>
            ))}
          </div>

          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex flex-col md:flex-row gap-4">
            <div className="flex-1 grid grid-cols-2 gap-4">
              {[['Start Date', 'start'], ['End Date', 'end']].map(([label, key]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  <input type="date" value={dateFilter[key as 'start' | 'end']}
                    onChange={(e) => setDateFilter((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
                </div>
              ))}
            </div>
            <div className="md:w-64">
              <label className="block text-xs font-medium text-gray-600 mb-1">Filter by Product</label>
              <select value={productFilter} onChange={(e) => setProductFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">All Products</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          {filteredSales.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center shadow-sm">
              <p className="text-lg font-medium text-gray-900">No sales found</p>
              <p className="text-gray-400 text-sm mt-1">Clear filters or complete a sale in the POS tab.</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Date', 'Product', 'Source', 'Qty', 'Unit Price', 'Total'].map((h) => (
                        <th key={h} className="px-4 py-3 text-left font-semibold text-gray-500 uppercase tracking-wider text-xs">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {filteredSales.map((sale) => (
                      <tr key={sale.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap text-gray-700">{formatDate(sale.sale_date)}</td>
                        <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-900">{sale.product_name}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                            sale.source === 'retail' ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                            : sale.source === 'csv' ? 'bg-blue-100 text-blue-800 border-blue-200'
                            : 'bg-amber-100 text-amber-800 border-amber-200'}`}>
                            {sale.source === 'retail' ? 'Counter POS' : sale.source === 'csv' ? 'CSV Import' : 'Demo'}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-700">{sale.quantity}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-700">₹{sale.unit_price.toFixed(2)}</td>
                        <td className="px-4 py-3 whitespace-nowrap font-bold text-gray-900">₹{(sale.quantity * sale.unit_price).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 3 — IMPORT CSV
         ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'csv' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Upload Sales CSV</h3>
            <p className="text-sm text-gray-500">
              Required columns:{' '}
              {['date', 'product', 'quantity', 'revenue'].map((c) => (
                <code key={c} className="bg-gray-100 px-1 py-0.5 rounded text-gray-800 mx-0.5">{c}</code>
              ))}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
              <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleCSVUpload}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"/>
              <button onClick={handleDemoGenerate} disabled={pending}
                className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-semibold rounded-xl shrink-0 transition-colors disabled:opacity-50">
                Generate Demo Data
              </button>
            </div>
          </div>

          {hasParsed && (
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-gray-900">Validation Results</h4>
                  <p className="text-xs text-gray-500 mt-0.5">{validRecords.length} valid · {invalidRecords.length} invalid</p>
                </div>
                <button onClick={handleImportSubmit} disabled={pending || validRecords.length === 0}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl transition-colors disabled:opacity-40 shadow-sm">
                  {pending ? 'Importing…' : `Import ${validRecords.length} Records`}
                </button>
              </div>
              <div className="overflow-x-auto border border-gray-200 rounded-xl">
                <table className="min-w-full divide-y divide-gray-200 text-xs">
                  <thead className="bg-gray-50">
                    <tr>{['Row', 'Date', 'Product', 'Qty', 'Revenue', 'Status'].map((h) => (
                      <th key={h} className="px-4 py-2 text-left font-semibold text-gray-500">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {csvRecords.map((rec) => (
                      <tr key={rec.rowNumber} className={rec.isValid ? 'bg-emerald-50/40' : 'bg-red-50/40'}>
                        <td className="px-4 py-2 font-mono">{rec.rowNumber}</td>
                        <td className="px-4 py-2">{rec.date}</td>
                        <td className="px-4 py-2 font-medium">{rec.productName}</td>
                        <td className="px-4 py-2">{rec.quantity}</td>
                        <td className="px-4 py-2">₹{rec.revenue}</td>
                        <td className="px-4 py-2">{rec.isValid ? <span className="text-emerald-700 font-semibold">Ready</span> : <span className="text-red-600">{rec.errors.join('; ')}</span>}</td>
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
