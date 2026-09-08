import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, PackageSearch, SlidersHorizontal, X } from 'lucide-react'
import { fetchCatalog, fetchCategories, fetchFabrics, fetchSizes } from '../api'
import { FilterSidebar } from '../components/FilterSidebar'
import { Pagination } from '../components/Pagination'
import { StyleCard } from '../components/StyleCard'
import { StyleDetailModal } from '../components/StyleDetail'
import type { CatalogFilters, CatalogItem } from '../types'
import { EMPTY_FILTERS } from '../types'

const DEFAULT_PAGE_SIZE = 12

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const collection = searchParams.get('collection') ?? ''
  const [collectionTitle, setCollectionTitle] = useState<string | null>(null)
  const [items, setItems] = useState<CatalogItem[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [fabrics, setFabrics] = useState<string[]>([])
  const [sizes, setSizes] = useState<string[]>([])
  const [filters, setFilters] = useState<CatalogFilters>(EMPTY_FILTERS)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 300)
  const [loading, setLoading] = useState(true)
  const [openStyle, setOpenStyle] = useState<string | null>(searchParams.get('style'))
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  useEffect(() => {
    fetchCategories().then(d => setCategories(d.categories)).catch(() => {})
    fetchFabrics().then(d => setFabrics(d.fabrics)).catch(() => {})
    fetchSizes().then(d => setSizes(d.sizes)).catch(() => {})
  }, [])

  useEffect(() => {
    // Live re-fetch on every filter change: the B2B Catalog admin tab in
    // PricingManagementSystem writes straight to the same table this reads,
    // so a fresh load always reflects the latest edit - no cache to bust.
    let cancelled = false
    setLoading(true)
    fetchCatalog(debouncedSearch, filters, collection)
      .then(d => { if (!cancelled) { setItems(d.items); setCollectionTitle(d.collection_title) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [debouncedSearch, filters, collection])

  // A new search/filter changes what "page 1" even means, so always snap
  // back there rather than leaving the viewer stranded on a now out-of-range page.
  useEffect(() => { setPage(1) }, [debouncedSearch, filters, collection, pageSize])

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const pagedItems = useMemo(
    () => items.slice((page - 1) * pageSize, page * pageSize),
    [items, page, pageSize],
  )

  // Changing page swaps the grid's whole contents out from under the
  // viewer, who's typically scrolled down near the pagination bar at the
  // bottom when they click it - jump back to the top so they land on the
  // new page's first row instead of staring at its tail end.
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }) }, [page])

  const emptyState = useMemo(() => !loading && items.length === 0, [loading, items])
  const activeFilterCount =
    filters.categories.length +
    filters.fabrics.length +
    filters.sizes.length +
    (filters.priceMin != null ? 1 : 0) +
    (filters.priceMax != null ? 1 : 0) +
    (filters.includeOutOfStock ? 1 : 0)

  return (
    <>
      <div className="border-b border-[var(--color-line)] bg-[var(--color-paper)]">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          {collection && collectionTitle ? (
            <div className="flex items-center gap-2 bg-[var(--color-gold)]/10 border border-[var(--color-gold)]/30 rounded-full pl-3.5 pr-1.5 py-1">
              <span className="text-sm font-medium text-[var(--color-gold-dark)]">Showing: {collectionTitle}</span>
              <button
                onClick={() => setSearchParams(prev => { const p = new URLSearchParams(prev); p.delete('collection'); return p })}
                className="text-[var(--color-gold-dark)] hover:bg-[var(--color-gold)]/20 rounded-full p-1"
                aria-label="Clear collection filter"
              >
                <X size={13} />
              </button>
            </div>
          ) : (
            <h2 className="text-sm font-semibold text-[var(--color-ink)]/70 hidden sm:block">Browse All Products</h2>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => setMobileFiltersOpen(true)}
              className="md:hidden relative flex items-center gap-1.5 border border-[var(--color-line)] bg-white rounded-full px-3.5 py-2 text-sm"
            >
              <SlidersHorizontal size={15} />
              Filters
              {activeFilterCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-[var(--color-gold)] text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>
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
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 sm:py-8 flex gap-8">
        <aside className="hidden md:block w-60 shrink-0">
          {/* Pinned under the header, with its own scroll region (a
              DEFINITE height + overflow-hidden here, since max-height alone
              doesn't give FilterSidebar's h-full/100% a real height to
              resolve against - it was silently falling back to auto,
              which is why the inner scroll never actually engaged) - a long
              Category list scrolls independently of the page instead of
              dragging the whole sidebar out of view as the grid scrolls. */}
          <div className="sticky top-36 h-[calc(100vh-9.5rem)] overflow-hidden">
            <FilterSidebar categories={categories} fabrics={fabrics} sizes={sizes} filters={filters} onChange={setFilters} />
          </div>
        </aside>

        {mobileFiltersOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-black/50" onClick={() => setMobileFiltersOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-[85%] max-w-xs bg-[var(--color-paper)] p-5 shadow-2xl overflow-hidden">
              <FilterSidebar
                categories={categories}
                fabrics={fabrics}
                sizes={sizes}
                filters={filters}
                onChange={setFilters}
                onCloseMobile={() => setMobileFiltersOpen(false)}
              />
            </div>
          </div>
        )}

        <main className="flex-1 min-w-0">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 sm:gap-5">
              {Array.from({ length: pageSize }).map((_, i) => (
                <div key={i} className="animate-pulse rounded-2xl overflow-hidden border border-[var(--color-line)]">
                  <div className="aspect-[3/5] bg-[var(--color-paper2)]" />
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
              <p className="text-sm">No styles match your filters.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 sm:gap-5">
                {pagedItems.map(item => (
                  <StyleCard key={item.style_id} item={item} onOpen={() => setOpenStyle(item.style_id)} />
                ))}
              </div>
              <Pagination
                page={page}
                totalPages={totalPages}
                pageSize={pageSize}
                total={items.length}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            </>
          )}
        </main>
      </div>

      {openStyle && (
        <StyleDetailModal
          styleId={openStyle}
          onClose={() => {
            setOpenStyle(null)
            if (searchParams.get('style')) {
              // replace, not push - StyleDetailModal already manages its
              // own back-button history (pushState on open, history.back()
              // on close); pushing another entry here on top of that would
              // leave a stray forward-navigable entry with the modal closed
              // but the URL still carrying ?style=, right after the user
              // just went back.
              setSearchParams(prev => { const p = new URLSearchParams(prev); p.delete('style'); return p }, { replace: true })
            }
          }}
        />
      )}
    </>
  )
}
