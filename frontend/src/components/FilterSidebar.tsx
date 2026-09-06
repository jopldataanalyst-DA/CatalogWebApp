import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import type { CatalogFilters } from '../types'
import { EMPTY_FILTERS } from '../types'

interface Props {
  categories: string[]
  fabrics: string[]
  sizes: string[]
  filters: CatalogFilters
  onChange: (next: CatalogFilters) => void
  onCloseMobile?: () => void
}

function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value]
}

function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="py-5 border-b border-[var(--color-line)] last:border-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink)]/60 mb-3">{title}</h3>
      {children}
    </div>
  )
}

function CheckRow({ label, checked, onClick }: { label: string; checked: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2.5 w-full py-1 text-left group">
      <span
        className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors ${
          checked ? 'bg-[var(--color-gold)] border-[var(--color-gold)]' : 'border-[var(--color-line)] group-hover:border-[var(--color-ink)]/40'
        }`}
      >
        {checked && <span className="text-white text-[10px] leading-none">✓</span>}
      </span>
      <span className="text-sm text-[var(--color-ink)]/80">{label}</span>
    </button>
  )
}

export function FilterSidebar({ categories, fabrics, sizes, filters, onChange, onCloseMobile }: Props) {
  const activeCount =
    filters.categories.length + filters.fabrics.length + filters.sizes.length + (filters.priceMin != null ? 1 : 0) + (filters.priceMax != null ? 1 : 0)

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 pb-1">
        <h2 className="font-semibold text-sm tracking-wide">Filters</h2>
        <div className="flex items-center gap-3">
          {activeCount > 0 && (
            <button
              onClick={() => onChange(EMPTY_FILTERS)}
              className="text-xs text-[var(--color-gold-dark)] hover:underline"
            >
              Clear all
            </button>
          )}
          {onCloseMobile && (
            <button onClick={onCloseMobile} className="md:hidden text-[var(--color-ink)]/50">
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1">
        {categories.length > 0 && (
          <FilterSection title="Category">
            {categories.map(c => (
              <CheckRow
                key={c}
                label={c}
                checked={filters.categories.includes(c)}
                onClick={() => onChange({ ...filters, categories: toggleValue(filters.categories, c) })}
              />
            ))}
          </FilterSection>
        )}

        {sizes.length > 0 && (
          <FilterSection title="Size">
            <div className="flex flex-wrap gap-1.5">
              {sizes.map(s => {
                const active = filters.sizes.includes(s)
                return (
                  <button
                    key={s}
                    onClick={() => onChange({ ...filters, sizes: toggleValue(filters.sizes, s) })}
                    className={`text-xs font-medium px-2.5 py-1 rounded-md border transition-colors ${
                      active
                        ? 'bg-[var(--color-ink)] text-[var(--color-paper)] border-[var(--color-ink)]'
                        : 'border-[var(--color-line)] text-[var(--color-ink)]/70 hover:border-[var(--color-ink)]/40'
                    }`}
                  >
                    {s}
                  </button>
                )
              })}
            </div>
          </FilterSection>
        )}

        {fabrics.length > 0 && (
          <FilterSection title="Fabric">
            {fabrics.map(f => (
              <CheckRow
                key={f}
                label={f}
                checked={filters.fabrics.includes(f)}
                onClick={() => onChange({ ...filters, fabrics: toggleValue(filters.fabrics, f) })}
              />
            ))}
          </FilterSection>
        )}

        <FilterSection title="Price Range (₹)">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              placeholder="Min"
              value={filters.priceMin ?? ''}
              onChange={e => onChange({ ...filters, priceMin: e.target.value === '' ? null : Number(e.target.value) })}
              className="w-full min-w-0 bg-white border border-[var(--color-line)] rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-gold)]"
            />
            <span className="text-[var(--color-ink)]/40 text-sm">–</span>
            <input
              type="number"
              min={0}
              placeholder="Max"
              value={filters.priceMax ?? ''}
              onChange={e => onChange({ ...filters, priceMax: e.target.value === '' ? null : Number(e.target.value) })}
              className="w-full min-w-0 bg-white border border-[var(--color-line)] rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-gold)]"
            />
          </div>
        </FilterSection>
      </div>
    </div>
  )
}
