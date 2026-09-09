import { useEffect, useRef, useState } from 'react'
import { X, ChevronLeft, ChevronRight, ImageOff, Loader2, Expand, Share2 } from 'lucide-react'
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

// Lucide has no brand icons - a small inline WhatsApp glyph (colored via
// currentColor, so it inherits WhatsApp's own paint) reads unmistakably as
// "share to WhatsApp" the way a generic chat-bubble icon wouldn't, which
// matters here since this catalog's actual buyers coordinate over WhatsApp.
function WhatsAppIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M12.001 2C6.478 2 2 6.478 2 12c0 1.95.573 3.762 1.559 5.288L2.1 21.9l4.75-1.443A9.958 9.958 0 0 0 12.001 22C17.523 22 22 17.522 22 12S17.523 2 12.001 2zm0 18.166a8.126 8.126 0 0 1-4.407-1.29l-.316-.198-3.126.95.964-3.045-.207-.32A8.128 8.128 0 0 1 3.834 12c0-4.51 3.657-8.166 8.167-8.166 4.51 0 8.166 3.656 8.166 8.166 0 4.51-3.656 8.166-8.166 8.166z" />
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-1.746-.873-2.888-1.559-4.036-3.537-.305-.527.305-.489.874-1.627.098-.198.05-.371-.05-.52-.099-.15-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.055 3.132 4.98 4.27 2.926 1.14 2.926.76 3.874.712.947-.05 3.083-1.26 3.512-2.478.428-1.213.428-2.256.298-2.478-.13-.222-.297-.222-.297-.222z" />
    </svg>
  )
}

// A style's price is either one flat number or a min-max range (see the
// "Price"/"Price Range" dt/dd in the info panel below) - this mirrors that
// exact logic so the shared text always matches what's on screen.
function priceText(data: StyleDetailType): string {
  if (data.size_prices.length > 0) {
    const prices = data.size_prices.map(p => p.price).filter((p): p is number => p != null)
    if (prices.length === 0) return 'Price on request'
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    return min === max ? `₹${min.toLocaleString('en-IN')}` : `₹${min.toLocaleString('en-IN')} – ₹${max.toLocaleString('en-IN')}`
  }
  return data.price != null ? `₹${data.price.toLocaleString('en-IN')}` : 'Price on request'
}

function shareUrl(styleId: string): string {
  return `${window.location.origin}/search?style=${encodeURIComponent(styleId)}`
}

