import { memo } from "react";

interface ChangedFile {
  path: string;
  diffType: string;
}

interface Props {
  files: ChangedFile[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onFileHistory?: (path: string) => void;
}

export const HistoryFileTree = memo(function HistoryFileTree({
  files,
  selectedFile,
  onSelectFile,
  onFileHistory,
}: Props) {
  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        Select an edit to see changed files
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-gray-900">
      <div className="border-b border-gray-800 px-3 py-2">
        <span className="text-xs font-medium text-gray-400">
          Changed Files ({files.length})
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {files.map((file) => (
          <div
            key={file.path}
            className={`group flex items-center gap-2 border-b border-gray-800/50 px-3 py-1.5 cursor-pointer ${
              selectedFile === file.path
                ? "bg-blue-900/30 text-blue-200"
                : "text-gray-300 hover:bg-gray-800"
            }`}
            onClick={() => onSelectFile(file.path)}
          >
            <span className={`flex-shrink-0 text-[10px] font-medium rounded px-1 py-0.5 ${
              file.diffType === "create" ? "bg-green-900/50 text-green-400" :
              file.diffType === "delete" ? "bg-red-900/50 text-red-400" :
              "bg-blue-900/50 text-blue-400"
            }`}>
              {file.diffType === "create" ? "A" : file.diffType === "delete" ? "D" : "M"}
            </span>
            <span className="flex-1 truncate text-sm">{file.path}</span>
            {onFileHistory && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onFileHistory(file.path);
                }}
                className="hidden group-hover:block flex-shrink-0 text-[10px] text-gray-500 hover:text-gray-300"
                title="View file history"
              >
                history
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});
