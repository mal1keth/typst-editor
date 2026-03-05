import { useRef, useState, useCallback, useEffect } from "react";

interface PreviewPanelProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  error: string | null;
  compiling: boolean;
  pages: { pageOffset: number; width: number; height: number }[];
}

export function PreviewPanel({
  containerRef,
  error,
  compiling,
  pages,
}: PreviewPanelProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);

  // Track container width for fit-to-width scaling
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Compute fit-to-width scale factor
  const maxPageWidth = pages.length > 0
    ? Math.max(...pages.map((p) => p.width))
    : 595; // default A4 width in pt

  // The typst.ts renderer uses pixelPerPt=2, so actual pixel width = pageWidth * 2
  const padding = 32;
  const availableWidth = Math.max(containerWidth - padding, 100);
  const baseScale = availableWidth / (maxPageWidth * 2);
  const effectiveScale = baseScale * zoom;

  // Handle zoom via Ctrl+scroll
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom((z) => Math.max(0.25, Math.min(5, z + delta)));
      }
    },
    []
  );

  const zoomIn = useCallback(() => {
    setZoom((z) => Math.min(5, z + 0.25));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((z) => Math.max(0.25, z - 0.25));
  }, []);

  const zoomReset = useCallback(() => {
    setZoom(1);
  }, []);

  return (
    <div
      ref={outerRef}
      className="relative h-full w-full overflow-auto bg-gray-200"
      onWheel={handleWheel}
    >
      {/* Status indicators */}
      {compiling && (
        <div className="absolute right-3 top-3 z-10 rounded bg-gray-800/80 px-2 py-1 text-xs text-gray-300">
          Compiling...
        </div>
      )}
      {error && (
        <div className="absolute left-3 top-3 z-10 max-w-[80%] rounded border border-red-500/50 bg-red-950/90 px-2 py-1 text-xs text-red-300">
          <div className="font-medium">Compilation error</div>
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[10px]">
            {error}
          </pre>
        </div>
      )}

      {/* Zoom controls */}
      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded bg-gray-800/80 px-1.5 py-1 text-xs text-gray-300">
        <button
          onClick={zoomOut}
          className="rounded px-1.5 py-0.5 hover:bg-gray-700"
          title="Zoom out"
        >
          -
        </button>
        <button
          onClick={zoomReset}
          className="min-w-[3rem] rounded px-1 py-0.5 text-center hover:bg-gray-700"
          title="Reset zoom"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          onClick={zoomIn}
          className="rounded px-1.5 py-0.5 hover:bg-gray-700"
          title="Zoom in"
        >
          +
        </button>
      </div>

      {/* Page counter */}
      {pages.length > 0 && (
        <div className="absolute bottom-3 left-3 z-10 rounded bg-gray-800/80 px-2 py-1 text-xs text-gray-300">
          {pages.length} page{pages.length !== 1 ? "s" : ""}
        </div>
      )}

      {/* Render container — typst.ts renderToCanvas populates this */}
      <div
        ref={containerRef}
        className="mx-auto"
        style={{
          transformOrigin: "top center",
          transform: `scale(${effectiveScale})`,
          padding: `${padding / 2}px`,
        }}
      />

      {/* Empty state */}
      {!compiling && !error && pages.length === 0 && (
        <div className="flex h-full items-center justify-center text-gray-500">
          Start typing to see preview
        </div>
      )}
    </div>
  );
}
