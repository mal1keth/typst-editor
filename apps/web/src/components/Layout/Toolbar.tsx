import {
  TYPST_VERSIONS,
  setSelectedVersion,
} from "@/hooks/useTypstCompiler";

interface Props {
  projectName: string;
  saving: boolean;
  githubLinked: boolean;
  compilerVersion: string;
  onBack: () => void;
  onShare: () => void;
  onGitHub: () => void;
  onExportPdf: () => void;
  exportingPdf: boolean;
  onVersionChange: (version: string) => void;
}

export function Toolbar({
  projectName,
  saving,
  githubLinked,
  compilerVersion,
  onBack,
  onShare,
  onGitHub,
  onExportPdf,
  exportingPdf,
  onVersionChange,
}: Props) {
  const handleVersionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newVersion = e.target.value;
    setSelectedVersion(newVersion);
    onVersionChange(newVersion);
  };

  return (
    <header className="flex h-12 items-center justify-between border-b border-gray-800 bg-gray-900 px-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-sm text-gray-400 hover:text-gray-200"
        >
          &larr; Projects
        </button>
        <span className="text-gray-600">|</span>
        <h1 className="font-semibold text-gray-100">{projectName}</h1>
        {saving && (
          <span className="text-xs text-gray-500">Saving...</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <select
          value={compilerVersion}
          onChange={handleVersionChange}
          className="rounded bg-gray-800 px-2 py-1.5 text-sm text-gray-300 border border-gray-700 hover:bg-gray-700 cursor-pointer"
          title="Typst compiler version"
        >
          {TYPST_VERSIONS.map((v) => (
            <option key={v.pkg} value={v.pkg}>
              Typst {v.label}
            </option>
          ))}
        </select>
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
      </div>
    </header>
  );
}
