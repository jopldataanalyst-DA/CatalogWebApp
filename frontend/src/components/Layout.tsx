import { Outlet, Link, useLocation } from 'react-router-dom'
import { Search } from 'lucide-react'

export function Layout() {
  const location = useLocation()

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--color-line)] bg-[var(--color-paper)]/90 backdrop-blur sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <Link to="/" className="shrink-0">
            <h1
              className="text-lg sm:text-xl tracking-wide"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Rajnandini Fashion
            </h1>
            <p className="text-[11px] uppercase tracking-[0.15em] text-[var(--color-ink)]/50">B2B CATALOG</p>
          </Link>

          <nav className="flex items-center gap-1.5">
            <Link
              to="/"
              className={`text-sm font-medium px-3.5 py-2 rounded-full transition-colors ${
                location.pathname === '/' ? 'bg-[var(--color-ink)] text-[var(--color-paper)]' : 'text-[var(--color-ink)]/70 hover:bg-[var(--color-paper2)]'
              }`}
            >
              Home
            </Link>
            <Link
              to="/search"
              className={`flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-full transition-colors ${
                location.pathname === '/search' ? 'bg-[var(--color-ink)] text-[var(--color-paper)]' : 'text-[var(--color-ink)]/70 hover:bg-[var(--color-paper2)]'
              }`}
            >
              <Search size={14} />
              <span className="hidden sm:inline">Browse All</span>
            </Link>
          </nav>
        </div>
      </header>

      <Outlet />
    </div>
  )
}
