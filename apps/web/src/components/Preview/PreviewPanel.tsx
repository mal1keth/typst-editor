interface PreviewPanelProps {
  svgContent: string;
  error: string | null;
  compiling: boolean;
}

export function PreviewPanel({ svgContent, error, compiling }: PreviewPanelProps) {
  return (
    <div className="relative h-full w-full overflow-auto bg-white">
      {compiling && (
        <div className="absolute right-3 top-3 z-10 rounded bg-gray-800/80 px-2 py-1 text-xs text-gray-300">
          Compiling...
        </div>
      )}
      {error && (
        <div className="absolute left-3 top-3 z-10 rounded border border-red-500/50 bg-red-950/90 px-2 py-1 text-xs text-red-300">
          Compilation error
        </div>
      )}
      {svgContent ? (
        <div
          className="mx-auto p-4"
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-gray-500">
          {error ? "Fix errors to see preview" : "Start typing to see preview"}
        </div>
      )}
    </div>
  );
}
