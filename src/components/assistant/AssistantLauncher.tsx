import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CornerDownRight, Maximize2, Plus, Sparkles, X } from 'lucide-react';
import { usePermissions } from '../../app/usePermissions';
import { getAssistantStatus } from '../../services/assistantService';
import { cn } from '../../utils/cn';
import { ChatThread } from './ChatThread';
import { useAssistantChat } from './useAssistantChat';

const SIZE = 52;
const MARGIN = 16;
const GAP = 12;
const STORE_KEY = 'propto.assistant.position';
/** Bottom-right. Stored as fractions of the free space so it stays put when the window resizes. */
const HOME = { fx: 1, fy: 1 };

type Spot = { fx: number; fy: number };

function readSpot(): Spot {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (raw && typeof raw.fx === 'number' && typeof raw.fy === 'number') return { fx: clamp01(raw.fx), fy: clamp01(raw.fy) };
  } catch {
    // Blocked or corrupt storage: start in the corner.
  }
  return HOME;
}

function saveSpot(spot: Spot) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(spot));
  } catch {
    // The button still moves for this visit.
  }
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function useViewport() {
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return vp;
}

/**
 * The assistant on every page: a round button that opens a chat panel. Drag the button anywhere
 * (or focus it and use the arrow keys); it remembers where it was left, and the panel opens on
 * whichever side of it has room. The conversation survives moving between pages, because the
 * launcher lives in the layout rather than in any one page.
 */
export function AssistantLauncher() {
  const { can } = usePermissions();
  const { pathname } = useLocation();
  const state = useAssistantChat();
  const { w, h } = useViewport();
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [spot, setSpot] = useState<Spot>(readSpot);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);

  const freeW = Math.max(1, w - SIZE - MARGIN * 2);
  const freeH = Math.max(1, h - SIZE - MARGIN * 2);
  const left = MARGIN + spot.fx * freeW;
  const top = MARGIN + spot.fy * freeH;

  useEffect(() => {
    if (!open || configured !== null) return;
    getAssistantStatus().then((s) => setConfigured(s.configured)).catch(() => setConfigured(false));
  }, [open, configured]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // The full Assistant page already is the assistant.
  if (!can('assistant') || pathname.startsWith('/assistant')) return null;

  const moveTo = (x: number, y: number, persist: boolean) => {
    const next = { fx: clamp01((x - MARGIN) / freeW), fy: clamp01((y - MARGIN) / freeH) };
    setSpot(next);
    if (persist) saveSpot(next);
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, left, top, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    // A few pixels of wobble is still a click, not a drag.
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    if (!d.moved) { d.moved = true; setDragging(true); }
    moveTo(d.left + dx, d.top + dy, false);
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d?.moved) {
      justDragged.current = true;
      setDragging(false);
      saveSpot(spot);
    }
  };
  const onClick = () => {
    if (justDragged.current) { justDragged.current = false; return; }
    setOpen((v) => !v);
  };
  /** Arrow keys move it for anyone not using a mouse; Shift moves further, Home sends it back. */
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 96 : 24;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      moveTo(left + moves[e.key][0], top + moves[e.key][1], true);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setSpot(HOME);
      saveSpot(HOME);
    }
  };

  // The panel opens towards the middle of the screen, so it is never cut off by an edge.
  const panelW = Math.min(400, w - MARGIN * 2);
  const panelH = Math.min(600, h - SIZE - MARGIN * 2 - GAP);
  const onRight = left + SIZE / 2 > w / 2;
  const fitsBelow = h - (top + SIZE + GAP) - MARGIN >= panelH;
  const fitsAbove = top - GAP - MARGIN >= panelH;
  const fitsBeside = (onRight ? left - GAP - MARGIN : w - (left + SIZE + GAP) - MARGIN) >= panelW;
  let panelLeft: number;
  let panelTop: number;
  if (fitsAbove || fitsBelow || !fitsBeside) {
    // Above or below, preferring the side with more room; on a small screen it may have to overlap.
    panelLeft = onRight ? left + SIZE - panelW : left;
    panelTop = fitsAbove && (!fitsBelow || top + SIZE / 2 > h / 2) ? top - panelH - GAP : top + SIZE + GAP;
  } else {
    // Halfway up the screen neither fits, so it opens beside the button instead of covering it.
    panelLeft = onRight ? left - GAP - panelW : left + SIZE + GAP;
    panelTop = top + SIZE / 2 - panelH / 2;
  }
  panelLeft = clamp(panelLeft, MARGIN, w - panelW - MARGIN);
  panelTop = clamp(panelTop, MARGIN, h - panelH - MARGIN);
  const atHome = spot.fx === HOME.fx && spot.fy === HOME.fy;

  return (
    <>
      {open && (
        <section
          role="dialog" aria-label="Assistant"
          style={{ left: panelLeft, top: panelTop, width: panelW, height: panelH }}
          className="fixed z-40 flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-popover"
        >
          <header className="flex items-center gap-2 border-b border-line px-3 py-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-700" aria-hidden="true"><Sparkles size={15} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-ink">Propto Assistant</p>
              <p className="truncate text-2xs text-ink-subtle">{state.chat?.title ?? 'Asks live data · changes need your OK'}</p>
            </div>
            {!atHome && (
              <button type="button" onClick={() => { setSpot(HOME); saveSpot(HOME); }} title="Move the button back to the corner" aria-label="Move the button back to the corner" className="rounded-md p-1.5 text-ink-subtle hover:bg-surface-muted hover:text-ink focus-ring"><CornerDownRight size={14} /></button>
            )}
            <button type="button" onClick={state.fresh} title="New chat" aria-label="New chat" className="rounded-md p-1.5 text-ink-subtle hover:bg-surface-muted hover:text-ink focus-ring"><Plus size={15} /></button>
            <Link to={state.chat ? `/assistant?chat=${state.chat.id}` : '/assistant'} onClick={() => setOpen(false)} title="Open full page" aria-label="Open full page" className="rounded-md p-1.5 text-ink-subtle hover:bg-surface-muted hover:text-ink focus-ring"><Maximize2 size={14} /></Link>
            <button type="button" onClick={() => setOpen(false)} title="Close (Esc)" aria-label="Close assistant" className="rounded-md p-1.5 text-ink-subtle hover:bg-surface-muted hover:text-ink focus-ring"><X size={15} /></button>
          </header>
          <ChatThread state={state} notReady={configured === false} compact />
        </section>
      )}

      <button
        type="button"
        style={{ left, top, width: SIZE, height: SIZE, touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
        onKeyDown={onKeyDown}
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        aria-expanded={open}
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home"
        title="Ask Propto Assistant — drag to move it"
        className={cn(
          'group fixed z-40 flex select-none items-center justify-center rounded-full bg-brand-600 text-white ring-1 ring-inset ring-white/20',
          'shadow-[0_8px_24px_-8px_rgba(14,127,81,0.65),0_2px_6px_rgba(16,24,40,0.18)] transition-colors duration-150 hover:bg-brand-700 focus-ring',
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        )}
      >
        {/* A second, fainter ring gives the button an edge on both the light page and the navy sidebar. */}
        <span className="pointer-events-none absolute -inset-1 rounded-full border border-brand-500/30" aria-hidden="true" />
        {open ? <X size={21} /> : <Sparkles size={22} strokeWidth={1.8} />}
        {state.chat?.pending && !open && (
          <span className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-surface bg-accent-500" aria-label="Waiting for your approval" />
        )}
      </button>
    </>
  );
}
