import { ImageOff } from 'lucide-react'
import { imageUrl } from '../api'
import type { CatalogItem } from '../types'

export function StyleCard({ item, onOpen }: { item: CatalogItem; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="group h-full w-full text-left bg-white rounded-2xl overflow-hidden border border-[var(--color-line)] shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)] flex flex-col"
    >
      <div className="relative aspect-[3/5] shrink-0 bg-[var(--color-paper2)] overflow-hidden">
        {item.cover_image_id ? (
          <img
            src={imageUrl(item.cover_image_id)}
            alt={item.style_id}
            loading="lazy"
            className="w-full h-full object-cover object-top"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--color-line)]">
            <ImageOff size={32} />
          </div>
        )}
        {item.sizes_available.length === 0 && (
          <span className="absolute top-3 right-3 bg-white/90 text-[var(--color-ink)]/70 text-[10px] font-medium px-2.5 py-1 rounded-full">
            Out of stock
          </span>
        )}

        {/* Fabric + sizes stay hidden until hover, sliding up over the image
            bottom rather than living in the card footer - keeps every card
            in a row the same fixed height regardless of how many sizes a
            style has, and keeps the resting card down to just Style ID +
            Category as asked. */}
        <div className="absolute inset-x-0 bottom-0 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out bg-white/95 backdrop-blur-sm px-3 py-2.5 max-h-[55%] overflow-hidden">
          <p className="text-[11px] text-[var(--color-ink)]/60 mb-1.5">{item.fabric}</p>
          {item.sizes_available.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {item.sizes_available.map(sz => (
                <span
                  key={sz}
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-[var(--color-line)] bg-[var(--color-paper2)] text-[var(--color-ink)]/80"
                >
                  {sz}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-[11px] text-[var(--color-ink)]/40">No sizes in stock</span>
          )}
        </div>
      </div>

      <div className="px-3.5 py-3">
        <h3 className="font-semibold text-sm tracking-wide truncate">{item.style_id}</h3>
        <p className="text-xs text-[var(--color-ink)]/50 truncate mt-0.5">{item.category}</p>
      </div>
    </button>
  )
}
