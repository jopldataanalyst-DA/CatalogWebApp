import { useEffect, useRef, useState } from 'react'
import { X, ChevronLeft, ChevronRight, ImageOff, Loader2 } from 'lucide-react'
import { fetchStyle, imageUrl } from '../api'
import type { SizePrice, StyleDetail as StyleDetailType } from '../types'

const SWIPE_THRESHOLD_PX = 50

// Collapses consecutive same-price sizes into one row (e.g. "S XL XXL" at
// ₹500, "3XL 5XL 6XL" at ₹575) instead of a separate row per size -
// sizes_available/size_prices already arrive in garment order from the
// backend, so grouping by adjacency here is enough; no re-sorting needed.
function groupSizesByPrice(sizePrices: SizePrice[]): { sizes: string[]; price: number | null }[] {
  const groups: { sizes: string[]; price: number | null }[] = []
  for (const { size, price } of sizePrices) {
    const last = groups[groups.length - 1]
    if (last && last.price === price) last.sizes.push(size)
    else groups.push({ sizes: [size], price })
  }
  return groups
}

export function StyleDetailModal({ styleId, onClose }: { styleId: string; onClose: () => void }) {
  const [data, setData] = useState<StyleDetailType | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeIdx, setActiveIdx] = useState(0)
  const dragStartX = useRef<number | null>(null)
  const [dragDeltaX, setDragDeltaX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const trackRef = useRef<HTMLDivElement>(null)
  const [trackWidth, setTrackWidth] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchStyle(styleId)
      .then(d => {
        if (cancelled) return
        setData(d)
        setActiveIdx(0)
        // Kick off every image's fetch in parallel as soon as we know the
        // full list, instead of only the active slide - the backend's
        // image-proxy already sets a 24h Cache-Control, so by the time the
        // browser has finished these requests, every slide the viewer
        // clicks to next is already sitting in the HTTP cache (a repeat
        // <img src> for the same URL resolves instantly, no re-fetch).
        // Nothing is done with the Image objects beyond starting the
        // fetch, so they're safe to fire-and-forget.
        d.images.forEach(img => { new Image().src = imageUrl(img.drive_file_id, 'w1200') })
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [styleId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') setActiveIdx(i => (images.length ? (i - 1 + images.length) % images.length : i))
      if (e.key === 'ArrowRight') setActiveIdx(i => (images.length ? (i + 1) % images.length : i))
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose])

  // Track the carousel's own pixel width so a drag's translateX can be
  // expressed as a percentage of it - keeps the drag 1:1 with the pointer
  // regardless of viewport size, and resizing (e.g. rotating a phone)
  // doesn't leave the slide mid-way between two images.
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => setTrackWidth(entries[0].contentRect.width))
    setTrackWidth(el.clientWidth)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const images = data?.images ?? []

  const goPrev = () => setActiveIdx(i => (i - 1 + images.length) % images.length)
  const goNext = () => setActiveIdx(i => (i + 1) % images.length)

  const onPointerDown = (e: React.PointerEvent) => {
    if (images.length < 2) return
    dragStartX.current = e.clientX
    setDragging(true)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragStartX.current == null) return
    setDragDeltaX(e.clientX - dragStartX.current)
  }
  const endDrag = () => {
    if (dragStartX.current == null) return
    if (dragDeltaX > SWIPE_THRESHOLD_PX) goPrev()
    else if (dragDeltaX < -SWIPE_THRESHOLD_PX) goNext()
    dragStartX.current = null
    setDragging(false)
    setDragDeltaX(0)
  }

  // Percentage-based slide offset (like Amazon/Flipkart's PDP gallery) -
  // a flex track holding every image side by side, shifted by -100% per
  // slide plus however far the pointer has dragged, animated with a
  // smooth ease-out on release/click and no transition while actively
  // dragging (so it tracks the finger/cursor exactly).
  const dragPercent = trackWidth > 0 ? (dragDeltaX / trackWidth) * 100 : 0
  const trackStyle: React.CSSProperties = {
    transform: `translateX(calc(${-activeIdx * 100}% + ${dragPercent}%))`,
    transition: dragging ? 'none' : 'transform 380ms cubic-bezier(0.22, 1, 0.36, 1)',
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6" onClick={onClose}>
      <div
        className="bg-[var(--color-paper)] w-full max-w-4xl max-h-[92vh] rounded-2xl overflow-hidden shadow-2xl grid grid-cols-1 md:grid-cols-2"
        onClick={e => e.stopPropagation()}
      >
        <div
          className="relative bg-white aspect-square md:aspect-auto md:h-full overflow-hidden border-r border-[var(--color-line)] touch-pan-y select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{ cursor: images.length > 1 ? (dragging ? 'grabbing' : 'grab') : 'default' }}
        >
          {loading ? (
            <div className="w-full h-full flex items-center justify-center">
              <Loader2 size={28} className="text-[var(--color-ink)]/25 animate-spin" />
            </div>
          ) : images.length > 0 ? (
            <>
              <div ref={trackRef} className="flex w-full h-full" style={trackStyle}>
                {images.map((img, i) => (
                  <div key={img.drive_file_id} className="w-full h-full shrink-0 flex items-center justify-center">
                    <img
                      src={imageUrl(img.drive_file_id, 'w1200')}
                      alt={data?.style_id}
                      draggable={false}
                      loading={Math.abs(i - activeIdx) <= 1 ? 'eager' : 'lazy'}
                      className="w-full h-full object-contain pointer-events-none"
                    />
                  </div>
                ))}
              </div>
              {images.length > 1 && (
                <>
                  <button
                    onClick={goPrev}
                    className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/5 hover:bg-black/10 text-[var(--color-ink)] rounded-full p-1.5"
                    aria-label="Previous image"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    onClick={goNext}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/5 hover:bg-black/10 text-[var(--color-ink)] rounded-full p-1.5"
                    aria-label="Next image"
                  >
                    <ChevronRight size={18} />
                  </button>
                  <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
                    {images.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setActiveIdx(i)}
                        className={`w-1.5 h-1.5 rounded-full transition-all ${i === activeIdx ? 'bg-[var(--color-gold)] w-4' : 'bg-[var(--color-ink)]/20'}`}
                        aria-label={`Image ${i + 1}`}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-[var(--color-ink)]/30">
              <ImageOff size={32} />
              <span className="text-xs">No images</span>
            </div>
          )}
        </div>

        <div className="p-6 sm:p-8 overflow-y-auto hide-scrollbar relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-[var(--color-ink)]/50 hover:text-[var(--color-ink)] rounded-full p-1.5 hover:bg-[var(--color-paper2)]"
            aria-label="Close"
          >
            <X size={20} />
          </button>

          {loading || !data ? (
            <div className="animate-pulse space-y-4 pt-2">
              <div className="h-6 w-40 bg-[var(--color-paper2)] rounded" />
              <div className="h-4 w-24 bg-[var(--color-paper2)] rounded" />
              <div className="h-4 w-32 bg-[var(--color-paper2)] rounded" />
            </div>
          ) : (
            <div className="space-y-6 pt-2">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] tracking-widest uppercase text-[var(--color-gold-dark)] font-medium">
                    {data.category}
                  </span>
                  {data.tier && (
                    <span className="text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full bg-[var(--color-gold)] text-white">
                      {data.tier}
                    </span>
                  )}
                </div>
                <h2 className="font-[var(--font-display)] text-2xl sm:text-3xl mt-1" style={{ fontFamily: 'var(--font-display)' }}>
                  {data.style_id}
                </h2>
              </div>

              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-[var(--color-ink)]/50 text-xs uppercase tracking-wide mb-1">Fabric</dt>
                  <dd className="font-medium">{data.fabric}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-ink)]/50 text-xs uppercase tracking-wide mb-1">
                    {data.size_prices.length > 0 ? 'Price Range' : 'Price'}
                  </dt>
                  <dd className="font-medium">
                    {data.size_prices.length > 0 ? (
                      <>
                        ₹{Math.min(...data.size_prices.map(p => p.price ?? Infinity)).toLocaleString('en-IN')}
                        {' – '}
                        ₹{Math.max(...data.size_prices.map(p => p.price ?? -Infinity)).toLocaleString('en-IN')}
                      </>
                    ) : data.price != null ? (
                      `₹${data.price.toLocaleString('en-IN')}`
                    ) : (
                      'On request'
                    )}
                  </dd>
                </div>
              </dl>

              {data.sizes_available.length > 0 ? (
                data.size_prices.length > 0 ? (
                  // Prices genuinely differ by size - its own clearly
                  // separated card (distinct border/background) rather
                  // than folded into a plain "Available Sizes" chip row,
                  // so a buyer immediately reads it as "size changes the
                  // price" instead of mistaking it for just a size list.
                  <div className="rounded-xl border border-[var(--color-gold)]/40 bg-[var(--color-gold)]/5 p-4">
                    <dt className="text-[var(--color-gold-dark)] text-xs uppercase tracking-wide font-semibold mb-3">
                      Price by Size
                    </dt>
                    <div className="divide-y divide-[var(--color-gold)]/20">
                      {groupSizesByPrice(data.size_prices).map(({ sizes, price }) => (
                        <div key={sizes.join('-')} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                          <span className="text-sm font-semibold tracking-wide">{sizes.join('  ')}</span>
                          <span className="text-sm text-[var(--color-ink)]/60 shrink-0">
                            {price != null ? `₹${price.toLocaleString('en-IN')}` : '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div>
                    <dt className="text-[var(--color-ink)]/50 text-xs uppercase tracking-wide mb-2">Available Sizes</dt>
                    <div className="flex flex-wrap gap-2">
                      {data.sizes_available.map(sz => (
                        <span
                          key={sz}
                          className="text-sm font-medium px-3 py-1.5 rounded-lg border border-[var(--color-gold)]/50 bg-[var(--color-gold)]/10 text-[var(--color-gold-dark)]"
                        >
                          {sz}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              ) : (
                <div>
                  <dt className="text-[var(--color-ink)]/50 text-xs uppercase tracking-wide mb-2">Available Sizes</dt>
                  <p className="text-sm text-[var(--color-ink)]/40">Currently out of stock</p>
                </div>
              )}

              {(data.fit.b2b_category || data.fit.length_type || data.fit.top_length != null || data.fit.bottom_length != null) && (
                <div>
                  <dt className="text-[var(--color-ink)]/50 text-xs uppercase tracking-wide mb-2">Fit Details</dt>
                  <dl className="grid grid-cols-2 gap-4 text-sm">
                    {data.fit.b2b_category && (
                      <div>
                        <dt className="text-[var(--color-ink)]/50 text-xs mb-0.5">B2B Category</dt>
                        <dd className="font-medium">{data.fit.b2b_category}</dd>
                      </div>
                    )}
                    {data.fit.length_type && (
                      <div>
                        <dt className="text-[var(--color-ink)]/50 text-xs mb-0.5">Length Type</dt>
                        <dd className="font-medium">{data.fit.length_type}</dd>
                      </div>
                    )}
                    {data.fit.top_length != null && (
                      <div>
                        <dt className="text-[var(--color-ink)]/50 text-xs mb-0.5">Top Length</dt>
                        <dd className="font-medium">{data.fit.top_length}"</dd>
                      </div>
                    )}
                    {data.fit.bottom_length != null && (
                      <div>
                        <dt className="text-[var(--color-ink)]/50 text-xs mb-0.5">Bottom Length</dt>
                        <dd className="font-medium">{data.fit.bottom_length}"</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {images.length > 1 && (
                <div>
                  <dt className="text-[var(--color-ink)]/50 text-xs uppercase tracking-wide mb-2">Photos</dt>
                  <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
                    {images.map((img, i) => (
                      <button
                        key={img.drive_file_id}
                        onClick={() => setActiveIdx(i)}
                        className={`shrink-0 w-14 aspect-[3/4] rounded-lg overflow-hidden border-2 bg-white transition-colors ${
                          i === activeIdx ? 'border-[var(--color-gold)]' : 'border-transparent hover:border-[var(--color-line)]'
                        }`}
                      >
                        <img
                          src={imageUrl(img.drive_file_id, 'w600')}
                          alt={`${data.style_id} ${i + 1}`}
                          draggable={false}
                          className="w-full h-full object-contain"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
