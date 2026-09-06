import { useEffect, useMemo, useState } from 'react'
import { Search, PackageSearch } from 'lucide-react'
import { fetchCatalog, fetchCategories } from './api'
import { StyleCard } from './components/StyleCard'
import { StyleDetailModal } from './components/StyleDetail'
import type { CatalogItem } from './types'

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export default function App() {
  const [items, setItems] = useState<CatalogItem[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [activeCategory, setActiveCategory] = useState('')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 300)
  const [loading, setLoading] = useState(true)
  const [openStyle, setOpenStyle] = useState<string | null>(null)

  useEffect(() => {
    fetchCategories().then(d => setCategories(d.categories)).catch(() => {})
  }, [])

  useEffect(() => {
    // Live re-fetch on every filter change: the B2B Catalog admin tab in
    // PricingManagementSystem writes straight to the same table this reads,
    // so a fresh load always reflects the latest edit - no cache to bust.
    let cancelled = false
    setLoading(true)
    fetchCatalog(debouncedSearch, activeCategory)
      .then(d => { if (!cancelled) setItems(d.items) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [debouncedSearch, activeCategory])

  const emptyState = useMemo(() => !loading && items.length === 0, [loading, items])

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--color-line)] bg-[var(--color-paper)]/90 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <h1
              className="text-lg sm:text-xl tracking-wide"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Rajnandini Fashion
            </h1>
            <p className="text-[11px] uppercase tracking-[0.15em] text-[var(--color-ink)]/50">B2B Catalog</p>
          </div>
          <div className="flex items-center gap-1.5 bg-white border border-[var(--color-line)] rounded-full px-3.5 py-2 w-40 sm:w-72 shadow-sm">
            <Search size={15} className="text-[var(--color-ink)]/40 shrink-0" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search Style ID..."
              className="bg-transparent outline-none text-sm w-full placeholder:text-[var(--color-ink)]/35"
            />
          </div>
        </div>

        {categories.length > 0 && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-3 flex items-center gap-2 overflow-x-auto hide-scrollbar">
            <button
              onClick={() => setActiveCategory('')}
              className={`shrink-0 text-xs font-medium px-3.5 py-1.5 rounded-full border transition-colors ${
                activeCategory === ''
                  ? 'bg-[var(--color-ink)] text-[var(--color-paper)] border-[var(--color-ink)]'
                  : 'border-[var(--color-line)] text-[var(--color-ink)]/60 hover:border-[var(--color-ink)]/40'
              }`}
            >
              All
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`shrink-0 text-xs font-medium px-3.5 py-1.5 rounded-full border transition-colors ${
                  activeCategory === cat
                    ? 'bg-[var(--color-ink)] text-[var(--color-paper)] border-[var(--color-ink)]'
                    : 'border-[var(--color-line)] text-[var(--color-ink)]/60 hover:border-[var(--color-ink)]/40'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-2xl overflow-hidden border border-[var(--color-line)]">
                <div className="aspect-[3/4] bg-[var(--color-paper2)]" />
                <div className="p-4 space-y-2">
                  <div className="h-3 w-2/3 bg-[var(--color-paper2)] rounded" />
                  <div className="h-3 w-1/3 bg-[var(--color-paper2)] rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : emptyState ? (
          <div className="flex flex-col items-center justify-center py-24 text-[var(--color-ink)]/40 gap-3">
            <PackageSearch size={40} strokeWidth={1.2} />
            <p className="text-sm">No styles match your search.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-5">
            {items.map(item => (
              <StyleCard key={item.style_id} item={item} onOpen={() => setOpenStyle(item.style_id)} />
            ))}
          </div>
        )}
      </main>

      {openStyle && <StyleDetailModal styleId={openStyle} onClose={() => setOpenStyle(null)} />}
    </div>
  )
}
