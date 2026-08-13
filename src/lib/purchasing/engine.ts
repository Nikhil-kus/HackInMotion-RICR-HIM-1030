/**
 * Phase 8 — Purchase Planning Engine
 * Pure, deterministic business logic functions for purchase planning.
 * Does NOT recalculate Phase 7 reorder recommendations.
 */

export type PurchaseOrderStatus = 'draft' | 'ordered' | 'partially_received' | 'received' | 'cancelled'

export interface PurchaseLineItem {
  id?: string
  productId: string
  productName: string
  recommendedQuantity: number
  orderedQuantity: number
  receivedQuantity: number
  unitCost: number | null
  lineTotal: number
}

export interface PurchaseOrder {
  id: string
  supplierId: string | null
  supplierName: string | null
  status: PurchaseOrderStatus
  totalAmount: number
  notes: string | null
  orderedAt: string | null
  expectedAt: string | null
  receivedAt: string | null
  createdAt: string
  items: PurchaseLineItem[]
}

export interface SupplierGroup {
  supplierId: string | null
  supplierName: string
  items: PurchaseLineItem[]
  estimatedTotal: number
}

/**
 * Calculate the line total for a single purchase item.
 * If unitCost is null/0, returns 0.
 */
export function calculatePurchaseLineTotal(quantity: number, unitCost: number | null): number {
  if (!unitCost || unitCost <= 0 || quantity <= 0) return 0
  return Math.round(quantity * unitCost * 100) / 100
}

/**
 * Calculate the total amount for a purchase order from its line items.
 */
export function calculatePurchaseOrderTotal(items: PurchaseLineItem[]): number {
  const total = items.reduce((sum, item) => sum + item.lineTotal, 0)
  return Math.round(total * 100) / 100
}

/**
 * Group a flat list of purchase items by their assigned supplier.
 * Items without a supplier go into a "No Supplier" group.
 */
export function groupItemsBySupplier(
  items: Array<{
    productId: string
    productName: string
    supplierId: string | null
    supplierName: string | null
    recommendedQuantity: number
    orderedQuantity: number
    unitCost: number | null
    lineTotal: number
  }>
): SupplierGroup[] {
  const groupMap = new Map<string, SupplierGroup>()

  items.forEach((item) => {
    const key = item.supplierId ?? '__no_supplier__'
    const supplierName = item.supplierName ?? 'No Supplier Assigned'

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        supplierId: item.supplierId,
        supplierName,
        items: [],
        estimatedTotal: 0,
      })
    }

    const group = groupMap.get(key)!
    const lineItem: PurchaseLineItem = {
      productId: item.productId,
      productName: item.productName,
      recommendedQuantity: item.recommendedQuantity,
      orderedQuantity: item.orderedQuantity,
      receivedQuantity: 0,
      unitCost: item.unitCost,
      lineTotal: item.lineTotal,
    }
    group.items.push(lineItem)
    group.estimatedTotal = calculatePurchaseOrderTotal(group.items)
  })

  return Array.from(groupMap.values())
}

/**
 * Returns the receiving status label for a purchase order item.
 */
export function calculateReceivedQuantityStatus(
  orderedQuantity: number,
  receivedQuantity: number
): 'not_received' | 'partially_received' | 'fully_received' {
  if (receivedQuantity <= 0) return 'not_received'
  if (receivedQuantity >= orderedQuantity) return 'fully_received'
  return 'partially_received'
}

/**
 * Returns the remaining quantity to be received.
 * Never negative.
 */
export function calculateRemainingQuantity(orderedQuantity: number, receivedQuantity: number): number {
  return Math.max(0, orderedQuantity - receivedQuantity)
}

/**
 * Determines whether a purchase order should transition to a new status
 * after receiving stock, based on items' received quantities.
 */
export function derivePurchaseOrderStatus(
  items: Array<{ orderedQuantity: number; receivedQuantity: number }>
): 'partially_received' | 'received' {
  const totalOrdered = items.reduce((s, i) => s + i.orderedQuantity, 0)
  const totalReceived = items.reduce((s, i) => s + i.receivedQuantity, 0)
  return totalReceived >= totalOrdered ? 'received' : 'partially_received'
}

/**
 * Validates that a receive quantity is legal:
 * - Must be > 0
 * - Cannot exceed (orderedQuantity - already receivedQuantity)
 */
export function validateReceiveQuantity(
  receiveQty: number,
  orderedQuantity: number,
  alreadyReceived: number
): { valid: true } | { valid: false; reason: string } {
  if (receiveQty <= 0) {
    return { valid: false, reason: 'Receive quantity must be greater than zero.' }
  }
  const remaining = orderedQuantity - alreadyReceived
  if (receiveQty > remaining) {
    return {
      valid: false,
      reason: `Cannot receive ${receiveQty} units. Only ${remaining} units remain to be received.`,
    }
  }
  return { valid: true }
}

/**
 * Returns a human-readable status label with badge styles.
 */
export function getPurchaseOrderStatusDisplay(status: PurchaseOrderStatus): {
  label: string
  badgeClass: string
} {
  switch (status) {
    case 'draft':
      return { label: 'Draft', badgeClass: 'bg-gray-100 text-gray-600 border-gray-200' }
    case 'ordered':
      return { label: 'Ordered', badgeClass: 'bg-blue-100 text-blue-700 border-blue-200' }
    case 'partially_received':
      return { label: 'Partially Received', badgeClass: 'bg-amber-100 text-amber-700 border-amber-200' }
    case 'received':
      return { label: 'Received', badgeClass: 'bg-green-100 text-green-700 border-green-200' }
    case 'cancelled':
      return { label: 'Cancelled', badgeClass: 'bg-red-100 text-red-600 border-red-200' }
    default:
      return { label: status, badgeClass: 'bg-gray-100 text-gray-600 border-gray-200' }
  }
}
