"use client";

import React from "react";

const MAX_PAYLOAD_BYTES = 200 * 1024; // max JSON size for URL payload
const MAX_FILE_BYTES = 100 * 1024;   // max decoded file size to include in payload

export interface SourceFileForPayload {
  name: string;
  data: ArrayBuffer | Blob;
}

interface ToolResultProps {
  output: string;
  filename?: string;
  toolSlug?: string;
  sourceFile?: SourceFileForPayload | null;
  variant?: "card" | "plain";
}

async function fileToBase64(data: ArrayBuffer | Blob): Promise<string> {
  const blob = data instanceof Blob ? data : new Blob([data]);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function buildOpenInGenLatexUrlSync(output: string, filename: string, toolSlug: string): string {
  const appUrl = "";
  const payload = { tool: toolSlug, latex: output, filename };
  const json = JSON.stringify(payload);
  if (new Blob([json]).size > MAX_PAYLOAD_BYTES) return "";
  const base64 = btoa(unescape(encodeURIComponent(json)));
  return `${appUrl}/from-tool/#payload=${encodeURIComponent(base64)}`;
}

async function buildOpenInGenLatexUrlAsync(
  output: string,
  filename: string,
  toolSlug: string,
  sourceFile: SourceFileForPayload
): Promise<string> {
  const appUrl = "";
  const payload: { tool: string; latex: string; filename: string; file?: { name: string; base64: string } } = {
    tool: toolSlug,
    latex: output,
    filename,
  };
  const size = sourceFile.data instanceof Blob ? sourceFile.data.size : sourceFile.data.byteLength;
  if (size > 0 && size <= MAX_FILE_BYTES) {
    try {
      const base64 = await fileToBase64(sourceFile.data);
      payload.file = { name: sourceFile.name, base64 };
    } catch {
      // omit file on error
    }
  }
  let json = JSON.stringify(payload);
  if (new Blob([json]).size > MAX_PAYLOAD_BYTES && payload.file) {
    delete payload.file;
    json = JSON.stringify(payload);
  }
  if (new Blob([json]).size > MAX_PAYLOAD_BYTES) return "";
  const base64 = btoa(unescape(encodeURIComponent(json)));
  return `${appUrl}/from-tool/#payload=${encodeURIComponent(base64)}`;
}

export default function ToolResult({
  output,
  filename = "output.tex",
  toolSlug = "tool",
  sourceFile,
  variant = "card",
}: ToolResultProps) {
  const [openUrl, setOpenUrl] = React.useState<string | null>(null);
  const [urlPending, setUrlPending] = React.useState(!!(sourceFile?.name && sourceFile?.data));

  React.useEffect(() => {
    let cancelled = false;
    if (!sourceFile?.name || !sourceFile?.data) {
      setUrlPending(false);
      const url = buildOpenInGenLatexUrlSync(output, filename, toolSlug);
      setOpenUrl(url || null);
      return;
    }
    setUrlPending(true);
    buildOpenInGenLatexUrlAsync(output, filename, toolSlug, sourceFile).then((url) => {
      if (!cancelled) {
        setOpenUrl(url || null);
        setUrlPending(false);
      }
    });
    return () => { cancelled = true; };
  }, [output, filename, toolSlug, sourceFile]);

  const minimalPayloadSize = new Blob([JSON.stringify({ tool: toolSlug, latex: output, filename })]).size;
  const payloadTooBig = !urlPending && !openUrl && minimalPayloadSize > MAX_PAYLOAD_BYTES;

  function handleDownload() {
    const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleOpenInGenLatex() {
    if (openUrl) window.location.href = openUrl;
  }

  const content = (
    <>
      <pre className="p-4 rounded-2xl bg-gray-50 border border-border text-sm text-foreground overflow-x-auto max-h-[320px] overflow-y-auto whitespace-pre-wrap break-words">
        {output}
      </pre>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleDownload}
          className="px-5 py-2.5 rounded-full text-sm font-semibold text-primary border-2 border-primary bg-white hover:bg-primary/5 transition-colors"
        >
          Download
        </button>
        {openUrl ? (
          <button
            type="button"
            onClick={handleOpenInGenLatex}
            className="px-5 py-2.5 rounded-full text-sm font-semibold text-white bg-gradient-to-r from-primary to-accent shadow-[0_8px_20px_rgba(38,104,255,0.35)] hover:translate-y-[-1px] transition-transform"
          >
            Open in GenLaTeX
          </button>
        ) : (
          payloadTooBig && (
            <span className="text-sm text-secondary">
              Output is too large to open in GenLaTeX. Use Download instead.
            </span>
          )
        )}
      </div>
    </>
  );

  if (variant === "plain") {
    return <div className="space-y-4">{content}</div>;
  }

  return (
    <div className="rounded-[24px] border border-white/60 bg-white/80 backdrop-blur-xl p-6 shadow-card-soft space-y-4">
      <h3 className="font-heading text-lg font-semibold text-foreground">Result</h3>
      {content}
    </div>
  );
}
