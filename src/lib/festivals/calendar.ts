// ─────────────────────────────────────────────────────────────────────────────
// Phase 10I: Indian Festival & Seasonal Calendar
//
// IMPORTANT:
// Festival dates are explicitly year-locked (2026 / 2027).
// Indian festivals using the lunar calendar (Diwali, Holi, Navratri, Eid, etc.)
// vary each year and MUST NOT be guessed. Update this file each year.
//
// Current application context: August 14, 2026
//
// Verified 2026 dates (sources documented inline):
//   Holi 2026             — Dhulendi (colour day): March 4, 2026
//                           Source: Times of India, NDTV, CGI San Francisco official calendar
//   Eid al-Fitr 2026      — March 20, 2026 (actual sighting confirmed)
//                           Source: Indian Express (actual moon sighting report), DFA PH official
//   Raksha Bandhan 2026   — Shravan Purnima: August 28, 2026
//                           Source: Times of India ×4, Economic Times ×2, MoneyControl, Vedantu
//   Navratri 2026         — Sharadiya Navratri start: October 11, 2026
//                           Source: timeanddate.com, News18 (Drik Panchang), hindutone.com
//   Dussehra 2026         — Vijayadashami: October 20, 2026
//                           Source: hindutone.com, astrosight.ai, srichants.in — 10th day of Navratri
//   Diwali 2026           — Kartik Amavasya: November 8, 2026 (Sunday)
//                           Source: publicholidays.in, farmersalmanac.com, prokerala.com, diwali.info
//   Christmas 2026        — Fixed: December 25, 2026
//   New Year 2027         — Fixed: January 1, 2027
// ─────────────────────────────────────────────────────────────────────────────

export interface FestivalConfig {
  /** Unique key for the festival */
  key: string
  /** Display name (Hinglish) */
  name: string
  /** ISO date string YYYY-MM-DD in UTC */
  date: string
  /** Retail preparation window in days before the festival */
  prepDays: number
  /** How many days of festival-period demand to cover */
  festivalWindowDays: number
  /** Emoji */
  emoji: string
}

/**
 * Year-locked festival calendar for 2026–2027.
 * Sorted chronologically.
 * All lunar-calendar dates are verified from authoritative sources — see header.
 */
export const FESTIVAL_CALENDAR_2026: FestivalConfig[] = [
  {
    key: 'holi_2026',
    name: 'Holi',
    date: '2026-03-04',
    prepDays: 7,
    festivalWindowDays: 7,
    emoji: '🎨',
  },
  {
    key: 'eid_2026',
    name: 'Eid',
    date: '2026-03-20',
    prepDays: 7,
    festivalWindowDays: 5,
    emoji: '🌙',
  },
  {
    key: 'raksha_bandhan_2026',
    name: 'Raksha Bandhan',
    date: '2026-08-28',
    prepDays: 5,
    festivalWindowDays: 5,
    emoji: '🪢',
  },
  {
    key: 'navratri_2026',
    name: 'Navratri',
    date: '2026-10-11',
    prepDays: 7,
    festivalWindowDays: 9,
    emoji: '🪔',
  },
  {
    key: 'dussehra_2026',
    name: 'Dussehra',
    date: '2026-10-20',
    prepDays: 7,
    festivalWindowDays: 3,
    emoji: '🏹',
  },
  {
    key: 'diwali_2026',
    name: 'Diwali',
    date: '2026-11-08',
    prepDays: 14,
    festivalWindowDays: 7,
    emoji: '🪔',
  },
  {
    key: 'christmas_2026',
    name: 'Christmas',
    date: '2026-12-25',
    prepDays: 7,
    festivalWindowDays: 7,
    emoji: '🎄',
  },
  {
    key: 'new_year_2027',
    name: 'New Year',
    date: '2027-01-01',
    prepDays: 5,
    festivalWindowDays: 3,
    emoji: '🎆',
  },
]

/**
 * Returns the next upcoming festival on or after the given reference date (UTC ISO string).
 * Returns null if no configured festival is in the future.
 */
export function getNextFestival(referenceDateIso: string): FestivalConfig | null {
  const ref = new Date(referenceDateIso)
  const upcoming = FESTIVAL_CALENDAR_2026
    .filter((f) => new Date(f.date) >= ref)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  return upcoming[0] ?? null
}

/**
 * Returns all festivals that fall within the given date range (inclusive).
 */
export function getFestivalsInRange(
  startIso: string,
  endIso: string
): FestivalConfig[] {
  const start = new Date(startIso)
  const end = new Date(endIso)
  return FESTIVAL_CALENDAR_2026.filter((f) => {
    const d = new Date(f.date)
    return d >= start && d <= end
  })
}

/**
 * Returns the number of days between two UTC ISO date strings (rounded).
 * Positive = toDate is in the future relative to fromDate.
 */
export function daysBetween(fromIso: string, toIso: string): number {
  const diff = new Date(toIso).getTime() - new Date(fromIso).getTime()
  return Math.round(diff / (1000 * 60 * 60 * 24))
}
