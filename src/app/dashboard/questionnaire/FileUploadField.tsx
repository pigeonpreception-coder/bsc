"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const ACCEPTED_EXTENSIONS = [".pdf", ".doc", ".docx", ".ppt", ".pptx"];
const MAX_SIZE_BYTES = 20 * 1024 * 1024;

export default function FileUploadField({
  tenantId,
  path,
  fileName,
  onUploaded,
  onRemoved,
}: {
  tenantId: string;
  path: string | null;
  fileName: string | null;
  onUploaded: (path: string, fileName: string, fileSize: number) => void;
  onRemoved: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      setError("Only PDF, DOC, DOCX, PPT, or PPTX files are accepted.");
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
    const storagePath = `${tenantId}/company-profile/${Date.now()}-${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from("company-documents")
      .upload(storagePath, file, { upsert: true });

    setIsUploading(false);
    if (uploadError) {
      setError(uploadError.message);
      return;
    }

    onUploaded(storagePath, file.name, file.size);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">Upload Your Company Profile</label>
      <p className="text-xs text-gray-500">
        Upload your company&apos;s official profile, brochure, or any document that describes your business in
        detail. This helps our AI generate a more accurate and tailored Strategic Plan.
      </p>

      {fileName && path ? (
        <div className="mt-2 flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
          <span className="truncate text-gray-700">{fileName}</span>
          <button type="button" onClick={onRemoved} className="ml-3 text-red-600 hover:text-red-800">
            Remove
          </button>
        </div>
      ) : (
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(",")}
          disabled={isUploading}
          onChange={handleFileChange}
          className="mt-1 w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-navy file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-navy-light"
        />
      )}

      {isUploading && <p className="mt-1 text-xs text-gray-500">Uploading…</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
