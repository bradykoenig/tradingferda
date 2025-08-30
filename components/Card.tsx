import React from "react";

export default function Card({
  children,
  title,
  subtitle,
  entry,
  target,
  highlight = false,
}: {
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  entry?: number;
  target?: number;
  highlight?: boolean;
}) {
  // Determine bullish/bearish/neutral
  const bullish = entry !== undefined && target !== undefined && target > entry;
  const bearish = entry !== undefined && target !== undefined && target < entry;

  let border = "border-gray-700";
  let subtitleColor = "text-gray-400";

  if (bullish) {
    border = "border-green-500";
    subtitleColor = "text-green-400";
  } else if (bearish) {
    border = "border-red-500";
    subtitleColor = "text-red-400";
  }

  if (highlight) {
    border = "border-yellow-400 shadow-yellow-500/40";
  }

  return (
    <section
      className={`bg-neutral-900 border ${border} rounded-xl shadow-md hover:shadow-lg transition-all p-4`}
    >
      {title && (
        <h3
          className={`leading-tight ${
            highlight
              ? "text-xl font-bold text-yellow-400"
              : "text-lg font-semibold text-white"
          }`}
        >
          {title}
        </h3>
      )}

      {subtitle && (
        <div className={`mt-1 text-sm font-medium ${subtitleColor}`}>
          {subtitle}
        </div>
      )}

      <div className={title || subtitle ? "mt-3" : ""}>{children}</div>
    </section>
  );
}
