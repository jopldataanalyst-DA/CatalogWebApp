export interface CatalogItem {
  style_id: string
  fabric: string
  category: string
  price: number | null
  sizes_available: string[]
  image_count: number
  cover_image_id: string | null
}

export interface CatalogImage {
  drive_file_id: string
  filename: string
}

export interface StyleDetail {
  style_id: string
  fabric: string
  category: string
  price: number | null
  sizes_available: string[]
  images: CatalogImage[]
}
