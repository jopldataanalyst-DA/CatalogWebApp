export interface CatalogItem {
  style_id: string
  fabric: string
  category: string
  price: number | null
  sizes_available: string[]
  image_count: number
  cover_image_id: string | null
  tier?: string
}

export interface HomeSection {
  key: string
  title: string
  subtitle: string
  items: CatalogItem[]
}

export interface CatalogImage {
  drive_file_id: string
  filename: string
}

export interface SizePrice {
  size: string
  price: number | null
}

export interface FitDetails {
  b2b_category: string | null
  length_type: string | null
  top_length: number | null
  bottom_length: number | null
}

export interface StyleDetail {
  style_id: string
  fabric: string
  category: string
  price: number | null
  sizes_available: string[]
  // Only non-empty when this style's sizes are genuinely priced
  // differently from each other - otherwise show the flat `price` above.
  size_prices: SizePrice[]
  images: CatalogImage[]
  tier?: string
  fit: FitDetails
}

export interface CatalogFilters {
  categories: string[]
  fabrics: string[]
  sizes: string[]
  priceMin: number | null
  priceMax: number | null
  includeOutOfStock: boolean
}

export const EMPTY_FILTERS: CatalogFilters = {
  categories: [],
  fabrics: [],
  sizes: [],
  priceMin: null,
  priceMax: null,
  includeOutOfStock: false,
}
