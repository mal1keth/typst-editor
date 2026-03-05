interface PreviewPanelProps {
  svgContent: string;
  error: string | null;
  compiling: boolean;
}

export function PreviewPanel({ svgContent, error, compiling }: PreviewPanelProps) {
  if (error) {
    return (
      <div className="h-full w-full overflow-auto bg-gray-900 p-4">
        <div className="rounded border border-red-500/30 bg-red-950/50 p-4">
          <h3 className="mb-2 text-sm font-semibold text-red-400">Compilation Error</h3>
          <pre className="whitespace-pre-wrap text-sm text-red-300">{error}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-auto bg-gray-200">
      {compiling && (
        <div className="absolute right-3 top-3 z-10 rounded bg-gray-800/80 px-2 py-1 text-xs text-gray-300">
          Compiling...
        </div>
      )}
      {svgContent ? (
        <div
          className="mx-auto p-4"
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-gray-500">
          Start typing to see preview
        </div>
      )}
    </div>
  );
}
