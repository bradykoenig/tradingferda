"use client";

import {
  createChart,
  IChartApi,
  CandlestickData,
  UTCTimestamp,
  ColorType,
  PriceLineOptions,
} from "lightweight-charts";
import React, { useEffect, useRef } from "react";

type LevelLines = { entry?: number; stop?: number; target?: number };

export default function SymbolChart({
  symbol,
  levels,
  height = 240,
}: {
  symbol: string;
  levels?: LevelLines;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = containerRef.current!;
    const chart = createChart(el, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: "#0a0a0a" },
        textColor: "#cbd5e1",
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.1)" },
        horzLines: { color: "rgba(148,163,184,0.1)" },
      },
      rightPriceScale: { borderColor: "rgba(148,163,184,0.2)" },
      timeScale: { borderColor: "rgba(148,163,184,0.2)" },
    });
    chartRef.current = chart;

    const series = chart.addCandlestickSeries({
      upColor: "#16a34a",
      downColor: "#ef4444",
      borderUpColor: "#16a34a",
      borderDownColor: "#ef4444",
      wickUpColor: "#16a34a",
      wickDownColor: "#ef4444",
    });

    let ro: ResizeObserver | null = null;
    const resize = () => chart.applyOptions({ width: el.clientWidth });
    ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    (async () => {
      try {
        const resp = await fetch(`/ohlc/${symbol}.json`, { cache: "no-store" });
        if (!resp.ok) throw new Error("missing OHLC");
        const json = await resp.json();
        const data: CandlestickData[] = (json as any[]).map((row) => ({
          time: row.time as UTCTimestamp,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
        }));
        series.setData(data);

        // --- Price lines ---
        const priceLine = (
          price: number,
          color: string,
          title: string
        ): PriceLineOptions => ({
          price,
          color,
          lineWidth: 2,
          lineStyle: 0,
          lineVisible: true,
          axisLabelVisible: true,
          axisLabelColor: color,
          axisLabelTextColor: "#e5e7eb",
          title,
        });

        if (levels?.entry)
          series.createPriceLine(priceLine(levels.entry, "#60a5fa", "Entry"));
        if (levels?.stop)
          series.createPriceLine(priceLine(levels.stop, "#ef4444", "Stop"));
        if (levels?.target)
          series.createPriceLine(priceLine(levels.target, "#22c55e", "Target"));

        // --- Markers ---
        if (levels?.entry || levels?.stop || levels?.target) {
          const markers: any[] = [];
          const lastCandle = data[data.length - 1];

          const bullish =
            levels?.entry !== undefined &&
            levels?.target !== undefined &&
            levels.target > levels.entry;

          if (levels?.entry) {
            markers.push({
              time: lastCandle.time,
              position: bullish ? "belowBar" : "aboveBar",
              color: bullish ? "#60a5fa" : "#ef4444",
              shape: bullish ? "arrowUp" : "arrowDown",
              text: `Entry ${levels.entry.toFixed(2)}`,
            });
          }
          if (levels?.stop) {
            markers.push({
              time: lastCandle.time,
              position: "aboveBar",
              color: "#ef4444",
              shape: "arrowDown",
              text: `Stop ${levels.stop.toFixed(2)}`,
            });
          }
          if (levels?.target) {
            markers.push({
              time: lastCandle.time,
              position: bullish ? "aboveBar" : "belowBar",
              color: "#22c55e",
              shape: "flag",
              text: `Target ${levels.target.toFixed(2)}`,
            });
          }

          series.setMarkers(markers);
        }

        chart.timeScale().fitContent();
      } catch {
        // no data
      }
    })();

    return () => {
      if (ro) ro.disconnect();
      chart.remove();
    };
  }, [symbol, height, levels?.entry, levels?.stop, levels?.target]);

  return (
    <div
      ref={containerRef}
      className="chart-container w-full"
      style={{ height }}
    />
  );
}
