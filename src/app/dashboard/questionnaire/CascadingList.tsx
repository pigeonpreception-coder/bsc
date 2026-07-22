"use client";

export type CascadingEntry = { name: string; description: string };

export default function CascadingList({
  entries,
  onChange,
  nameLabel,
  descriptionLabel,
  namePlaceholder,
  descriptionPlaceholder,
  addLabel,
}: {
  entries: CascadingEntry[];
  onChange: (entries: CascadingEntry[]) => void;
  nameLabel: (index: number) => string;
  descriptionLabel: string;
  namePlaceholder: string;
  descriptionPlaceholder: string;
  addLabel: string;
}) {
  const list = entries.length > 0 ? entries : [{ name: "", description: "" }];

  const updateEntry = (index: number, patch: Partial<CascadingEntry>) => {
    const next = list.map((entry, i) => (i === index ? { ...entry, ...patch } : entry));
    onChange(next);
  };

  const addEntry = () => {
    onChange([...list, { name: "", description: "" }]);
  };

  const removeEntry = (index: number) => {
    if (list.length <= 1) return;
    onChange(list.filter((_, i) => i !== index));
  };

  const lastIndex = list.length - 1;
  const lastComplete = list[lastIndex].name.trim().length >= 3 && list[lastIndex].description.trim().length > 0;

  return (
    <div className="space-y-4">
      {list.map((entry, index) => {
        const nameReady = entry.name.trim().length >= 3;

        return (
          <div key={index} className="space-y-2 rounded-md border border-gray-100 bg-gray-50/50 p-3">
            <div className="flex items-start justify-between gap-2">
              <label className="block flex-1 text-sm font-medium text-gray-700">
                {nameLabel(index)}
                <span className="text-red-600"> *</span>
              </label>
              {list.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeEntry(index)}
                  className="text-xs font-medium text-red-500 hover:text-red-700"
                  title="Remove this entry"
                >
                  Remove
                </button>
              )}
            </div>
            <input
              type="text"
              value={entry.name}
              placeholder={namePlaceholder}
              onChange={(e) => updateEntry(index, { name: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
            />

            {nameReady && (
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  {descriptionLabel}
                  <span className="text-red-600"> *</span>
                </label>
                <textarea
                  value={entry.description}
                  placeholder={descriptionPlaceholder}
                  rows={2}
                  onChange={(e) => updateEntry(index, { description: e.target.value })}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
                />
              </div>
            )}
          </div>
        );
      })}

      {lastComplete && (
        <button
          type="button"
          onClick={addEntry}
          className="rounded-md border border-navy px-3 py-1.5 text-sm font-medium text-navy hover:bg-navy/5"
        >
          {addLabel}
        </button>
      )}
    </div>
  );
}
