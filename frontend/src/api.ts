import type { CatalogItem, StyleDetail } from './types'
import type { CatalogFilters } from './types'

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.json()
}

export function fetchCatalog(search: string, filters: CatalogFilters): Promise<{ items: CatalogItem[] }> {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  filters.categories.forEach(c => params.append('categories', c))
  filters.fabrics.forEach(f => params.append('fabrics', f))
  filters.sizes.forEach(s => params.append('sizes', s))
  if (filters.priceMin != null) params.set('price_min', String(filters.priceMin))
  if (filters.priceMax != null) params.set('price_max', String(filters.priceMax))
  if (filters.includeOutOfStock) params.set('include_out_of_stock', 'true')
  return get(`/api/catalog?${params.toString()}`)
}

export function fetchCategories(): Promise<{ categories: string[] }> {
  return get('/api/categories')
}

export function fetchFabrics(): Promise<{ fabrics: string[] }> {
  return get('/api/fabrics')
}

export function fetchSizes(): Promise<{ sizes: string[] }> {
  return get('/api/sizes')
}

export function fetchStyle(styleId: string): Promise<StyleDetail> {
  return get(`/api/catalog/${encodeURIComponent(styleId)}`)
}

export function imageUrl(driveFileId: string, size: 'w600' | 'w1200' = 'w600'): string {
  return `/api/image-proxy?id=${encodeURIComponent(driveFileId)}&sz=${size}`
}
