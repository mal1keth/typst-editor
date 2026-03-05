import { useRef, useState, useCallback, useEffect, useMemo, memo } from "react";
import type { TypstRenderer } from "@myriaddreamin/typst.ts";
import type { PageInfo } from "@myriaddreamin/typst.ts/dist/esm/internal.types.mjs";
import { PageRenderer } from "./PageRenderer";

interface PreviewPanelProps {
  error: string | null;
  compiling: boolean;
  pages: PageInfo[];
  artifactContent: Uint8Array | null;
  renderer: TypstRenderer | null;
}

const PIXEL_PER_PT = 2;
const PAGE_GAP = 8;
const PADDING = 16;

// React.memo: props (error, compiling, pages, artifactContent, renderer)
// don't change during typing — only when a compile result arrives.
// Prevents wasted re-renders from parent re-rendering on every keystroke.
export const PreviewPanel = memo(function PreviewPanel({
  error,
  compiling,
  pages,
  artifactContent,
  renderer,
}: PreviewPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [activePageIndex, setActivePageIndex] = useState(0);

  // Refs to page placeholder divs (set via callback refs)
  const pageRefsMap = useRef<Map<number, HTMLDivElement>>(new Map());
  // Track what's currently rendered to avoid re-rendering unchanged pages
  const renderedRef = useRef<Map<number, number>>(new Map()); // pageIndex → artifactId
  const artifactIdRef = useRef(0);

  // Increment artifact ID when artifact changes
  useEffect(() => {
    if (artifactContent) artifactIdRef.current += 1;
  }, [artifactContent]);

  // Track container width
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(Math.max(0, entry.contentRect.width - PADDING * 2));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Page layout (cumulative heights)
  const pageLayout = useMemo(() => {
    const layout: { top: number; height: number }[] = [];
    let cumTop = PADDING;
    for (const page of pages) {
      const cw = Math.ceil(page.width * PIXEL_PER_PT);
      const ch = Math.ceil(page.height * PIXEL_PER_PT);
      const w = containerWidth > 0 ? containerWidth : cw;
      const h = ch * (w / cw);
      layout.push({ top: cumTop, height: h });
      cumTop += h + PAGE_GAP;
    }
    return layout;
  }, [pages, containerWidth]);

  const totalHeight = useMemo(() => {
    if (pageLayout.length === 0) return 0;
    const last = pageLayout[pageLayout.length - 1];
    return last.top + last.height + PADDING;
  }, [pageLayout]);

  // Find active page from scroll position
  const updateActivePage = useCallback(() => {
    const el = scrollRef.current;
    if (!el || pageLayout.length === 0) return;
    const center = el.scrollTop + el.clientHeight / 2;
    let active = 0;
    for (let i = 0; i < pageLayout.length; i++) {
      const { top, height } = pageLayout[i];
      if (center >= top && center < top + height + PAGE_GAP) { active = i; break; }
      if (center < top) { active = Math.max(0, i - 1); break; }
      active = i;
    }
    setActivePageIndex(active);
  }, [pageLayout]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateActivePage, { passive: true });
    updateActivePage();
    return () => el.removeEventListener("scroll", updateActivePage);
  }, [updateActivePage]);

  useEffect(() => { updateActivePage(); }, [pages, updateActivePage]);

  // The 3 visible page indices
  const visibleSet = useMemo(() => {
    const set = new Set<number>();
    for (let i = Math.max(0, activePageIndex - 1); i <= Math.min(pages.length - 1, activePageIndex + 1); i++) {
      set.add(i);
    }
    return set;
  }, [activePageIndex, pages.length]);

  // === RENDER VISIBLE PAGES ===
  // Single effect that renders only the 3 visible pages.
  // Cleans up canvases for pages that are no longer visible.
  useEffect(() => {
    if (!renderer || !artifactContent || containerWidth <= 0 || pages.length === 0) return;

    const currentArtifactId = artifactIdRef.current;
    let cancelled = false;

    // Clean up non-visible pages
    for (const [idx] of renderedRef.current) {
      if (!visibleSet.has(idx)) {
        const div = pageRefsMap.current.get(idx);
        if (div) div.innerHTML = "";
        renderedRef.current.delete(idx);
      }
    }

    // Figure out which visible pages need (re)rendering
    const toRender: number[] = [];
    for (const idx of visibleSet) {
      const prev = renderedRef.current.get(idx);
      if (prev !== currentArtifactId) toRender.push(idx);
    }

    if (toRender.length === 0) return;

    // Render pages one at a time, yielding between each
    (async () => {
      for (const idx of toRender) {
        if (cancelled) return;

        const page = pages[idx];
        const div = pageRefsMap.current.get(idx);
        if (!div || !page) continue;

        const cw = Math.ceil(page.width * PIXEL_PER_PT);
        const ch = Math.ceil(page.height * PIXEL_PER_PT);
        const scale = containerWidth / cw;

        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;

        try {
          // Yield to main thread so typing/scrolling stays responsive
          await new Promise<void>(r => requestAnimationFrame(() => r()));
          if (cancelled) return;

          await renderer.renderCanvas({
            format: "vector" as any,
            artifactContent,
            canvas: canvas.getContext("2d")!,
            pageOffset: page.pageOffset,
            pixelPerPt: PIXEL_PER_PT,
            backgroundColor: "#ffffff",
          } as any);

          if (cancelled) return;

          // Create wrapper with CSS transform for fit-to-width
          const wrapper = document.createElement("div");
          wrapper.style.cssText = `position:absolute;top:0;left:0;transform-origin:0px 0px;transform:scale(${scale})`;
          wrapper.appendChild(canvas);

          div.innerHTML = "";
          div.style.backgroundColor = "#ffffff";
          div.appendChild(wrapper);
          renderedRef.current.set(idx, currentArtifactId);
        } catch (e) {
          console.warn(`Page ${idx} render failed:`, e);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [visibleSet, artifactContent, renderer, containerWidth, pages]);

  // Stable ref callbacks (cached per page index)
  const refCbCache = useRef<Map<number, (el: HTMLDivElement | null) => void>>(new Map());
  const getPageRef = useCallback((i: number) => {
    let cb = refCbCache.current.get(i);
    if (!cb) {
      cb = (el: HTMLDivElement | null) => {
        if (el) pageRefsMap.current.set(i, el);
        else { pageRefsMap.current.delete(i); renderedRef.current.delete(i); }
      };
      refCbCache.current.set(i, cb);
    }
    return cb;
  }, []);

  // Zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(z => Math.max(0.25, Math.min(5, z + (e.deltaY > 0 ? -0.1 : 0.1))));
    }
  }, []);

  return (
    <div ref={scrollRef} className="relative h-full w-full overflow-auto bg-white" onWheel={handleWheel}>
      {error && (
        <div className="absolute right-3 top-3 z-10 rounded bg-red-900/80 px-2 py-1 text-xs text-red-300" title={error}>
          Error
        </div>
      )}

      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded bg-gray-800/80 px-1.5 py-1 text-xs text-gray-300">
        <button onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} className="rounded px-1.5 py-0.5 hover:bg-gray-700">-</button>
        <button onClick={() => setZoom(1)} className="min-w-[3rem] rounded px-1 py-0.5 text-center hover:bg-gray-700">{Math.round(zoom * 100)}%</button>
        <button onClick={() => setZoom(z => Math.min(5, z + 0.25))} className="rounded px-1.5 py-0.5 hover:bg-gray-700">+</button>
      </div>

      {pages.length > 0 && (
        <div className="absolute bottom-3 left-3 z-10 rounded bg-gray-800/80 px-2 py-1 text-xs text-gray-300">
          {pages.length} page{pages.length !== 1 ? "s" : ""}
        </div>
      )}

      {pages.length > 0 && containerWidth > 0 && (
        <div style={{ zoom: zoom !== 1 ? zoom : undefined, padding: PADDING, minHeight: totalHeight }}>
          {pages.map((page, i) => (
            <PageRenderer
              key={i}
              ref={getPageRef(i)}
              pageInfo={page}
              containerWidth={containerWidth}
              pixelPerPt={PIXEL_PER_PT}
            />
          ))}
        </div>
      )}

      {!compiling && !error && pages.length === 0 && (
        <div className="flex h-full items-center justify-center text-gray-500">
          Start typing to see preview
        </div>
      )}
    </div>
  );
});
