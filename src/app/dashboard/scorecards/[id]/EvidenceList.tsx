"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { attachKpiEvidence, type EvidenceEntry } from "./row-actions";

const ACCEPTED_EXTENSIONS = [".pdf", ".doc", ".docx", ".ppt", ".pptx", ".png", ".jpg", ".jpeg", ".webp"];
const MAX_SIZE_BYTES = 20 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export default function EvidenceList({
  rowId,
  tenantId,
  evidence,
  canEdit,
}: {
  rowId: string;
  tenantId: string;
  evidence: EvidenceEntry[];
  canEdit: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = (next: EvidenceEntry[]) => {
    setError(null);
    startTransition(async () => {
      try {
        await attachKpiEvidence(rowId, next);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      setError("Unsupported file type.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError("File is too large — maximum size is 20MB.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setIsUploading(true);
    const supabase = createClient();
    const storagePath = `${tenantId}/kpi-evidence/${Date.now()}-${file.name}`;

    const { error: uploadError } = await supabase.storage.from("company-documents").upload(storagePath, file);

    setIsUploading(false);
    if (uploadError) {
      setError(uploadError.message);
      return;
    }

    if (inputRef.current) inputRef.current.value = "";
    save([...evidence, { url: storagePath, fileName: file.name, fileSize: file.size }]);
  };

  const view = async (path: string) => {
    setError(null);
    const supabase = createClient();
    const { data, error: signError } = await supabase.storage
      .from("company-documents")
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (signError || !data) {
      setError("Couldn't open that file. Please try again.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="mt-1 max-w-[180px]">
      {evidence.length > 0 && (
        <ul className="space-y-0.5">
          {evidence.map((item) => (
            <li key={item.url} className="flex items-center justify-between gap-1 text-[10px]">
              <button
                type="button"
                onClick={() => view(item.url)}
                className="truncate text-navy underline hover:text-navy-light"
                title={item.fileName}
              >
                📎 {item.fileName}
              </button>
              {canEdit && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => save(evidence.filter((e) => e.url !== item.url))}
                  className="shrink-0 text-red-500 hover:text-red-700 disabled:opacity-50"
                  title="Remove"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS.join(",")}
            disabled={isUploading || isPending}
            onChange={handleFileChange}
            className="mt-1 hidden"
            id={`evidence-input-${rowId}`}
          />
          <label
            htmlFor={`evidence-input-${rowId}`}
            className="mt-1 inline-block cursor-pointer text-[10px] text-gray-400 underline hover:text-gray-600"
          >
            {isUploading ? "Uploading…" : "+ Add evidence"}
          </label>
        </>
      )}

      {error && <p className="mt-0.5 text-[10px] text-red-600">{error}</p>}
    </div>
  );
}