function shareText(data: StyleDetailType): string {
  return `${data.style_id} — ${data.category} — ${priceText(data)}\n${shareUrl(data.style_id)}`
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
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const lightboxTrackRef = useRef<HTMLDivElement>(null)
  const [lightboxTrackWidth, setLightboxTrackWidth] = useState(0)
  const lightboxOpenRef = useRef(false)
  const onCloseRef = useRef(onClose)
  useEffect(() => { lightboxOpenRef.current = lightboxOpen }, [lightboxOpen])
  useEffect(() => { onCloseRef.current = onClose })
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current) }, [])

  // Native share sheet where available (Android/iOS/some desktop browsers -
  // already lists WhatsApp, Gmail, etc. as options there), falling back to
  // copy-to-clipboard with a brief inline confirmation everywhere else.
  const onShare = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!data) return
    const url = shareUrl(data.style_id)
    if (navigator.share) {
      try {
        await navigator.share({ title: data.style_id, text: `${data.style_id} — ${priceText(data)}`, url })
      } catch {
        // AbortError from the user dismissing the sheet - not a failure
      }
      return
    }
    try {
      await navigator.clipboard.writeText(shareText(data))
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard access denied (e.g. insecure context) - nothing more we
      // can do without a permissions prompt of our own.
    }
  }

  const onShareWhatsApp = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!data) return
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText(data))}`, '_blank', 'noopener')
  }

  // Makes the phone/browser back button close this modal one layer at a
  // time (lightbox first, then the modal itself) instead of leaving the
  // whole site, the way any other native-feeling overlay behaves. Opening
  // this modal pushes one history entry; opening the lightbox on top of it
  // pushes a second. Every close action in this component - the X buttons,
  // clicking the backdrop, Escape - goes through `goBack` below instead of
  // calling onClose/setLightboxOpen directly, so a UI close and a real
  // back-button press are handled by the exact same code path and always
  // leave history balanced (no orphaned entries either way).
  useEffect(() => {
    window.history.pushState({ styleDetailModal: true }, '')
    const onPopState = () => {
      if (lightboxOpenRef.current) setLightboxOpen(false)
      else onCloseRef.current()
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (lightboxOpen) window.history.pushState({ styleDetailLightbox: true }, '')
  }, [lightboxOpen])

  const goBack = () => window.history.back()

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
      if (e.key === 'Escape') window.history.back()
      if (e.key === 'ArrowLeft') setActiveIdx(i => (images.length ? (i - 1 + images.length) % images.length : i))
      if (e.key === 'ArrowRight') setActiveIdx(i => (images.length ? (i + 1) % images.length : i))
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [])

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

  // Same idea as the main carousel's track above, but measured separately
  // since the lightbox is a different (full-viewport) width - only mounted
  // while open, so this only ever observes while it's actually visible.
  useEffect(() => {
    const el = lightboxTrackRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => setLightboxTrackWidth(entries[0].contentRect.width))
    setLightboxTrackWidth(el.clientWidth)
    ro.observe(el)
    return () => ro.disconnect()
  }, [lightboxOpen])

  const images = data?.images ?? []

  const goPrev = () => setActiveIdx(i => (i - 1 + images.length) % images.length)
  const goNext = () => setActiveIdx(i => (i + 1) % images.length)

  const onPointerDown = (e: React.PointerEvent) => {
    if (images.length < 2) return
    dragStartX.current = e.clientX
    setDragging(true)
    // Some mobile WebKit versions throw here for touch-derived pointer
    // events in certain states - never let that abort the drag, since
    // capture is just an optimization (keeps move events coming even if
    // the finger leaves the element's bounds), not a requirement.
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId) } catch { /* noop */ }
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

  // ---- Full-screen gallery pinch/double-tap zoom + pan ----
  // Scoped entirely to the lightbox: pinch with two fingers, double-tap to
  // toggle zoom, and (while zoomed) drag with one finger to pan instead of
  // swiping to the next slide. Reset whenever the slide changes or the
  // gallery closes, so you never land on a new/reopened image pre-zoomed.
  const MIN_ZOOM = 1
  const MAX_ZOOM = 4
  const DOUBLE_TAP_ZOOM = 2.5
  const [zoomScale, setZoomScale] = useState(1)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const zoomStateRef = useRef({ scale: 1, panX: 0, panY: 0 })
  useEffect(() => { zoomStateRef.current = { scale: zoomScale, panX, panY } }, [zoomScale, panX, panY])
  useEffect(() => { setZoomScale(1); setPanX(0); setPanY(0) }, [activeIdx, lightboxOpen])

  const lbPointers = useRef(new Map<number, { x: number; y: number }>())
  const lbPinch = useRef<{ dist: number; scale: number; midX: number; midY: number } | null>(null)
  const lbPan = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null)
  const lbLastTap = useRef<{ time: number; x: number; y: number } | null>(null)
  const lbTapCandidate = useRef<{ x: number; y: number; time: number; pointerId: number } | null>(null)

  const clampPan = (scale: number, x: number, y: number) => {
    const el = lightboxTrackRef.current
    const boundX = el ? (el.clientWidth * (scale - 1)) / 2 : 0
    const boundY = el ? (el.clientHeight * (scale - 1)) / 2 : 0
    return {
      x: Math.max(-boundX, Math.min(boundX, x)),
      y: Math.max(-boundY, Math.min(boundY, y)),
    }
  }

  // Zooms in/out anchored at a specific screen point (pinch midpoint or a
  // double-tap) so that point stays visually put instead of the image
  // jumping to re-center on every zoom change.
  const zoomAt = (screenX: number, screenY: number, fromScale: number, fromPanX: number, fromPanY: number, toScale: number) => {
    const el = lightboxTrackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const midX = screenX - (rect.left + rect.width / 2)
    const midY = screenY - (rect.top + rect.height / 2)
    const ratio = toScale / fromScale
    const nextPanX = midX - (midX - fromPanX) * ratio
    const nextPanY = midY - (midY - fromPanY) * ratio
    const clamped = clampPan(toScale, nextPanX, nextPanY)
    setZoomScale(toScale)
    setPanX(clamped.x)
    setPanY(clamped.y)
  }

  const lbOnPointerDown = (e: React.PointerEvent) => {
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId) } catch { /* noop */ }
    lbPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (lbPointers.current.size === 2) {
      // Second finger down - a swipe or single-finger pan already in
      // progress is now a pinch instead.
      dragStartX.current = null
      setDragging(false)
      setDragDeltaX(0)
      lbPan.current = null
      const pts = Array.from(lbPointers.current.values())
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      lbPinch.current = {
        dist,
        scale: zoomStateRef.current.scale,
        midX: (pts[0].x + pts[1].x) / 2,
        midY: (pts[0].y + pts[1].y) / 2,
      }
      return
    }

    lbTapCandidate.current = { x: e.clientX, y: e.clientY, time: Date.now(), pointerId: e.pointerId }

    if (zoomStateRef.current.scale > 1.01) {
      lbPan.current = { startX: e.clientX, startY: e.clientY, panX: zoomStateRef.current.panX, panY: zoomStateRef.current.panY }
    } else {
      onPointerDown(e)
    }
  }

  const lbOnPointerMove = (e: React.PointerEvent) => {
    if (!lbPointers.current.has(e.pointerId)) return
    lbPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (lbPointers.current.size === 2 && lbPinch.current) {
      const pts = Array.from(lbPointers.current.values())
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const nextScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, lbPinch.current.scale * (dist / lbPinch.current.dist)))
      zoomAt(lbPinch.current.midX, lbPinch.current.midY, lbPinch.current.scale, zoomStateRef.current.panX, zoomStateRef.current.panY, nextScale)
      return
    }

    if (lbPan.current) {
      const dx = e.clientX - lbPan.current.startX
      const dy = e.clientY - lbPan.current.startY
      const clamped = clampPan(zoomStateRef.current.scale, lbPan.current.panX + dx, lbPan.current.panY + dy)
      setPanX(clamped.x)
      setPanY(clamped.y)
      return
    }

    // A single finger having moved far enough rules out a tap, whether or
    // not it ends up passing the swipe threshold too.
    if (lbTapCandidate.current && Math.hypot(e.clientX - lbTapCandidate.current.x, e.clientY - lbTapCandidate.current.y) > 10) {
      lbTapCandidate.current = null
    }
    onPointerMove(e)
  }

  const lbOnPointerUp = (e: React.PointerEvent) => {
    lbPointers.current.delete(e.pointerId)

    if (lbPointers.current.size < 2) lbPinch.current = null
    if (lbPointers.current.size === 0) {
      lbPan.current = null
      // Snap fully back to identity once released - a pinch that ends up
      // barely above 1x reads as a mis-tap, not an intentional small zoom.
      if (zoomStateRef.current.scale < 1.05) { setZoomScale(1); setPanX(0); setPanY(0) }
    }

    const tap = lbTapCandidate.current
    lbTapCandidate.current = null
    if (tap && tap.pointerId === e.pointerId && Date.now() - tap.time < 300) {
      const last = lbLastTap.current
      lbLastTap.current = { time: Date.now(), x: e.clientX, y: e.clientY }
      if (last && Date.now() - last.time < 350 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 40) {
        lbLastTap.current = null
        const current = zoomStateRef.current
        if (current.scale > 1.01) zoomAt(e.clientX, e.clientY, current.scale, current.panX, current.panY, 1)
        else zoomAt(e.clientX, e.clientY, 1, 0, 0, DOUBLE_TAP_ZOOM)
        return
      }
    }

    if (!lbPan.current) endDrag()
  }

  const lbImageStyle = (i: number): React.CSSProperties =>
    i === activeIdx
      ? { transform: `translate(${panX}px, ${panY}px) scale(${zoomScale})`, transition: (lbPan.current || lbPinch.current) ? 'none' : 'transform 200ms ease-out' }
      : {}

  // Mobile-only tap-to-open: desktop keeps the dedicated expand button as
  // the sole way in (a plain click there is more likely to be someone just
  // browsing), but on mobile - where the Photos thumbnail strip is now
  // hidden - tapping the image is the natural way to reach the full-screen
  // gallery. Matches the md breakpoint the image panel itself switches on
  // (aspect-square below it, md:aspect-auto at/above). Gated on drag
  // distance so a real swipe-to-next-slide never also opens the gallery.
  const onImageAreaClick = () => {
    if (images.length === 0 || Math.abs(dragDeltaX) > 5) return
    if (window.innerWidth < 768) setLightboxOpen(true)
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
  const lightboxDragPercent = lightboxTrackWidth > 0 ? (dragDeltaX / lightboxTrackWidth) * 100 : 0
  const lightboxTrackStyle: React.CSSProperties = {
    transform: `translateX(calc(${-activeIdx * 100}% + ${lightboxDragPercent}%))`,
    transition: dragging ? 'none' : 'transform 380ms cubic-bezier(0.22, 1, 0.36, 1)',
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center overflow-y-auto p-0 sm:p-6"
      onClick={goBack}
    >
      <div
        // dvh (dynamic viewport height), not vh - on mobile, vh is based on
        // the largest possible viewport (browser chrome hidden), so a
        // max-height in vh can end up taller than what's actually visible
        // while the URL bar/toolbar is showing, pushing the modal's top
        // (the image, with its style-code badge) off the top of the
        // screen. dvh tracks the real visible viewport. The outer wrapper
        // above also now scrolls and starts from the top on mobile instead
        // of center-clipping, as a fallback for any phone/zoom level where
        // the modal is still taller than the visible screen.
        className="bg-[var(--color-paper)] w-full max-w-4xl sm:max-h-[92dvh] rounded-none sm:rounded-2xl overflow-hidden shadow-2xl grid grid-cols-1 md:grid-cols-2 my-0 sm:my-auto"
        onClick={e => e.stopPropagation()}
      >
        <div
          className="relative bg-white aspect-square md:aspect-auto md:h-full overflow-hidden border-r border-[var(--color-line)] touch-pan-y select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClick={onImageAreaClick}
          style={{ cursor: images.length > 1 ? (dragging ? 'grabbing' : 'grab') : 'default' }}
        >
          {loading ? (
            <div className="w-full h-full flex items-center justify-center">
              <Loader2 size={28} className="text-[var(--color-ink)]/25 animate-spin" />
            </div>
          ) : images.length > 0 ? (
            <>
              {/* Always shows the whole photo, never cropped, on any
                  screen/aspect ratio - a blurred, scaled-up copy of the
                  same image fills any leftover space behind the real
                  (object-contain, uncropped) image instead of plain
                  letterbox bars, so it never looks like it's just "not
                  fitting" the panel. */}
              <div ref={trackRef} className="flex w-full h-full" style={trackStyle}>
                {images.map((img, i) => (
                  <div key={img.drive_file_id} className="relative w-full h-full shrink-0 overflow-hidden flex items-center justify-center">
                    <img
                      src={imageUrl(img.drive_file_id, 'w1200')}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                      className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-40 pointer-events-none"
                    />
                    <img
                      src={imageUrl(img.drive_file_id, 'w1200')}
                      alt={data?.style_id}
                      draggable={false}
                      loading={Math.abs(i - activeIdx) <= 1 ? 'eager' : 'lazy'}
                      className="relative w-full h-full object-contain pointer-events-none"
                    />
                  </div>
                ))}
              </div>
              <div className="absolute top-2 right-2 flex items-center gap-1.5">
                <button
                  onClick={onShareWhatsApp}
                  className="bg-black/10 hover:bg-black/20 text-white rounded-full p-1.5"
                  aria-label="Share on WhatsApp"
                  title="Share on WhatsApp"
                >
                  <WhatsAppIcon size={14} />
                </button>
                <button
                  onClick={onShare}
                  className="bg-black/10 hover:bg-black/20 text-white rounded-full p-1.5"
                  aria-label="Share"
                  title="Share"
                >
                  <Share2 size={14} />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); setLightboxOpen(true) }}
                  className="bg-black/10 hover:bg-black/20 text-white rounded-full p-1.5"
                  aria-label="View full screen"
                  title="View full screen"
                >
                  <Expand size={14} />
                </button>
              </div>
              {images.length > 1 && (
                <>
                  <button
                    onClick={e => { e.stopPropagation(); goPrev() }}
                    className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/5 hover:bg-black/10 text-[var(--color-ink)] rounded-full p-1.5"
                    aria-label="Previous image"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); goNext() }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/5 hover:bg-black/10 text-[var(--color-ink)] rounded-full p-1.5"
                    aria-label="Next image"
                  >
                    <ChevronRight size={18} />
                  </button>
                  <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
                    {images.map((_, i) => (
                      <button
                        key={i}
                        onClick={e => { e.stopPropagation(); setActiveIdx(i) }}
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
            onClick={goBack}
            className="absolute top-4 right-4 text-[var(--color-ink)]/50 hover:text-[var(--color-ink)] rounded-full p-1.5 hover:bg-[var(--color-paper2)]"
            aria-label="Close"
          >
            <X size={20} />
          </button>

          {copied && (
            <div className="absolute top-14 right-4 bg-[var(--color-ink)] text-[var(--color-paper)] text-xs px-3 py-1.5 rounded-full shadow-lg z-10">
              Link copied
            </div>
          )}

          {loading || !data ? (
            <div className="animate-pulse space-y-4 pt-2">
              <div className="h-6 w-40 bg-[var(--color-paper2)] rounded" />
              <div className="h-4 w-24 bg-[var(--color-paper2)] rounded" />
              <div className="h-4 w-32 bg-[var(--color-paper2)] rounded" />
            </div>
          ) : (
            <div className="space-y-6 pt-2">
              <div>
                <div className="flex items-center justify-between gap-2">
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
                  <div className="flex items-center gap-1 shrink-0 mr-8">
                    <button
                      onClick={onShareWhatsApp}
                      className="text-[var(--color-ink)]/50 hover:text-[var(--color-ink)] rounded-full p-1.5 hover:bg-[var(--color-paper2)]"
                      aria-label="Share on WhatsApp"
                      title="Share on WhatsApp"
                    >
                      <WhatsAppIcon size={16} />
                    </button>
                    <button
                      onClick={onShare}
                      className="text-[var(--color-ink)]/50 hover:text-[var(--color-ink)] rounded-full p-1.5 hover:bg-[var(--color-paper2)]"
                      aria-label="Share"
                      title="Share"
                    >
                      <Share2 size={16} />
                    </button>
                  </div>
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
                    <div className="divide-y divide-[var(--color-ink)]/15">
                      {groupSizesByPrice(data.size_prices).map(({ sizes, price }) => (
                        <div key={sizes.join('-')} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                          <span className="flex flex-wrap gap-x-3 text-sm font-semibold">
                            {sizes.map(sz => <span key={sz}>{sz}</span>)}
                          </span>
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
                // Hidden on mobile - the dot indicators + swipe already
                // cover browsing images there, and this strip's own space
                // is better spent letting the full-screen gallery (tap the
                // image, or the expand button) be the one place with a
                // thumbnail strip on small screens.
                <div className="hidden md:block">
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

      {lightboxOpen && images.length > 0 && (
        <div
          className="fixed inset-0 z-[70] bg-white flex flex-col"
          onClick={e => { e.stopPropagation(); goBack() }}
        >
          <button
            onClick={e => { e.stopPropagation(); goBack() }}
            className="absolute top-4 right-4 z-10 text-[var(--color-ink)]/70 hover:text-[var(--color-ink)] bg-black/5 hover:bg-black/10 rounded-full p-2"
            aria-label="Close full screen"
          >
            <X size={22} />
          </button>
          <div
            // touch-none (not touch-pan-y like the main carousel) - this
            // pane has nothing to vertically scroll, so the browser should
            // never contest the gesture for native scrolling before our
            // pointer handlers get to decide it's a horizontal swipe. On at
            // least some mobile browsers, pan-y still let the OS "claim"
            // an ambiguous touch (e.g. a slightly diagonal swipe) for
            // scrolling before JS saw enough movement to call it - fully
            // disabling native touch handling here removes that race.
            className="flex-1 relative overflow-hidden touch-none select-none"
            style={{ cursor: zoomScale > 1 ? 'grab' : images.length > 1 ? (dragging ? 'grabbing' : 'grab') : 'default' }}
            onPointerDown={lbOnPointerDown}
            onPointerMove={lbOnPointerMove}
            onPointerUp={lbOnPointerUp}
            onPointerCancel={lbOnPointerUp}
            onClick={e => e.stopPropagation()}
          >
            <div ref={lightboxTrackRef} className="flex w-full h-full" style={lightboxTrackStyle}>
              {images.map((img, i) => (
                <div key={img.drive_file_id} className="w-full h-full shrink-0 flex items-center justify-center overflow-hidden">
                  <img
                    src={imageUrl(img.drive_file_id, 'w1200')}
                    alt={data?.style_id}
                    draggable={false}
                    loading={Math.abs(i - activeIdx) <= 1 ? 'eager' : 'lazy'}
                    className="max-w-full max-h-full object-contain pointer-events-none"
                    style={lbImageStyle(i)}
                  />
                </div>
              ))}
            </div>
            {images.length > 1 && (
              <>
                <button
                  onClick={e => { e.stopPropagation(); goPrev() }}
                  className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 text-[var(--color-ink)]/70 hover:text-[var(--color-ink)] bg-black/5 hover:bg-black/10 rounded-full p-2"
                  aria-label="Previous image"
                >
                  <ChevronLeft size={22} />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); goNext() }}
                  className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 text-[var(--color-ink)]/70 hover:text-[var(--color-ink)] bg-black/5 hover:bg-black/10 rounded-full p-2"
                  aria-label="Next image"
                >
                  <ChevronRight size={22} />
                </button>
              </>
            )}
          </div>
          {images.length > 1 && (
            <div className="shrink-0 flex justify-center gap-2 overflow-x-auto px-4 py-3 hide-scrollbar" onClick={e => e.stopPropagation()}>
              {images.map((img, i) => (
                <button
                  key={img.drive_file_id}
                  onClick={() => setActiveIdx(i)}
                  className={`shrink-0 w-12 aspect-[3/4] rounded-md overflow-hidden border-2 transition-colors ${
                    i === activeIdx ? 'border-[var(--color-gold)]' : 'border-transparent opacity-60 hover:opacity-100'
                  }`}
                >
                  <img
                    src={imageUrl(img.drive_file_id, 'w600')}
                    alt={`${data?.style_id} ${i + 1}`}
                    draggable={false}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
