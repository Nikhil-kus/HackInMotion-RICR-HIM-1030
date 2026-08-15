/**
 * Centralized product image mapping for Blinkit-style high quality realistic product assets.
 */

export function getProductImage(name: string, brand?: string | null): string {
  const n = (name + ' ' + (brand || '')).toLowerCase().trim()

  if (n.includes('bread') || n.includes('pav') || n.includes('bun') || n.includes('loaf')) {
    return '/products/bread.jpg'
  }
  if (n.includes('chip') || n.includes('chips') || n.includes('lays') || n.includes('lay\'s') || n.includes('bingo') || n.includes('wafer')) {
    return '/products/chips.jpg'
  }
  if (n.includes('kurkure') || n.includes('kurkurey') || n.includes('masala munch') || n.includes('tedhe medhe')) {
    return '/products/kurkure.jpg'
  }
  if (n.includes('maggi') || n.includes('noodle') || n.includes('noodles') || n.includes('yippee')) {
    return '/products/maggi.jpg'
  }
  if (n.includes('milk') || n.includes('doodh') || n.includes('दूध') || n.includes('taaza') || n.includes('gold') || n.includes('toned')) {
    return '/products/milk.jpg'
  }
  if (n.includes('atta') || n.includes('aashirvaad') || n.includes('flour') || n.includes('wheat flour')) {
    return '/products/atta.jpg'
  }

  return '/products/placeholder.svg'
}
