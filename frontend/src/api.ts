import type { CatalogItem, StyleDetail } from './types'

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.json()
}

export function fetchCatalog(search: string, category: string): Promise<{ items: CatalogItem[] }> {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (category) params.set('category', category)
  return get(`/api/catalog?${params.toString()}`)
}

export function fetchCategories(): Promise<{ categories: string[] }> {
  return get('/api/categories')
}

export function fetchStyle(styleId: string): Promise<StyleDetail> {
  return get(`/api/catalog/${encodeURIComponent(styleId)}`)
}

export function imageUrl(driveFileId: string, size: 'w600' | 'w1200' = 'w600'): string {
  return `/api/image-proxy?id=${encodeURIComponent(driveFileId)}&sz=${size}`
}
