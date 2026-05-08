import { useEffect, useRef } from "react";

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TradingView: any;
  }
}

interface TradingViewChartProps {
  ticker: string;
  height?: number;
}

export function TradingViewChart({ ticker, height = 650 }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = "";

    const uniqueId = `tv_${ticker.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
    const innerDiv = document.createElement("div");
    innerDiv.id = uniqueId;
    innerDiv.style.height = "100%";
    innerDiv.style.width = "100%";
    container.appendChild(innerDiv);

    const initWidget = () => {
      if (!window.TradingView || !document.getElementById(uniqueId)) return;
      new window.TradingView.widget({
        autosize: true,
        symbol: ticker,
        interval: "D",
        timezone: "America/New_York",
        theme: "dark",
        style: "1",
        locale: "en",
        backgroundColor: "rgba(9, 9, 11, 1)",
        gridColor: "rgba(255, 255, 255, 0.04)",
        enable_publishing: false,
        allow_symbol_change: true,
        save_image: true,
        hide_side_toolbar: false,
        hide_top_toolbar: false,
        hide_legend: false,
        withdateranges: true,
        range: "6M",
        container_id: uniqueId,
        studies: [
          "Volume@tv-basicstudies",
          "RSI@tv-basicstudies",
          "MACD@tv-basicstudies",
        ],
        show_popup_button: true,
        popup_width: "1400",
        popup_height: "800",
        support_host: "https://www.tradingview.com",
      });
    };

    const existingScript = document.getElementById("tradingview-tv-js");
    if (existingScript) {
      if (window.TradingView) {
        initWidget();
      } else {
        existingScript.addEventListener("load", initWidget, { once: true });
      }
    } else {
      const script = document.createElement("script");
      script.id = "tradingview-tv-js";
      script.src = "https://s3.tradingview.com/tv.js";
      script.async = true;
      script.onload = initWidget;
      document.head.appendChild(script);
    }

    return () => {
      if (container) container.innerHTML = "";
    };
  }, [ticker]);

  return (
    <div
      ref={containerRef}
      style={{ height, width: "100%" }}
    />
  );
}
