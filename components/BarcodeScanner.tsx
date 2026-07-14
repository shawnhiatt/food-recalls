"use client";

import { useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";

// Camera barcode scanning (SPEC.md §12 Scanner tab, Phase 7). Uses ZXing
// (dynamically imported, camera-route-only) rather than the native
// BarcodeDetector API — BarcodeDetector is Chrome/Android-only and this app
// targets iOS-installed PWAs too (Phase 3 already verifies push there).
// Manual UPC entry (ScannerPage) is always available regardless of camera
// support — feature-detected the same way ShareButton degrades gracefully.
export function BarcodeScanner({
  active,
  onDetected,
}: {
  active: boolean;
  onDetected: (upc: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Keep the latest callback in a ref so the camera effect only restarts when
  // `active` changes, not on every parent re-render (the pantry list below
  // is a live query and re-renders often).
  const onDetectedRef = useRef(onDetected);
  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Camera not available on this device — use manual entry below.");
      return;
    }

    let cancelled = false;
    let controls: IScannerControls | null = null;
    setError(null);

    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        const started = await reader.decodeFromConstraints(
          { video: { facingMode: "environment" } },
          videoRef.current!,
          (result) => {
            if (result && !cancelled) onDetectedRef.current(result.getText());
          },
        );
        if (cancelled) {
          started.stop();
        } else {
          controls = started;
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? `Couldn't access the camera (${err.message}) — use manual entry below.`
              : "Couldn't access the camera — use manual entry below.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [active]);

  if (!active) return null;

  return (
    <div className="overflow-hidden rounded-(--radius-base)" style={{ background: "#000" }}>
      {error ? (
        <p className="px-4 py-8 text-center text-sm text-white">{error}</p>
      ) : (
        <video
          ref={videoRef}
          className="aspect-square w-full object-cover"
          muted
          playsInline
          aria-label="Camera viewfinder for barcode scanning"
        />
      )}
    </div>
  );
}
