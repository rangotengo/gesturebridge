'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAdminSession } from '@/hooks/useAdminSession';

/**
 * Navbar — standard design matching all other pages.
 * Uses the .navbar / .navbar-brand / .nav-link classes from globals.css.
 */
export default function Navbar(): React.ReactElement {
  const { admin, isAdmin } = useAdminSession();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const closeMenu = (): void => setIsMenuOpen(false);

  return (
    <nav className="navbar">
      <div className="navbar-logo">
        <Link href="/" className="navbar-brand">
          GestureBridge
        </Link>
      </div>

      <div className="navbar-links">
        <Link href="/" className="nav-link">Recognition</Link>
        {isAdmin && (
          <>
            <Link href="/ml/collect" className="nav-link">Collect</Link>
            <Link href="/ml/import" className="nav-link">Import</Link>
            <Link href="/ml/history" className="nav-link">History</Link>
            <Link href="/ml/evaluation" className="nav-link">Evaluation</Link>
          </>
        )}
        {isAdmin ? (
          <Link href="/admin/logout" className="nav-link" title={admin?.email}>
            Logout
          </Link>
        ) : (
          <Link href="/admin/login" className="nav-link">Admin</Link>
        )}
      </div>

      <button
        type="button"
        className="min-[481px]:hidden rounded-md border border-white/15 px-3 py-1.5 text-sm text-white"
        aria-expanded={isMenuOpen}
        aria-controls="mobile-navigation"
        aria-label={isMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
        onClick={() => setIsMenuOpen((open) => !open)}
      >
        {isMenuOpen ? 'Close' : 'Menu'}
      </button>

      {isMenuOpen && (
        <div
          id="mobile-navigation"
          className="absolute inset-x-0 top-full flex flex-col gap-1 border-b border-white/10 bg-neutral-950/95 p-3 shadow-xl min-[481px]:hidden"
        >
          <Link href="/" className="rounded px-3 py-2 text-sm text-white" onClick={closeMenu}>Recognition</Link>
          {isAdmin && (
            <>
              <Link href="/ml/collect" className="rounded px-3 py-2 text-sm text-white" onClick={closeMenu}>Collect</Link>
              <Link href="/ml/import" className="rounded px-3 py-2 text-sm text-white" onClick={closeMenu}>Import</Link>
              <Link href="/ml/history" className="rounded px-3 py-2 text-sm text-white" onClick={closeMenu}>History</Link>
              <Link href="/ml/evaluation" className="rounded px-3 py-2 text-sm text-white" onClick={closeMenu}>Evaluation</Link>
            </>
          )}
          <Link
            href={isAdmin ? '/admin/logout' : '/admin/login'}
            className="rounded px-3 py-2 text-sm text-white"
            title={isAdmin ? admin?.email : undefined}
            onClick={closeMenu}
          >
            {isAdmin ? 'Logout' : 'Admin'}
          </Link>
        </div>
      )}
    </nav>
  );
}
