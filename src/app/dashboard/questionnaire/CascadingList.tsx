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

  const lastIndex = list.length - 1;
  const lastComplete = list[lastIndex].name.trim().length >= 3 && list[lastIndex].description.trim().length > 0;

  return (
    <div className="space-y-4">
      {list.map((entry, index) => {
        const nameReady = entry.name.trim().length >= 3;
        const isLast = index === lastIndex;
        const isLocked = !isLast; // already-completed entries are read-only, not deletable

        return (
          <div key={index} className="space-y-2 rounded-md border border-gray-100 bg-gray-50/50 p-3">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                {nameLabel(index)}
                <span className="text-red-600"> *</span>
              </label>
              <input
                type="text"
                value={entry.name}
                placeholder={namePlaceholder}
                disabled={isLocked}
                onChange={(e) => updateEntry(index, { name: e.target.value })}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold disabled:bg-gray-100 disabled:text-gray-500"
              />
            </div>

            {nameReady && (
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  {descriptionLabel}
                  <span className="text-red-600"> *</span>
                </label>
                <textarea
                  value={entry.description}
                  placeholder={descriptionPlaceholder}
                  disabled={isLocked}
                  rows={2}
                  onChange={(e) => updateEntry(index, { description: e.target.value })}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold disabled:bg-gray-100 disabled:text-gray-500"
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
