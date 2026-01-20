"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useUsdScene } from "@/hooks/useUsdScene";
import { useRobot } from "@/hooks/useRobot";

export default function UsdViewer() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { registerIframeWindow, isLoading } = useUsdScene();
  const {
    activeRobotType,
    setActiveRobotType,
    setActiveRobotOwner,
    setActiveRobotName,
  } = useRobot();

  useEffect(() => {
    if (activeRobotType !== "USD") {
      console.log("[USD] Setting USD robot");
      setActiveRobotType("USD");
      setActiveRobotOwner("placeholder");
      setActiveRobotName("bike"); // Default to bike as it's a good USD example
    }
  }, [
    activeRobotType,
    setActiveRobotType,
    setActiveRobotOwner,
    setActiveRobotName,
  ]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    iframe.onerror = (error) => {
      console.error("[USD] ❌ Iframe failed to load:", error);
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      if (event.data?.type === "IFRAME_READY") {
        registerIframeWindow(iframe.contentWindow);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      registerIframeWindow(null);
    };
  }, [registerIframeWindow]);

  return (
    <div className="w-full h-full flex flex-row relative">
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--mujoco-scene-bg)",
          boxShadow: "2px 0 8px rgba(0,0,0,0.04)",
          position: "relative",
          zIndex: 1,
        }}
      >
        {isLoading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 2,
              pointerEvents: "none",
            }}
          >
            <Loader2 className="h-7 w-7 animate-spin opacity-90 text-accent" />
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={"/usd-viewer/usd.html"}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
          style={{
            width: "100%",
            height: "100%",
            margin: 0,
            padding: 0,
            border: "none",
            display: "block",
            background: "var(--mujoco-scene-bg)",
            borderRadius: "12px",
          }}
          title="USD Viewer"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      </div>
    </div>
  );
}
