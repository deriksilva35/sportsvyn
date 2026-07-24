'use client';

/**
 * NavDropdown — accessible disclosure menu for the site header (FOOTBALL, SOCCER,
 * and the signed-in account cluster). No existing nav-dropdown pattern existed in
 * this codebase — the only disclosure idiom was the hamburger's aria-expanded
 * toggle — so this is a fresh WAI-ARIA menu-button: aria-haspopup + aria-expanded
 * on the trigger, role="menu"/"menuitem" on the panel/items, closes on outside
 * click, touchstart, and Escape. Ink surface, Saira Condensed items.
 *
 * items: array of
 *   { label, href }              -> a navigation link
 *   { label, onClick }           -> an action (e.g. Sign Out)
 *   { label, comingSoon: true }  -> a NON-interactive, muted item (no link, no
 *                                   dead href) with a "coming soon" tag
 */

import { useState, useRef, useEffect, useId } from 'react';

export default function NavDropdown({ label, items, align = 'left', active = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    function onDocPointer(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocPointer);
    document.addEventListener('touchstart', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocPointer);
      document.removeEventListener('touchstart', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`nav-dd${open ? ' open' : ''}`} ref={ref}>
      <button
        type="button"
        className={`nav-dd-btn${active ? ' active' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        {label}<span className="nav-dd-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="nav-dd-menu" id={menuId} role="menu" data-align={align}>
          {items.map((it) => {
            if (it.comingSoon) {
              return (
                <span key={it.label} className="nav-dd-item is-soon" role="menuitem" aria-disabled="true">
                  {it.label}<span className="nav-dd-soon">coming soon</span>
                </span>
              );
            }
            if (it.onClick) {
              return (
                <button
                  key={it.label}
                  type="button"
                  className="nav-dd-item"
                  role="menuitem"
                  onClick={() => { setOpen(false); it.onClick(); }}
                >
                  {it.label}
                </button>
              );
            }
            return (
              <a key={it.label} href={it.href} className="nav-dd-item" role="menuitem">{it.label}</a>
            );
          })}
        </div>
      )}
    </div>
  );
}
