import { useRef, useState, useCallback } from "react";

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

  const padding = 32;

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
      className="relative h-full w-full overflow-auto bg-white"
      onWheel={handleWheel}
    >
      {/* Status indicators */}
      {compiling && (
        <div className="absolute right-3 top-3 z-10 rounded bg-gray-800/80 px-2 py-1 text-xs text-gray-300">
          Compiling...
        </div>
      )}
      {error && (
        <div className="absolute right-3 top-3 z-10 rounded bg-red-900/80 px-2 py-1 text-xs text-red-300" title={error}>
          Error
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

      {/* Render container — typst.ts renderToCanvas populates this.
          The renderer handles fit-to-width internally.
          CSS zoom is only applied for manual user zoom controls.
          overflow:hidden on .typst-page clips the text selection layer. */}
      <div
        ref={containerRef}
        className="mx-auto [&_.typst-page]:overflow-hidden"
        style={{
          zoom: zoom !== 1 ? zoom : undefined,
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
