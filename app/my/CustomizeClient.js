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

import { Fragment, useState, useRef, useTransition } from 'react';
import { PANELS, GROUP_ORDER, GROUP_LABELS } from '@/lib/panels';
import { saveUserLayout } from '@/app/actions/dashboard';
// Both reorder paths call these, so arrows and drag cannot diverge at the save
// layer - see lib/my/reorder.js.
import { swapAdjacent, moveToIndex } from '@/lib/my/reorder';

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
  const isVisible = (id) => !isConditional(id) && id in panels;

  function move(id, dir) {
    setActive((prev) => swapAdjacent(prev, id, dir, isVisible));
  }

  // ---- DRAG, POINTER ONLY -------------------------------------------------
  // SUPPLEMENTS the arrows, never replaces them: arrows stay the touch and
  // keyboard path. Touch drag is deliberately NOT wired - a scrolling page and
  // a drag gesture fight over the same finger, and losing that fight means the
  // page will not scroll in customize mode.
  //
  // The handle is the only grab target. Cards contain links and buttons, and a
  // whole-card drag would swallow every one of them.
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);

  function onHandleDown(e, id) {
    // Left button / primary pointer only; and never a touch pointer.
    if (e.pointerType === 'touch' || (e.button != null && e.button !== 0)) return;
    e.preventDefault();
    setDragId(id);
  }

  function onCardEnter(id) {
    if (dragId && id !== dragId) setOverId(id);
  }

  function onDrop() {
    if (dragId && overId && dragId !== overId) {
      setActive((prev) => {
        const target = visibleIds(prev).indexOf(overId);
        return target < 0 ? prev : moveToIndex(prev, dragId, target, isVisible);
      });
    }
    setDragId(null);
    setOverId(null);
  }

  const visibleIds = (list) => list.filter((p) => isVisible(p.id)).map((p) => p.id);

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

      {/* A release ANYWHERE ends the drag. Without this a pointerup outside any
          card leaves the lifted state stuck and the next click reorders. */}
      <div className="my-grid" onPointerUp={onDrop} onPointerLeave={onDrop}>
        {renderList.map((p) => {
          const node = panels[p.id];
          // Normal mode, and conditional panels in any mode: place the node
          // VERBATIM (never clone -- the node is a server-component element
          // whose type is not in the client bundle, so cloneElement would read
          // node.type === undefined and throw). A keyed Fragment supplies the
          // React key and adds NO DOM node, so the node's own .panel .panel-X
          // stays a direct child of .my-grid and the existing spans apply.
          if (!customize || isConditional(p.id)) {
            return <Fragment key={p.id}>{node}</Fragment>;
          }
          // Edit mode, non-conditional: wrap in .panel-slot and prepend the
          // .pedit strip. The slot becomes the grid item (see my.css span fix).
          const i = nonCondPresent.findIndex((x) => x.id === p.id);
          const name = PANELS[p.id]?.name ?? p.id;
          return (
            <div
              key={p.id}
              className={`panel-slot editing${dragId === p.id ? ' dragging' : ''}${overId === p.id ? ' dropzone' : ''}`}
              onPointerEnter={() => onCardEnter(p.id)}
              onPointerUp={onDrop}
            >
              <div className="pedit">
                {/* The grab target, and the only one. */}
                <span
                  className="grip"
                  role="button"
                  aria-label={`Drag ${name} to reorder`}
                  onPointerDown={(e) => onHandleDown(e, p.id)}
                >::</span>
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
