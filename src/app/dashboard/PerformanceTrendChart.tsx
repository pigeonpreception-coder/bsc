"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function PerformanceTrendChart({ data }: { data: { date: string; completion: number }[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-gray-400">No performance updates recorded yet.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
        <Tooltip formatter={(value) => [`${Number(value).toFixed(0)}%`, "Completion"]} />
        <Line type="monotone" dataKey="completion" stroke="#002147" strokeWidth={2} dot={{ fill: "#C9A84C" }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
