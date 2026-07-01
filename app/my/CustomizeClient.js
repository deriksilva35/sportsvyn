'use client';

/**
 * DashboardCustomizer -- the client shell for My Sportsvyn.
 *
 * It NEVER builds panel content. The server (page.js, step 3) renders the
 * bound panels and hands them in as `panels` -- a plain { [id]: reactNode }
 * map of the panels it chose to render. This component only looks nodes up
 * by id and places / reorders / shows / hides them. "Absent from panels" ==
 * "not currently showing" (e.g. a conditional 'live' with no matches simply
 * is not a key in the object).
 *
 * Bound-ness is derived from the panels prop, NOT from PANEL_BINDINGS -- that
 * server-only module must never enter the client bundle. A panel is
 * togglable-on iff it is bound: its id is a key in panels, OR it is a
 * conditional panel (which may be bound-but-absent, e.g. live with no data).
 * Unbound ids (unbuilt free panels, member-tier panels) are library teasers:
 * their toggle is disabled.
 *
 * Save mirrors the FollowStar -> follows.js pattern: on leaving customize
 * mode, if the working layout changed we call saveUserLayout in a transition;
 * on { ok:false } (e.g. the server's empty_layout guard) we revert to the
 * last-known-good layout and stay usable.
 *
 * Conditional panels are AUTO: managed by the library toggle only, never
 * given an in-grid edit strip, and floated to the top when present.
 */

import { useState, useRef, useTransition, cloneElement } from 'react';
import { PANELS, GROUP_ORDER, GROUP_LABELS } from '@/lib/panels';
import { saveUserLayout } from '@/app/actions/dashboard';

const PANEL_COUNT = Object.keys(PANELS).length;

const MODE_NOTE =
  'Customize mode. Toggle panels in the library below to add or remove them. ' +
  'Use the arrows on each panel to reorder. Your layout saves to your account, ' +
  'so it follows you to every device and the app.';

const isConditional = (id) => PANELS[id]?.conditional === true;

// A layout row is { id, w? }. Normalize to compare working vs saved by value.
function serialize(list) {
  return JSON.stringify(
    list.map((p) => (Number.isInteger(p.w) && p.w > 0 ? { id: p.id, w: p.w } : { id: p.id })),
  );
}

