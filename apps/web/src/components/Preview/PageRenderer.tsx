import { memo, forwardRef } from "react";
import type { PageInfo } from "@myriaddreamin/typst.ts/dist/esm/internal.types.mjs";

interface PageRendererProps {
  pageInfo: PageInfo;
  containerWidth: number;
  pixelPerPt: number;
}

// Pure placeholder div with correct dimensions. No rendering, no effects.
// PreviewPanel handles all canvas rendering for visible pages.
export const PageRenderer = memo(forwardRef<HTMLDivElement, PageRendererProps>(
  function PageRenderer({ pageInfo, containerWidth, pixelPerPt }, ref) {
    const canvasWidth = Math.ceil(pageInfo.width * pixelPerPt);
    const canvasHeight = Math.ceil(pageInfo.height * pixelPerPt);
    const scale = containerWidth > 0 ? containerWidth / canvasWidth : 1;
    const displayHeight = canvasHeight * scale;

    return (
      <div
        ref={ref}
        style={{
          width: containerWidth > 0 ? containerWidth : undefined,
          height: displayHeight,
          position: "relative",
          marginBottom: 8,
          overflow: "hidden",
        }}
      />
    );
  }
));
