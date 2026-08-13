// ─────────────────────────────────────────────────────────────────────────────
// Phase 10C: Deterministic Hindi & Hinglish Voice Sales Parser
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedVoiceItem {
  quantity: number
  itemQuery: string
  rawSegment: string
}

// 1. Devanagari digit mapping
const DEVANAGARI_DIGITS: Record<string, string> = {
  '०': '0',
  '१': '1',
  '२': '2',
  '३': '3',
  '४': '4',
  '५': '5',
  '६': '6',
  '७': '7',
  '८': '8',
  '९': '9',
}

// 2. Hindi & English spoken number word dictionary
const NUMBER_WORDS: Record<string, number> = {
  // Hindi words
  एक: 1,
  दो: 2,
  तीन: 3,
  चार: 4,
  पांच: 5,
  पाँच: 5,
  छह: 6,
  छः: 6,
  सात: 7,
  आठ: 8,
  नौ: 9,
  दस: 10,
  ग्यारह: 11,
  बारह: 12,
  तेरह: 13,
  चौदह: 14,
  पंद्रह: 15,
  बीस: 20,
  पच्चीस: 25,
  पचास: 50,
  सौ: 100,

  // English words
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
}

// 3. Unit words to strip from item queries
const UNIT_WORDS = new Set([
  'पैकेट',
  'packet',
  'packets',
  'pkt',
  'लीटर',
  'litre',
  'litres',
  'liter',
  'liters',
  'किलो',
  'kg',
  'kgs',
  'ग्राम',
  'gram',
  'grams',
  'gm',
  'gms',
  'g',
  'बोतल',
  'bottle',
  'bottles',
  'डिब्बा',
  'box',
  'boxes',
  'पीस',
  'piece',
  'pieces',
  'pc',,
  'pcs',
])

/**
 * Replaces Devanagari digits (०-९) with standard ASCII digits (0-9).
 */
function normalizeDevanagariDigits(text: string): string {
  return text.replace(/[०-९]/g, (digit) => DEVANAGARI_DIGITS[digit] || digit)
}

/**
 * Parses natural spoken Hindi/Hinglish text into structured sale items with quantities.
 * Examples:
 *   "दो दूध और तीन कुरकुरे" -> [{ quantity: 2, itemQuery: "दूध" }, { quantity: 3, itemQuery: "कुरकुरे" }]
 *   "2 Amul milk, 3 Kurkure" -> [{ quantity: 2, itemQuery: "Amul milk" }, { quantity: 3, itemQuery: "Kurkure" }]
 *   "दो पैकेट दूध, तीन कुरकुरे" -> [{ quantity: 2, itemQuery: "दूध" }, { quantity: 3, itemQuery: "कुरकुरे" }]
 *   "दूध 2, कुरकुरे 3" -> [{ quantity: 2, itemQuery: "दूध" }, { quantity: 3, itemQuery: "कुरकुरे" }]
 */
export function parseSpokenSalesText(text: string): ParsedVoiceItem[] {
  if (!text || !text.trim()) return []

  // 1. Normalize Devanagari digits to standard digits
  const normalized = normalizeDevanagariDigits(text.trim())

  // 2. Split into segments using connectors (और, तथा, एवं, भी, या, and, plus, comma, period)
  const segments = normalized
    .split(/\s*(?:और|तथा|एवं|भी|या|\,|\.|\bAND\b|\bPLUS\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)

  const results: ParsedVoiceItem[] = []

  for (const rawSegment of segments) {
    const tokens = rawSegment.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) continue

    let detectedQuantity: number | null = null
    const queryTokens: string[] = []

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      const lowerToken = token.toLowerCase()

      // Check if token is a standard digit (e.g. "2")
      const numericVal = parseInt(token, 10)
      if (!isNaN(numericVal) && numericVal > 0) {
        if (detectedQuantity === null) {
          detectedQuantity = numericVal
          continue
        }
      }

      // Check if token is a spoken number word (e.g. "दो", "two")
      if (NUMBER_WORDS[lowerToken] != null) {
        if (detectedQuantity === null) {
          detectedQuantity = NUMBER_WORDS[lowerToken]
          continue
        }
      }

      // Check if token is a unit word (e.g. "पैकेट", "packet", "kg") -> strip it
      if (UNIT_WORDS.has(lowerToken)) {
        continue
      }

      // Remaining token is part of the product query
      queryTokens.push(token)
    }

    const itemQuery = queryTokens.join(' ').trim()
    if (itemQuery.length > 0) {
      results.push({
        quantity: detectedQuantity && detectedQuantity > 0 ? detectedQuantity : 1,
        itemQuery,
        rawSegment,
      })
    }
  }

  return results
}
