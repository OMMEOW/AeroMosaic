"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fmtInt } from "@/lib/format";
import { IconFit, IconMinus, IconPlus } from "@/components/ui/icons";
import { cn } from "@/components/ui/cn";

/** View state, image-size independent so several viewers can be synchronised. */
export interface MosaicView {
  /** Zoom relative to fit (1 = fit). */
  rel: number;
  /** Image point at the viewport centre, 0..1. */
  cx: number;
  cy: number;
}

export const FIT_VIEW: MosaicView = { rel: 1, cx: 0.5, cy: 0.5 };

/**
 * Pan (drag), zoom (wheel / buttons), fit, 1:1. Controlled or uncontrolled.
 * Imperative actions are exposed through `actionsRef` for keyboard shortcuts.
 */
export function MosaicViewer({
  src,
  width,
  height,
  view: viewProp,
  onViewChange,
  className,
  label,
  actionsRef,
}: {
  src: string;
  width: number;
  height: number;
  view?: MosaicView;
  onViewChange?: (v: MosaicView) => void;
  className?: string;
  label: string;
  actionsRef?: React.MutableRefObject<{ fit: () => void; oneToOne: () => void; zoomBy: (f: number) => void } | null>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [local, setLocal] = useState<MosaicView>(FIT_VIEW);
  const view = viewProp ?? local;
  const setView = useCallback(
    (v: MosaicView) => {
      if (onViewChange) onViewChange(v);
      else setLocal(v);
    },
    [onViewChange],
  );
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; view: MosaicView } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = size.w && size.h ? Math.min(size.w / width, size.h / height) * 0.96 : 1;
  const zoom = fit * view.rel;
  const tx = size.w / 2 - view.cx * width * zoom;
  const ty = size.h / 2 - view.cy * height * zoom;
  const maxRel = Math.max(8 / fit, 2);

  const clampView = useCallback(
    (v: MosaicView): MosaicView => ({
      rel: Math.min(maxRel, Math.max(0.5, v.rel)),
      cx: Math.min(1, Math.max(0, v.cx)),
      cy: Math.min(1, Math.max(0, v.cy)),
    }),
    [maxRel],
  );

  const zoomAt = useCallback(
    (factor: number, px = size.w / 2, py = size.h / 2) => {
      const ix = (px - tx) / zoom;
      const iy = (py - ty) / zoom;
      const rel = Math.min(maxRel, Math.max(0.5, view.rel * factor));
      const z2 = fit * rel;
      setView(clampView({ rel, cx: (size.w / 2 - (px - ix * z2)) / (width * z2), cy: (size.h / 2 - (py - iy * z2)) / (height * z2) }));
    },
    [size, tx, ty, zoom, maxRel, view.rel, fit, width, height, setView, clampView],
  );

  const actions = {
    fit: () => setView(FIT_VIEW),
    oneToOne: () => setView(clampView({ ...view, rel: 1 / fit })),
    zoomBy: (f: number) => zoomAt(f),
  };
  useEffect(() => {
    if (actionsRef) actionsRef.current = actions;
  });

  // Wheel zoom needs a non-passive listener to stop page scroll.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const pct = Math.round(zoom * 100);

  return (
    <div className={cn("relative overflow-hidden rounded-lg border border-line bg-inset select-none", className)}>
      <div
        ref={box}
        className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing"
        tabIndex={0}
        role="img"
        aria-label={`${label}. Drag to pan, scroll to zoom.`}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, view };
        }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const ix = (e.clientX - r.left - tx) / zoom;
          const iy = (e.clientY - r.top - ty) / zoom;
          setCursor(ix >= 0 && iy >= 0 && ix <= width && iy <= height ? { x: ix, y: iy } : null);
          const d = drag.current;
          if (!d) return;
          const z = fit * d.view.rel;
          setView(clampView({ rel: d.view.rel, cx: d.view.cx - (e.clientX - d.x) / (width * z), cy: d.view.cy - (e.clientY - d.y) / (height * z) }));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          zoomAt(2, e.clientX - r.left, e.clientY - r.top);
        }}
      >
        {size.w > 0 && (
          // eslint-disable-next-line @next/next/no-img-element -- blob/backend URL, sized by transform
          <img
            src={src}
            alt=""
            draggable={false}
            width={width}
            height={height}
            className="absolute top-0 left-0 max-w-none origin-top-left"
            style={{
              transform: `translate(${tx}px, ${ty}px) scale(${zoom})`,
              imageRendering: zoom > 2 ? "pixelated" : "auto",
            }}
          />
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2">
        <span className="num rounded-sm bg-black/60 px-1.5 py-0.5 text-2xs text-white/80">
          {fmtInt(width)}×{fmtInt(height)} px
          {cursor && (
            <span className="text-white/60">
              {" "}
              · x {fmtInt(cursor.x)} y {fmtInt(cursor.y)}
            </span>
          )}
        </span>
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-md bg-black/60 p-0.5 text-white/85">
          <button type="button" className="rounded-sm p-1 hover:bg-white/15" onClick={() => zoomAt(1 / 1.5)} aria-label="Zoom out" title="Zoom out (−)">
            <IconMinus size={12} />
          </button>
          <span className="num w-11 text-center text-2xs" aria-live="polite">
            {pct}%
          </span>
          <button type="button" className="rounded-sm p-1 hover:bg-white/15" onClick={() => zoomAt(1.5)} aria-label="Zoom in" title="Zoom in (+)">
            <IconPlus size={12} />
          </button>
          <button type="button" className="rounded-sm p-1 hover:bg-white/15" onClick={actions.fit} aria-label="Zoom to fit" title="Fit (F)">
            <IconFit size={12} />
          </button>
          <button type="button" className="num rounded-sm px-1.5 py-0.5 text-2xs hover:bg-white/15" onClick={actions.oneToOne} aria-label="Zoom 1:1" title="1:1 (1)">
            1:1
          </button>
        </div>
      </div>
    </div>
  );
}
