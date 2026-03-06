import { memo } from "react";

interface Props {
  projectName: string;
  githubLinked: boolean;
  errorCount: number;
  showingCompilerOutput: boolean;
  compileMode: 'live' | 'manual';
  compiling: boolean;
  readOnly?: boolean;
  autoPullStatus?: string | null;
  onBack: () => void;
  onShare: () => void;
  onGitHub: () => void;
  onExportPdf: () => void;
  exportingPdf: boolean;
  onCompilerOutput: () => void;
  onCompileModeChange: (mode: 'live' | 'manual') => void;
  onCompile: () => void;
  onHistory?: () => void;
}

export const Toolbar = memo(function Toolbar({
  projectName,
  githubLinked,
  errorCount,
  showingCompilerOutput,
  compileMode,
  compiling,
  readOnly,
  autoPullStatus,
  onBack,
  onShare,
  onGitHub,
  onExportPdf,
  exportingPdf,
  onCompilerOutput,
  onCompileModeChange,
  onCompile,
  onHistory,
}: Props) {
  return (
    <header className="flex h-12 items-center justify-between border-b border-gray-800 bg-gray-900 px-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-sm text-gray-400 hover:text-gray-200"
        >
          &larr; {readOnly ? "Back" : "Projects"}
        </button>
        <span className="text-gray-600">|</span>
        <h1 className="font-semibold text-gray-100">{projectName}</h1>
        {readOnly && (
          <span className="rounded bg-yellow-900/50 px-2 py-0.5 text-xs text-yellow-300">Read only</span>
        )}
        {autoPullStatus && (
          <span className="text-xs text-green-400">{autoPullStatus}</span>
        )}
        <span className="text-gray-600">|</span>
        <div className="flex items-center gap-1.5">
          {compileMode === 'manual' && (
            <button
              onClick={onCompile}
              disabled={compiling}
              className="rounded bg-green-700 px-3 py-1 text-sm text-white hover:bg-green-600 disabled:opacity-50"
              title={`Compile (${navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl'}+Enter)`}
            >
              {compiling ? "Compiling..." : "Compile"}
            </button>
          )}
          <select
            value={compileMode}
            onChange={(e) => onCompileModeChange(e.target.value as 'live' | 'manual')}
            className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 border border-gray-700 cursor-pointer hover:bg-gray-700"
            title="Compile mode"
          >
            <option value="manual">Manual</option>
            <option value="live">Live</option>
          </select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onCompilerOutput}
          className={`relative rounded px-3 py-1.5 text-sm ${
            showingCompilerOutput
              ? "bg-gray-700 text-gray-100"
              : errorCount > 0
                ? "bg-red-900/50 text-red-300 hover:bg-red-900/70"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
          }`}
        >
          Errors
          {errorCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">
              {errorCount}
            </span>
          )}
        </button>
        {!readOnly && (
          <>
            {onHistory && (
              <button
                onClick={onHistory}
                className="rounded bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
              >
                History
              </button>
            )}
            <button
              onClick={onExportPdf}
              disabled={exportingPdf}
              className="rounded bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-50"
            >
              {exportingPdf ? "Exporting..." : "PDF"}
            </button>
            <button
              onClick={onGitHub}
              className={`rounded px-3 py-1.5 text-sm ${
                githubLinked
                  ? "bg-green-900/50 text-green-300 hover:bg-green-900/70"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              GitHub
            </button>
            <button
              onClick={onShare}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
            >
              Share
            </button>
          </>
        )}
      </div>
    </header>
  );
});
