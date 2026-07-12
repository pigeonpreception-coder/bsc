"use client";

import FileUploadField from "./FileUploadField";

export type SupportingDocument = { url: string; fileName: string };

export default function SupportingDocumentsList({
  tenantId,
  documents,
  onChange,
}: {
  tenantId: string;
  documents: SupportingDocument[];
  onChange: (documents: SupportingDocument[]) => void;
}) {
  const addSlot = () => onChange([...documents, { url: "", fileName: "" }]);
  const removeSlot = (index: number) => onChange(documents.filter((_, i) => i !== index));
  const setSlot = (index: number, url: string, fileName: string) =>
    onChange(documents.map((d, i) => (i === index ? { url, fileName } : d)));

  return (
    <div className="space-y-3">
      {documents.map((doc, index) => (
        <div key={index} className="rounded-md border border-gray-100 bg-gray-50/50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">Additional Document #{index + 1}</span>
            <button type="button" onClick={() => removeSlot(index)} className="text-xs text-red-600 hover:text-red-800">
              Remove
            </button>
          </div>
          <FileUploadField
            tenantId={tenantId}
            storageFolder="supporting-documents"
            label="Upload this document"
            path={doc.url || null}
            fileName={doc.fileName || null}
            onUploaded={(url, fileName) => setSlot(index, url, fileName)}
            onRemoved={() => setSlot(index, "", "")}
          />
        </div>
      ))}

      <button
        type="button"
        onClick={addSlot}
        className="rounded-md border border-navy px-3 py-1.5 text-sm font-medium text-navy hover:bg-navy/5"
      >
        + Add Another Document
      </button>
    </div>
  );
}