export default function DashboardCustomizer({ panels = {}, initialActive = [] }) {
  const [customize, setCustomize] = useState(false);
  const [active, setActive] = useState(initialActive);
  const [, startTransition] = useTransition();
  // Last layout the server accepted (or the seed). Revert target on a failed save.
  const lastGoodRef = useRef(initialActive);

  const isBound = (id) => id in panels;
  const isActive = (id) => active.some((p) => p.id === id);

  // Reorder among the VISIBLE non-conditional panels (present in panels, in
  // working order). Swaps the two entries in place in the full active array so
  // conditional entries keep their slots (their array position is irrelevant --
  // the render floats them regardless).
  function move(id, dir) {
    setActive((prev) => {
      const visible = prev.filter((p) => !isConditional(p.id) && p.id in panels);
      const pos = visible.findIndex((p) => p.id === id);
      if (pos < 0) return prev;
      const target = pos + dir;
      if (target < 0 || target >= visible.length) return prev;
      const a = prev.indexOf(visible[pos]);
      const b = prev.indexOf(visible[target]);
      const next = [...prev];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
  }

  // Turn a panel on (append at end, no w -- we never invent a default) or off.
  function setPanel(id, on) {
    setActive((prev) => {
      const exists = prev.some((p) => p.id === id);
      if (on) return exists ? prev : [...prev, { id }];
      return prev.filter((p) => p.id !== id);
    });
  }

  function toggleCustomize() {
    if (!customize) {
      setCustomize(true);
      return;
    }
    // Leaving customize: persist only if the layout actually changed.
    setCustomize(false);
    if (serialize(active) === serialize(lastGoodRef.current)) return;
    startTransition(async () => {
      const result = await saveUserLayout(active, 'my');
      if (!result?.ok) {
        // Server rejected (e.g. empty_layout). Revert to last-known-good.
        setActive(lastGoodRef.current);
        return;
      }
      // Adopt the server's sanitized layout as the new canonical baseline.
      lastGoodRef.current = result.layout;
      setActive(result.layout);
    });
  }

  // Render partition: conditional-active-and-present first (floated, in working
  // order), then non-conditional active panels in working order. Only ids that
  // are BOTH active and a key in panels render at all.
  const condPresent = active.filter((p) => isConditional(p.id) && p.id in panels);
  const nonCondPresent = active.filter((p) => !isConditional(p.id) && p.id in panels);
  const renderList = [...condPresent, ...nonCondPresent];

  return (
    <>
      <button
        type="button"
        className={`customize-btn${customize ? ' active' : ''}`}
        onClick={toggleCustomize}
        aria-pressed={customize}
      >
        {customize ? 'Done' : 'Customize dashboard'}
      </button>

      {customize && <div className="mode-note show">{MODE_NOTE}</div>}

      <div className="my-grid">
        {renderList.map((p) => {
          const node = panels[p.id];
          // Normal mode, and conditional panels in any mode: place the node
          // bare (it already carries its own .panel .panel-X wrapper). Inject
          // a key without adding a DOM wrapper so the grid targets .panel-X.
          if (!customize || isConditional(p.id)) {
            return cloneElement(node, { key: p.id });
          }
          // Edit mode, non-conditional: wrap in .panel-slot and prepend the
          // .pedit strip. The slot becomes the grid item (see my.css span fix).
          const i = nonCondPresent.findIndex((x) => x.id === p.id);
          const name = PANELS[p.id]?.name ?? p.id;
          return (
            <div key={p.id} className="panel-slot editing">
              <div className="pedit">
                <span className="grip" aria-hidden="true">::</span>
                <button
                  type="button"
                  className="ebtn"
                  onClick={() => move(p.id, -1)}
                  disabled={i <= 0}
                  aria-label={`Move ${name} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="ebtn"
                  onClick={() => move(p.id, 1)}
                  disabled={i >= nonCondPresent.length - 1}
                  aria-label={`Move ${name} down`}
                >
                  ↓
                </button>
                <span className="spacer" />
                {PANELS[p.id]?.tier === 'member' && <span className="mtag">Member</span>}
                <button
                  type="button"
                  className="ebtn rm"
                  onClick={() => setPanel(p.id, false)}
                  aria-label={`Remove ${name}`}
                >
                  ×
                </button>
              </div>
              {node}
            </div>
          );
        })}
      </div>

      {customize && (
        <div className="library show">
          <div className="libhead">
            <span className="t">Panel library</span>
            <span className="c">
              {active.length} of {PANEL_COUNT} on
            </span>
          </div>
          {GROUP_ORDER.map((g) => (
            <div key={g}>
              <div className="libgroup">{GROUP_LABELS[g]}</div>
              {Object.keys(PANELS)
                .filter((id) => PANELS[id].group === g)
                .map((id) => {
                  const meta = PANELS[id];
                  const on = isActive(id);
                  // A row is togglable iff bound: present in panels, or a
                  // conditional (bound-but-maybe-absent) panel.
                  const togglable = isBound(id) || meta.conditional === true;
                  // Badge precedence: Member > Auto (conditional) > Soon
                  // (unbuilt/unbound free) > none.
                  let badge = null;
                  if (meta.tier === 'member') badge = { cls: 'mbadge', text: 'Member' };
                  else if (meta.conditional) badge = { cls: 'cbadge', text: 'Auto' };
                  else if (!isBound(id)) badge = { cls: 'cbadge', text: 'Soon' };
                  return (
                    <div key={id} className="librow">
                      <div>
                        <div className="ln">{meta.name}</div>
                        <div className="ld">{meta.desc}</div>
                      </div>
                      {badge ? <span className={badge.cls}>{badge.text}</span> : <span />}
                      <button
                        type="button"
                        className={`toggle${on ? ' on' : ''}${togglable ? '' : ' disabled'}`}
                        onClick={togglable ? () => setPanel(id, !on) : undefined}
                        disabled={!togglable}
                        aria-pressed={on}
                        aria-label={`${on ? 'Remove' : 'Add'} ${meta.name}`}
                      />
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
