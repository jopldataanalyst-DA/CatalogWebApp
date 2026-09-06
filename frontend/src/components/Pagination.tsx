import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'

const PAGE_SIZE_OPTIONS = [8, 12, 16, 20]

interface Props {
  page: number
  totalPages: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

function PageSizeMenu({ pageSize, onChange }: { pageSize: number; onChange: (size: number) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs font-medium bg-white border border-[var(--color-line)] rounded-full px-3.5 py-2 outline-none cursor-pointer hover:border-[var(--color-gold)] transition-colors"
      >
        {pageSize} per page
        <ChevronDown size={13} className={`text-[var(--color-ink)]/40 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-1.5 w-32 rounded-xl border border-[var(--color-line)] bg-white shadow-lg p-1 z-20">
          {PAGE_SIZE_OPTIONS.map(n => (
            <button
              key={n}
              onClick={() => { onChange(n); setOpen(false) }}
              className={`w-full text-left text-xs px-3 py-2 rounded-lg transition-colors ${
                n === pageSize
                  ? 'bg-[var(--color-gold)] text-white font-semibold'
                  : 'text-[var(--color-ink)]/70 hover:bg-[var(--color-paper2)]'
              }`}
            >
              {n} per page
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Pagination({ page, totalPages, pageSize, total, onPageChange, onPageSizeChange }: Props) {
  const [pageInput, setPageInput] = useState(String(page))
  useEffect(() => { setPageInput(String(page)) }, [page])

  const commitPageInput = () => {
    let n = parseInt(pageInput, 10)
    if (isNaN(n) || n < 1) n = 1
    if (n > totalPages) n = totalPages
    setPageInput(String(n))
    if (n !== page) onPageChange(n)
  }

  if (total === 0) return null

  return (
    <div className="flex flex-wrap items-center justify-center gap-4 pt-10">
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="w-8 h-8 flex items-center justify-center rounded-full border border-[var(--color-line)] disabled:opacity-30 hover:border-[var(--color-gold)] transition-colors"
        >
          <ChevronLeft size={15} />
        </button>
        <div className="flex items-center border border-[var(--color-line)] rounded-full overflow-hidden bg-white">
          <span className="px-3 py-1.5 text-xs text-[var(--color-ink)]/50">Page</span>
          <input
            type="number"
            min={1}
            max={totalPages}
            value={pageInput}
            onChange={e => setPageInput(e.target.value)}
            onBlur={commitPageInput}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
            className="w-10 text-center text-sm outline-none border-x border-[var(--color-line)] py-1.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="px-3 py-1.5 text-xs text-[var(--color-ink)]/50">of {totalPages}</span>
        </div>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="w-8 h-8 flex items-center justify-center rounded-full border border-[var(--color-line)] disabled:opacity-30 hover:border-[var(--color-gold)] transition-colors"
        >
          <ChevronRight size={15} />
        </button>
      </div>

      <PageSizeMenu pageSize={pageSize} onChange={onPageSizeChange} />

      <span className="text-xs text-[var(--color-ink)]/40">{total.toLocaleString()} styles</span>
    </div>
  )
}
