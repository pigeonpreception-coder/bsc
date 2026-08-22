import type { StrategyMapView } from "@/lib/strategy-map-view";

// Static SVG, server-rendered — no interactivity in this first version (no
// graph/canvas library exists anywhere in this app, and nothing here needs
// one yet: the layout math is already fully resolved by strategy-map-layout.ts
// before this component ever runs, this just turns level/order into pixels).

const BOX_W = 180;
const BOX_H = 56;
const COL_GAP = 24;
const ROW_GAP = 64;
const MARGIN = 24;

export default function StrategyMapDiagram({ view }: { view: StrategyMapView }) {
  const { objectives, connections } = view;
  if (objectives.length === 0) return null;

  // Descending: highest level (Financial) renders nearest the top of the
  // image, matching the spec's bottom-to-top causal reading.
  const levels = Array.from(new Set(objectives.map((o) => o.level))).sort((a, b) => b - a);

  const byLevel = new Map<number, typeof objectives>();
  for (const o of objectives) {
    const list = byLevel.get(o.level) ?? [];
    list.push(o);
    byLevel.set(o.level, list);
  }
  for (const list of byLevel.values()) list.sort((a, b) => a.order - b.order);

  const rowWidth = (count: number) => count * BOX_W + Math.max(0, count - 1) * COL_GAP;
  const totalWidth = Math.max(...levels.map((l) => rowWidth((byLevel.get(l) ?? []).length))) + 2 * MARGIN;
  const totalHeight = MARGIN * 2 + levels.length * BOX_H + Math.max(0, levels.length - 1) * ROW_GAP;

  type Position = { x: number; y: number; text: string };
  const positionById = new Map<string, Position>();

  for (const level of levels) {
    const rowItems = byLevel.get(level) ?? [];
    const y = MARGIN + levels.indexOf(level) * (BOX_H + ROW_GAP);
    const offsetX = (totalWidth - rowWidth(rowItems.length)) / 2;
    rowItems.forEach((o, i) => {
      const x = offsetX + i * (BOX_W + COL_GAP);
      positionById.set(o.id, { x, y, text: o.text });
    });
  }

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${totalWidth} ${totalHeight}`}
        width={totalWidth}
        height={totalHeight}
        role="img"
        aria-label="Strategy map showing cause-and-effect connections between strategic objectives"
      >
        <defs>
          <marker id="strategy-map-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#002147" />
          </marker>
        </defs>

        {connections.map((c, i) => {
          const from = positionById.get(c.from);
          const to = positionById.get(c.to);
          if (!from || !to) return null;

          if (c.type === "vertical") {
            const x1 = from.x + BOX_W / 2;
            const y1 = from.y;
            const x2 = to.x + BOX_W / 2;
            const y2 = to.y + BOX_H;
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#002147"
                strokeWidth={1.5}
                markerEnd="url(#strategy-map-arrow)"
              />
            );
          }

          // Lateral — a shallow arc that stays within this row's own
          // vertical footprint (§9), so it can never cross a vertical line.
          const [left, right] = from.x <= to.x ? [from, to] : [to, from];
          const x1 = left.x + BOX_W;
          const y1 = left.y + BOX_H / 2;
          const x2 = right.x;
          const y2 = right.y + BOX_H / 2;
          const midX = (x1 + x2) / 2;
          return (
            <path
              key={i}
              d={`M ${x1} ${y1} Q ${midX} ${left.y} ${x2} ${y2}`}
              stroke="#C9A84C"
              strokeWidth={1.5}
              fill="none"
              markerEnd="url(#strategy-map-arrow)"
            />
          );
        })}

        {Array.from(positionById.entries()).map(([id, pos]) => (
          <g key={id}>
            <rect
              x={pos.x}
              y={pos.y}
              width={BOX_W}
              height={BOX_H}
              rx={6}
              fill="white"
              stroke="#002147"
              strokeWidth={1}
            />
            <foreignObject x={pos.x + 6} y={pos.y + 4} width={BOX_W - 12} height={BOX_H - 8}>
              <div className="flex h-full items-center overflow-hidden text-center text-[10px] leading-tight text-navy">
                <span className="line-clamp-3 w-full">{pos.text}</span>
              </div>
            </foreignObject>
          </g>
        ))}
      </svg>
    </div>
  );
}
