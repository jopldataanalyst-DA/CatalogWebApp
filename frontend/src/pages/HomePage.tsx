import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { fetchHome } from '../api'
import { StyleCard } from '../components/StyleCard'
import { StyleDetailModal } from '../components/StyleDetail'
import type { HomeSection } from '../types'

function SectionSkeleton() {
  return (
    <div className="flex gap-4 sm:gap-5 overflow-hidden">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="w-48 sm:w-56 shrink-0 animate-pulse rounded-2xl overflow-hidden border border-[var(--color-line)]">
          <div className="aspect-[3/5] bg-[var(--color-paper2)]" />
          <div className="p-4 space-y-2">
            <div className="h-3 w-2/3 bg-[var(--color-paper2)] rounded" />
            <div className="h-3 w-1/3 bg-[var(--color-paper2)] rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

function HomeSectionRow({ section, onOpen }: { section: HomeSection; onOpen: (styleId: string) => void }) {
  if (section.items.length === 0) return null
  return (
    <section className="py-8 sm:py-10 border-b border-[var(--color-line)] last:border-0">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6">
        <div className="flex items-end justify-between gap-4 mb-5">
          <div>
            <h2 className="text-xl sm:text-2xl" style={{ fontFamily: 'var(--font-display)' }}>{section.title}</h2>
            <p className="text-sm text-[var(--color-ink)]/50 mt-0.5">{section.subtitle}</p>
          </div>
          <Link
            to={`/search?collection=${section.key}`}
            className="flex items-center gap-1 text-xs sm:text-sm font-medium text-[var(--color-gold-dark)] hover:underline shrink-0"
          >
            Browse all <ArrowRight size={14} />
          </Link>
        </div>

        <div className="flex items-stretch gap-4 sm:gap-5 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x snap-mandatory hide-scrollbar">
          {section.items.map(item => (
            <div key={item.style_id} className="w-48 sm:w-56 shrink-0 snap-start">
              <StyleCard item={item} onOpen={() => onOpen(item.style_id)} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function HomePage() {
  const [sections, setSections] = useState<HomeSection[]>([])
  const [loading, setLoading] = useState(true)
  const [openStyle, setOpenStyle] = useState<string | null>(null)

  useEffect(() => {
    fetchHome().then(d => setSections(d.sections)).finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <div
        className="relative overflow-hidden border-b border-[var(--color-line)] bg-cover bg-center"
        style={{ backgroundImage: "url('/hero-banner.jpg')" }}
      >
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(90deg, var(--color-paper) 0%, var(--color-paper) 42%, rgba(250,248,244,0.9) 52%, rgba(250,248,244,0.35) 65%, transparent 78%)' }}
        />
        <div className="relative max-w-[1600px] mx-auto px-4 sm:px-6 py-20 sm:py-28">
          <div className="max-w-md">
            <p className="text-[11px] uppercase tracking-[0.25em] text-[var(--color-gold-dark)] font-semibold mb-4 flex items-center gap-2">
              Wholesale &middot; B2B Only <span className="inline-block w-8 h-px bg-[var(--color-gold-dark)]" />
            </p>
            <h1
              className="text-4xl sm:text-5xl leading-tight text-[var(--color-ink)]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Rajnandini Fashion, built around what sells.
            </h1>
            <p className="text-[var(--color-ink)]/60 mt-5 text-sm sm:text-base">
              Real sales data. Real demand. Better wholesale decisions.
            </p>
            <Link
              to="/search"
              className="inline-flex items-center gap-2 mt-8 bg-[var(--color-ink)] text-[var(--color-paper)] px-6 py-3 rounded-full text-sm font-medium hover:bg-[var(--color-gold-dark)] transition-colors"
            >
              Browse All Products <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="py-10 max-w-[1600px] mx-auto px-4 sm:px-6 space-y-10">
          <SectionSkeleton />
          <SectionSkeleton />
        </div>
      ) : sections.every(s => s.items.length === 0) ? (
        <div className="py-20 text-center text-[var(--color-ink)]/40 text-sm">
          No ranked styles yet —{' '}
          <Link to="/search" className="text-[var(--color-gold-dark)] hover:underline">browse the full catalog instead</Link>.
        </div>
      ) : (
        sections.map(section => (
          <HomeSectionRow key={section.key} section={section} onOpen={setOpenStyle} />
        ))
      )}

      {openStyle && <StyleDetailModal styleId={openStyle} onClose={() => setOpenStyle(null)} />}
    </div>
  )
}
