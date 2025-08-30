"use client";

import { useState, useEffect } from "react";
import Card from "@/components/Card";
import SymbolChart from "@/components/SymbolChart";

type Plan = {
  strategy: string;
  active: boolean;
  entry: number;
  stop: number;
  target: number;
  rr?: number;
  reason: string;
  direction?: "bullish" | "bearish";
  horizon?: "short" | "long";
};

type Idea = { symbol: string; plan: Plan };

type MarketBias = {
  score: number;
  bias: "bullish" | "bearish" | "neutral";
  spy_close?: number;
  spy_sma200?: number;
  ema20_gt_ema50?: boolean;
  rsi14?: number;
  roc20_pct?: number;
};

type Payload = {
  generated_at_utc: string;
  ideas: Idea[];
  watchlist: string[];
  disclaimer: string;
  market_bias?: MarketBias;
};

export default function Home() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Filters
  const [showBullish, setShowBullish] = useState(true);
  const [showBearish, setShowBearish] = useState(true);
  const [showShort, setShowShort] = useState(true);
  const [showLong, setShowLong] = useState(true);

  // Pinned symbols
  const [pinned, setPinned] = useState<string[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("pinnedSymbols");
    if (saved) setPinned(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem("pinnedSymbols", JSON.stringify(pinned));
  }, [pinned]);

  const togglePinned = (sym: string) => {
    setPinned((prev) => (prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]));
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/data/today.json?ts=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Payload;
      setPayload(data);
    } catch (err) {
      console.error("Error loading today.json:", err);
      setToast({ msg: "Failed to load signals.", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const refreshSignals = async () => {
    try {
      setRefreshing(true);
      const res = await fetch("/api/signals", { method: "POST" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`);
      }
      const data = await res.json().catch(() => ({}));
      if ((data as any).success) {
        await fetchData();
        setToast({ msg: "Signals updated successfully", type: "success" });
      } else {
        setToast({ msg: "Failed to update signals.", type: "error" });
      }
    } catch (err) {
      console.error("Error refreshing signals:", err);
      setToast({ msg: "Error refreshing signals.", type: "error" });
    } finally {
      setRefreshing(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading || !payload) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center">
        <p className="text-gray-400">Loading trade ideas...</p>
      </div>
    );
  }

  // Filter ideas
  const ideas = (payload.ideas || []).filter((i) => {
    const dir = i.plan.direction ?? "bullish";
    const hz = i.plan.horizon ?? "short";
    if (dir === "bullish" && !showBullish) return false;
    if (dir === "bearish" && !showBearish) return false;
    if (hz === "short" && !showShort) return false;
    if (hz === "long" && !showLong) return false;
    return true;
  });

  const shortIdeas = ideas.filter((i) => (i.plan.horizon ?? "short") === "short");
  const longIdeas = ideas.filter((i) => i.plan.horizon === "long");

  // Top picks
  const topPickShort = shortIdeas[0] ?? null;
  const restShort = topPickShort ? shortIdeas.slice(1) : shortIdeas;
  const topPickLong = longIdeas[0] ?? null;
  const restLong = topPickLong ? longIdeas.slice(1) : longIdeas;

  // Bias
  const bias = payload.market_bias?.bias ?? "neutral";
  const biasColor =
    bias === "bullish" ? "bg-green-500" : bias === "bearish" ? "bg-red-500" : "bg-gray-400";

  // NEW: helper to describe the numeric score in words
  const describeScore = (score: number | undefined) => {
    if (score === undefined) return "Unknown";
    if (score >= 3) return "Strong Bullish";
    if (score >= 1) return "Moderately Bullish";
    if (score === 0) return "Neutral";
    if (score <= -3) return "Strong Bearish";
    if (score <= -1) return "Moderately Bearish";
    return "Neutral";
  };

  const dirBadge = (dir?: "bullish" | "bearish") =>
    dir ? (
      <span
        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
          dir === "bearish" ? "bg-red-600/20 text-red-400" : "bg-green-600/20 text-green-400"
        }`}
      >
        {dir.toUpperCase()}
      </span>
    ) : null;

  const horizonBadge = (hz?: "short" | "long") => (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide ${
        (hz ?? "short") === "long"
          ? "bg-indigo-600/20 text-indigo-300"
          : "bg-amber-500/20 text-amber-300"
      }`}
    >
      {(hz ?? "short") === "long" ? "LONG-TERM" : "DAY / SWING"}
    </span>
  );

  // Small helper for a consistent top-right pin button inside Card titles
  const PinButton = ({ symbol }: { symbol: string }) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        togglePinned(symbol);
      }}
      aria-label={pinned.includes(symbol) ? `Unpin ${symbol}` : `Pin ${symbol}`}
      aria-pressed={pinned.includes(symbol)}
      title={pinned.includes(symbol) ? "Unpin" : "Pin"}
      className={`ml-3 shrink-0 rounded-md border border-neutral-700 px-2 py-1 text-xs leading-none hover:bg-neutral-800 active:scale-95 transition ${
        pinned.includes(symbol) ? "text-yellow-300" : "text-gray-300"
      }`}
    >
      📌
    </button>
  );

  return (
    <main className="min-h-screen bg-app text-white relative flex">
      {/* Left Quick Panel */}
      <aside className="hidden xl:block fixed left-6 top-28 w-72 z-40">
        <div className="bg-neutral-900/90 backdrop-blur-md border border-neutral-800 rounded-xl shadow-lg p-4 space-y-4">
          {/* Market Bias */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Market Bias</h3>
              <span className="text-xs text-gray-400">
                {describeScore(payload.market_bias?.score)}{" "}
                {payload.market_bias?.score !== undefined &&
                  `(Score: ${payload.market_bias?.score})`}
              </span>
            </div>
            <div className="w-full bg-neutral-800 rounded-full h-2 overflow-hidden mb-2">
              <div
                className={`h-2 ${biasColor}`}
                style={{ width: `${((payload.market_bias?.score ?? 0) + 4) * 12.5}%` }}
              />
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-300">
              <span>SPY: {payload.market_bias?.spy_close}</span>
              <span>RSI14: {payload.market_bias?.rsi14}</span>
              <span>ROC20: {payload.market_bias?.roc20_pct}%</span>
              <span>SMA200: {payload.market_bias?.spy_sma200}</span>
            </div>
          </div>

          {/* Filters */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Filters</h3>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setShowBullish((s) => !s)}
                className={`px-2 py-0.5 rounded-full text-xs ${
                  showBullish ? "bg-green-600/20 text-green-300" : "bg-neutral-800 text-gray-500"
                }`}
              >
                Bullish
              </button>
              <button
                onClick={() => setShowBearish((s) => !s)}
                className={`px-2 py-0.5 rounded-full text-xs ${
                  showBearish ? "bg-red-600/20 text-red-300" : "bg-neutral-800 text-gray-500"
                }`}
              >
                Bearish
              </button>
              <button
                onClick={() => setShowShort((s) => !s)}
                className={`px-2 py-0.5 rounded-full text-xs ${
                  showShort ? "bg-amber-500/20 text-amber-300" : "bg-neutral-800 text-gray-500"
                }`}
              >
                Day/Swing
              </button>
              <button
                onClick={() => setShowLong((s) => !s)}
                className={`px-2 py-0.5 rounded-full text-xs ${
                  showLong ? "bg-indigo-600/20 text-indigo-300" : "bg-neutral-800 text-gray-500"
                }`}
              >
                Long-Term
              </button>
            </div>
          </div>

          {/* Pinned Symbols */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Pinned Symbols</h3>
            {pinned.length === 0 ? (
              <p className="text-xs text-gray-400">No pinned symbols yet.</p>
            ) : (
              <ul className="space-y-1">
                {pinned.map((sym) => (
                  <li
                    key={sym}
                    className="flex items-center justify-between text-xs bg-neutral-800 px-2 py-1 rounded"
                  >
                    <span>{sym}</span>
                    <button
                      onClick={() => togglePinned(sym)}
                      className="text-red-400 hover:text-red-300"
                      aria-label={`Unpin ${sym}`}
                      aria-pressed
                      title="Unpin"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 relative z-10 ml-80">
        <div className="mx-auto max-w-6xl px-6 pb-12">
          {/* Header */}
          <header className="flex items-center justify-between py-6">
            <div className="flex items-center gap-3">
              <img
                src="/schlimatrading.png"
                alt="Schlima Trading Logo"
                className="w-11 h-11 rounded-full bg-white object-cover shadow-md"
              />
              <div>
                <h1 className="text-xl md:text-2xl font-bold tracking-tight">
                  Schlima Trading <span className="text-gray-400 font-medium">Daily Playbook</span>
                </h1>
                <p className="text-[12px] text-gray-400">
                  Generated {new Date(payload.generated_at_utc).toLocaleString()}
                </p>
              </div>
            </div>
            <button
              onClick={refreshSignals}
              disabled={refreshing}
              className="btn-primary px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {refreshing ? "Refreshing…" : "Refresh Signals"}
            </button>
          </header>

          {/* ===== Day & Swing Setups ===== */}
          <section className="mt-6">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">Day &amp; Swing Setups</h2>
              <span className="text-xs text-gray-400">{shortIdeas.length} idea(s)</span>
            </div>

            {topPickShort && (
              <Card
                highlight
                title={
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">
                      {topPickShort.symbol} — Top Pick
                    </span>
                    <PinButton symbol={topPickShort.symbol} />
                  </div>
                }
                subtitle={
                  <div className="flex items-center gap-2">
                    <span>{topPickShort.plan.strategy}</span>
                    {dirBadge(topPickShort.plan.direction)}
                    {horizonBadge(topPickShort.plan.horizon)}
                  </div>
                }
              >
                <div className="text-sm grid grid-cols-2 gap-x-4 gap-y-2">
                  <div className="text-blue-400">
                    <strong>Entry:</strong> {topPickShort.plan.entry.toFixed(2)}
                  </div>
                  <div className="text-red-400">
                    <strong>Stop:</strong> {topPickShort.plan.stop.toFixed(2)}
                  </div>
                  <div className="text-green-400">
                    <strong>Target:</strong> {topPickShort.plan.target.toFixed(2)}
                  </div>
                  {topPickShort.plan.rr && (
                    <div>
                      <strong>R/R:</strong> {topPickShort.plan.rr.toFixed(2)}
                    </div>
                  )}
                </div>
                <p className="mt-3 text-gray-300 text-sm leading-relaxed">
                  {topPickShort.plan.reason}
                </p>
                <div className="mt-4">
                  <SymbolChart
                    symbol={topPickShort.symbol.toLowerCase()}
                    levels={topPickShort.plan}
                    height={320}
                  />
                </div>
              </Card>
            )}

            {restShort.length > 0 && (
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 mt-6">
                {restShort.map(({ symbol, plan }) => (
                  <Card
                    key={`${symbol}-${plan.strategy}-${plan.direction ?? "NA"}-short`}
                    title={
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{symbol}</span>
                        <PinButton symbol={symbol} />
                      </div>
                    }
                    subtitle={
                      <div className="flex items-center gap-2">
                        <span>{plan.strategy}</span>
                        {dirBadge(plan.direction)}
                        {horizonBadge(plan.horizon)}
                      </div>
                    }
                  >
                    <div className="text-sm grid grid-cols-2 gap-x-4 gap-y-2">
                      <div className="text-blue-400">
                        <strong>Entry:</strong> {plan.entry.toFixed(2)}
                      </div>
                      <div className="text-red-400">
                        <strong>Stop:</strong> {plan.stop.toFixed(2)}
                      </div>
                      <div className="text-green-400">
                        <strong>Target:</strong> {plan.target.toFixed(2)}
                      </div>
                      {plan.rr && (
                        <div>
                          <strong>R/R:</strong> {plan.rr.toFixed(2)}
                        </div>
                      )}
                    </div>
                    <p className="mt-3 text-gray-300 text-xs leading-relaxed">{plan.reason}</p>
                    <div className="mt-4">
                      <SymbolChart symbol={symbol.toLowerCase()} levels={plan} height={220} />
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* ===== Long-Term Ideas ===== */}
          {longIdeas.length > 0 && (
            <section className="mt-12">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="text-lg font-semibold">Long-Term Ideas</h2>
                <span className="text-xs text-gray-400">{longIdeas.length} idea(s)</span>
              </div>

              {topPickLong && (
                <Card
                  highlight
                  title={
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">
                        {topPickLong.symbol} — Top Pick (Long-Term)
                      </span>
                      <PinButton symbol={topPickLong.symbol} />
                    </div>
                  }
                  subtitle={
                    <div className="flex items-center gap-2">
                      <span>{topPickLong.plan.strategy}</span>
                      {dirBadge(topPickLong.plan.direction)}
                      {horizonBadge(topPickLong.plan.horizon)}
                    </div>
                  }
                >
                  <div className="text-sm grid grid-cols-2 gap-x-4 gap-y-2">
                    <div className="text-blue-400">
                      <strong>Entry:</strong> {topPickLong.plan.entry.toFixed(2)}
                    </div>
                    <div className="text-red-400">
                      <strong>Stop:</strong> {topPickLong.plan.stop.toFixed(2)}
                    </div>
                    <div className="text-green-400">
                      <strong>Target:</strong> {topPickLong.plan.target.toFixed(2)}
                    </div>
                    {topPickLong.plan.rr && (
                      <div>
                        <strong>R/R:</strong> {topPickLong.plan.rr.toFixed(2)}
                      </div>
                    )}
                  </div>
                  <p className="mt-3 text-gray-300 text-sm leading-relaxed">
                    {topPickLong.plan.reason}
                  </p>
                  <div className="mt-4">
                    <SymbolChart
                      symbol={topPickLong.symbol.toLowerCase()}
                      levels={topPickLong.plan}
                      height={320}
                    />
                  </div>
                </Card>
              )}

              {restLong.length > 0 && (
                <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 mt-6">
                  {restLong.map(({ symbol, plan }) => (
                    <Card
                      key={`${symbol}-${plan.strategy}-${plan.direction ?? "NA"}-long`}
                      title={
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">{symbol}</span>
                          <PinButton symbol={symbol} />
                        </div>
                      }
                      subtitle={
                        <div className="flex items-center gap-2">
                          <span>{plan.strategy}</span>
                          {dirBadge(plan.direction)}
                          {horizonBadge(plan.horizon)}
                        </div>
                      }
                    >
                      <div className="text-sm grid grid-cols-2 gap-x-4 gap-y-2">
                        <div className="text-blue-400">
                          <strong>Entry:</strong> {plan.entry.toFixed(2)}
                        </div>
                        <div className="text-red-400">
                          <strong>Stop:</strong> {plan.stop.toFixed(2)}
                        </div>
                        <div className="text-green-400">
                          <strong>Target:</strong> {plan.target.toFixed(2)}
                        </div>
                        {plan.rr && (
                          <div>
                            <strong>R/R:</strong> {plan.rr.toFixed(2)}
                          </div>
                        )}
                      </div>
                      <p className="mt-3 text-gray-300 text-xs leading-relaxed">{plan.reason}</p>
                      <div className="mt-4">
                        <SymbolChart symbol={symbol.toLowerCase()} levels={plan} height={220} />
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Footer */}
          <footer className="mt-12 text-sm text-gray-400 border-t border-neutral-800 pt-4">
            <p>{payload.disclaimer}</p>
            <p className="mt-1">
              Strategies: Trend-Pullback, Mean-Reversion, Weekly Trend. Ranked by risk–reward and
              quality; reflects current market bias.
            </p>
          </footer>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 px-4 py-2 rounded-lg shadow-md text-sm font-medium ${
            toast.type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </main>
  );
}
