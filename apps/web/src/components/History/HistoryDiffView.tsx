import { memo, useMemo } from "react";

interface Props {
  filePath: string | null;
  diffType: string | null;
  unifiedDiff: string | null;
}

interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

function parseDiff(raw: string): DiffLine[] {
  const lines = raw.split("\n");
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith("Index:") || line.startsWith("===") || line.startsWith("---") || line.startsWith("+++")) {
      continue;
    }
    if (line.startsWith("@@")) {
      // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1]) - 1;
        newLine = parseInt(match[2]) - 1;
      }
      result.push({ type: "header", content: line, oldLineNo: null, newLineNo: null });
      continue;
    }
    if (line.startsWith("+")) {
      newLine++;
      result.push({ type: "add", content: line.slice(1), oldLineNo: null, newLineNo: newLine });
    } else if (line.startsWith("-")) {
      oldLine++;
      result.push({ type: "remove", content: line.slice(1), oldLineNo: oldLine, newLineNo: null });
    } else if (line.startsWith(" ")) {
      oldLine++;
      newLine++;
      result.push({ type: "context", content: line.slice(1), oldLineNo: oldLine, newLineNo: newLine });
    } else if (line === "\\ No newline at end of file") {
      continue;
    }
  }
  return result;
}

export const HistoryDiffView = memo(function HistoryDiffView({ filePath, diffType, unifiedDiff }: Props) {
  const diffLines = useMemo(() => {
    if (!unifiedDiff) return [];
    return parseDiff(unifiedDiff);
  }, [unifiedDiff]);

  if (!filePath) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500">
        Select a file to view changes
      </div>
    );
  }

  if (!unifiedDiff) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-500">
        <span className="text-lg">
          {diffType === "create" ? "New file (empty)" : diffType === "delete" ? "File deleted" : "No diff available"}
        </span>
        <span className="text-sm text-gray-600">{filePath}</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-gray-950">
      <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-2">
        <span className="text-sm font-medium text-gray-200">{filePath}</span>
        {diffType && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            diffType === "create" ? "bg-green-900/50 text-green-300" :
            diffType === "delete" ? "bg-red-900/50 text-red-300" :
            "bg-blue-900/50 text-blue-300"
          }`}>
            {diffType}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-auto font-mono text-sm">
        {diffLines.map((line, i) => {
          if (line.type === "header") {
            return (
              <div key={i} className="bg-blue-950/30 px-4 py-0.5 text-blue-400">
                {line.content}
              </div>
            );
          }
          return (
            <div
              key={i}
              className={`flex ${
                line.type === "add" ? "bg-green-950/30" :
                line.type === "remove" ? "bg-red-950/30" : ""
              }`}
            >
              <span className="w-12 flex-shrink-0 select-none px-2 text-right text-gray-600">
                {line.oldLineNo ?? ""}
              </span>
              <span className="w-12 flex-shrink-0 select-none px-2 text-right text-gray-600">
                {line.newLineNo ?? ""}
              </span>
              <span className={`w-4 flex-shrink-0 select-none text-center ${
                line.type === "add" ? "text-green-400" :
                line.type === "remove" ? "text-red-400" : "text-gray-600"
              }`}>
                {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
              </span>
              <span className={`flex-1 whitespace-pre-wrap break-all px-2 ${
                line.type === "add" ? "text-green-300" :
                line.type === "remove" ? "text-red-300" : "text-gray-300"
              }`}>
                {line.content}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});
