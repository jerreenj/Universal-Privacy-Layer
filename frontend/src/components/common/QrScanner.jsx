/**
 * QrScanner — tiny inline camera QR reader.
 *
 * Used by the Send flow when a customer wants to scan another user's
 * receive QR instead of pasting a long st:eth: meta-address string.
 *
 * Uses the BarcodeDetector Web API where available (Chrome, modern
 * Edge, Safari — uses the platform's built-in detector under the
 * hood). Older browsers show a short fallback message asking the
 * customer to paste the address manually instead.
 *
 * The user clicks "Scan QR" → we ask for camera permission →
 * <video> feeds frames into a hidden canvas → BarcodeDetector
 * scans every ~150 ms until a hit → onResult(value) fires and the
 * scanner closes.
 *
 * No external deps — `BarcodeDetector` ships with the browser;
 * `navigator.mediaDevices` is standard. Zero bundle weight added.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Camera, X, AlertTriangle } from "lucide-react";

export function QrScanner({ onResult, onClose, label = "Scan a receive QR" }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const [err, setErr] = useState("");
  const [supported] = useState(
    typeof window !== "undefined" &&
      "BarcodeDetector" in window &&
      !!navigator?.mediaDevices?.getUserMedia
  );

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // Always stop the camera when component unmounts.
  useEffect(() => () => stop(), [stop]);

  const start = useCallback(async () => {
    setErr("");
    if (!supported) {
      setErr("Camera scanning is not supported in this browser. Paste the address instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();

      // Detect every ~150 ms. BarcodeDetector uses hardware-accelerated
      // paths internally so this rate is plenty fast without churning
      // the canvas.
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      const canvas = canvasRef.current;
      const tick = () => {
        if (video.readyState < 2 || !canvas) return;
        const w = video.videoWidth, h = video.videoHeight;
        if (!w || !h) return;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, w, h);
        detector
          .detect(canvas)
          .then((codes) => {
            if (codes && codes.length > 0) {
              const value = codes[0].rawValue || "";
              if (value) {
                stop();
                onResult && onResult(value);
                return;
              }
            }
          })
          .catch(() => {});
      };
      timerRef.current = setInterval(tick, 150);
    } catch (e) {
      setErr(e?.message || "Camera unavailable");
    }
  }, [supported, onResult, stop]);

  // Auto-start as soon as the panel opens.
  useEffect(() => { start(); return () => stop(); }, [start, stop]);

  return (
    <div className="space-y-3" data-testid="qr-scanner">
      <div className="flex items-center justify-between">
        <p className="text-xs text-white/70 flex items-center gap-2">
          <Camera className="w-3.5 h-3.5" /> {label}
        </p>
        <button
          onClick={() => { stop(); onClose && onClose(); }}
          className="text-white/40 hover:text-white"
          aria-label="Close scanner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {err ? (
        <div className="bg-yellow-500/10 border border-yellow-500/30 p-3 text-xs text-yellow-200/80 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{err}</span>
        </div>
      ) : (
        <div className="bg-black border border-white/10 overflow-hidden">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="w-full max-h-72 object-cover"
            data-testid="qr-scanner-video"
          />
          <canvas ref={canvasRef} className="hidden" />
        </div>
      )}
      <p className="text-[10px] text-white/30 text-center">
        Point the camera at the recipient's QR
      </p>
    </div>
  );
}
