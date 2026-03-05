import type { CompilerDiagnostic } from "@/hooks/useTypstCompiler";

interface Props {
  diagnostics: CompilerDiagnostic[];
  currentError: string | null;
  onClear: () => void;
}

export function CompilerOutputPanel({ diagnostics, currentError, onClear }: Props) {
  return (
    <div className="flex h-full flex-col bg-gray-900 border-t border-gray-800">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Compiler Output
        </span>
        <button
          onClick={onClear}
          className="text-xs text-gray-500 hover:text-gray-300"
        >
          Clear
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3 font-mono text-xs">
        {currentError && (
          <div className="mb-2 rounded border border-red-500/30 bg-red-950/50 p-2 text-red-300">
            <div className="mb-1 font-semibold text-red-400">Current Error:</div>
            <pre className="whitespace-pre-wrap">{currentError}</pre>
          </div>
        )}
        {diagnostics.length === 0 && !currentError && (
          <span className="text-gray-500">No compiler output</span>
        )}
        {diagnostics.map((d, i) => (
          <div
            key={`${d.timestamp}-${i}`}
            className={`mb-1 rounded px-2 py-1 ${
              d.severity === "error"
                ? "text-red-300 bg-red-950/30"
                : "text-yellow-300 bg-yellow-950/30"
            }`}
          >
            <span className="mr-2 text-gray-500">
              {new Date(d.timestamp).toLocaleTimeString()}
            </span>
            {d.message}
          </div>
        ))}
      </div>
    </div>
  );
}
