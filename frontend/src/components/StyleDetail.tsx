import { useEffect, useRef, useState } from 'react'
import { X, ChevronLeft, ChevronRight, ImageOff, Loader2 } from 'lucide-react'
import { fetchStyle, imageUrl } from '../api'
import type { StyleDetail as StyleDetailType } from '../types'

const SWIPE_THRESHOLD_PX = 50

export function StyleDetailModal({ styleId, onClose }: { styleId: string; onClose: () => void }) {
  const [data, setData] = useState<StyleDetailType | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeIdx, setActiveIdx] = useState(0)
  const [imageLoaded, setImageLoaded] = useState(false)
  const dragStartX = useRef<number | null>(null)
  const [dragDeltaX, setDragDeltaX] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchStyle(styleId)
      .then(d => { if (!cancelled) { setData(d); setActiveIdx(0) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [styleId])

  // Reset the per-image loading flag whenever the shown image changes, so
  // switching slides shows the spinner again instead of the previous image
  // lingering (or a flash of the "no images" state) while the new one fetches.
  useEffect(() => { setImageLoaded(false) }, [activeIdx, data])

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

  const images = data?.images ?? []

  const goPrev = () => setActiveIdx(i => (i - 1 + images.length) % images.length)
  const goNext = () => setActiveIdx(i => (i + 1) % images.length)

  const onPointerDown = (e: React.PointerEvent) => {
    if (images.length < 2) return
    dragStartX.current = e.clientX
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
    setDragDeltaX(0)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6" onClick={onClose}>
      <div
        className="bg-[var(--color-paper)] w-full max-w-4xl max-h-[92vh] rounded-2xl overflow-hidden shadow-2xl grid grid-cols-1 md:grid-cols-2"
        onClick={e => e.stopPropagation()}
      >
        <div
          className="relative bg-white aspect-square md:aspect-auto md:h-full flex items-center justify-center border-r border-[var(--color-line)] touch-pan-y select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{ cursor: images.length > 1 ? 'grab' : 'default' }}
        >
          {loading ? (
            <Loader2 size={28} className="text-[var(--color-ink)]/25 animate-spin" />
          ) : images.length > 0 ? (
            <>
              {!imageLoaded && (
                <Loader2 size={28} className="absolute text-[var(--color-ink)]/25 animate-spin" />
              )}
              <img
                key={images[activeIdx].drive_file_id}
                src={imageUrl(images[activeIdx].drive_file_id, 'w1200')}
                alt={data?.style_id}
                onLoad={() => setImageLoaded(true)}
                draggable={false}
                className={`w-full h-full object-contain transition-opacity duration-200 pointer-events-none ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
              />
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
            <div className="text-[var(--color-ink)]/30 flex flex-col items-center gap-2">
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
                  <dt className="text-[var(--color-ink)]/50 text-xs uppercase tracking-wide mb-1">Price</dt>
                  <dd className="font-medium">{data.price != null ? `₹${data.price.toLocaleString('en-IN')}` : 'On request'}</dd>
                </div>
              </dl>

              <div>
                <dt className="text-[var(--color-ink)]/50 text-xs uppercase tracking-wide mb-2">Available Sizes</dt>
                {data.sizes_available.length > 0 ? (
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
                ) : (
                  <p className="text-sm text-[var(--color-ink)]/40">Currently out of stock</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
