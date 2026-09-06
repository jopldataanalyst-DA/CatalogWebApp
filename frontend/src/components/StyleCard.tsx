import { ImageOff } from 'lucide-react'
import { imageUrl } from '../api'
import type { CatalogItem } from '../types'

export function StyleCard({ item, onOpen }: { item: CatalogItem; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="group text-left bg-white rounded-2xl overflow-hidden border border-[var(--color-line)] shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
    >
      <div className="relative aspect-[3/4] bg-[var(--color-paper2)] overflow-hidden">
        {item.cover_image_id ? (
          <img
            src={imageUrl(item.cover_image_id)}
            alt={item.style_id}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--color-line)]">
            <ImageOff size={32} />
          </div>
        )}
        <span className="absolute top-3 left-3 bg-[var(--color-ink)]/85 text-[var(--color-paper)] text-[11px] tracking-wide uppercase px-2.5 py-1 rounded-full">
          {item.category}
        </span>
        {item.sizes_available.length === 0 && (
          <span className="absolute top-3 right-3 bg-white/90 text-[var(--color-ink)]/70 text-[10px] font-medium px-2.5 py-1 rounded-full">
            Out of stock
          </span>
        )}
      </div>
      <div className="p-4 space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-semibold text-sm tracking-wide truncate">{item.style_id}</h3>
        </div>
        <p className="text-xs text-[var(--color-ink)]/60">{item.fabric}</p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {item.sizes_available.length > 0 ? (
            item.sizes_available.map(sz => (
              <span
                key={sz}
                className="text-[11px] font-medium px-2 py-0.5 rounded-md border border-[var(--color-line)] bg-[var(--color-paper2)] text-[var(--color-ink)]/80"
              >
                {sz}
              </span>
            ))
          ) : (
            <span className="text-[11px] text-[var(--color-ink)]/40">No sizes in stock</span>
          )}
        </div>
      </div>
    </button>
  )
}
