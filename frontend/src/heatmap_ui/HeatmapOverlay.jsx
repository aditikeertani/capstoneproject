import React, { useEffect, useMemo, useRef } from "react";
import h337 from './heatmap.js';

/**
 * Clamp a value to [0, 1].
 */
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/**
 * Convert the backend seat array into heatmap data-points.
 *
 * Each seat from the backend looks like:
 *   { id, x, y, width, height, label, status, confidence }
 *
 * where (x, y) are pixel coordinates within the camera frame,
 * and (width, height) are the frame dimensions.
 *
 * status: 0 = unoccupied, 1 = unattended, 2 = occupied
 * We generate a heatmap point for seats with status >= 1 (occupied or unattended).
 */
function seatsToHeatmapPoints(snapshot, displayW, displayH) {
  if (!snapshot?.seats?.length) return [];

  return snapshot.seats
    .filter(s => Number(s.status) >= 1) // show occupied & unattended
    .map(s => {
      // Normalise seat (x, y) by the frame dimensions
      const frameW = Number(s.width) || snapshot.frame_width || displayW;
      const frameH = Number(s.height) || snapshot.frame_height || displayH;
      const nx = clamp01(Number(s.x) / frameW);
      const ny = clamp01(Number(s.y) / frameH);

      return {
        x: Math.round(nx * displayW),
        y: Math.round(ny * displayH),
        value: Number(s.confidence ?? 1),
      };
    });
}

export default function HeatmapOverlay({
  snapshot,                 // backend JSON from /streams/<id>/latest
  width = 640,
  height = 480,
  imageSrc = null,          // data-URI or URL; null → plain dark background
}) {
  const containerRef = useRef(null);
  const heatmapRef = useRef(null);

  const points = useMemo(
    () => seatsToHeatmapPoints(snapshot, width, height),
    [snapshot, width, height]
  );

  // Create the heatmap instance once
  useEffect(() => {
    if (!containerRef.current) return;

    heatmapRef.current = h337.create({
      container: containerRef.current,
      radius: 40,
      maxOpacity: 0.6,
      blur: 0.85,
    });

    return () => {
      heatmapRef.current = null;
    };
  }, []);

  // Update heatmap data when points change
  useEffect(() => {
    if (!heatmapRef.current) return;

    heatmapRef.current.setData({
      max: 1,
      data: points,
    });
  }, [points]);

  // Determine the "native" frame size for the SVG viewBox
  const frameW = snapshot?.frame_width
    || (snapshot?.seats?.[0]?.width)
    || width;
  const frameH = snapshot?.frame_height
    || (snapshot?.seats?.[0]?.height)
    || height;

  return (
    <div style={{ position: "relative", width, height }}>
      {/* Background image (live frame) or a dark placeholder */}
      {imageSrc ? (
        <img
          src={imageSrc}
          alt="Camera frame"
          style={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            backgroundColor: "#1a1a2e",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#555",
            fontSize: 14,
          }}
        >
          {snapshot ? "No frame available" : "Waiting for data…"}
        </div>
      )}

      {/* Heatmap canvas layer (heatmap.js appends a canvas here) */}
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
      />

      {/* SVG overlay for seat markers / labels */}
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${frameW} ${frameH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "auto",
        }}
      >
        {snapshot?.seats?.map(seat => {
          const status = Number(seat.status);
          const occupied = status >= 1;

          return (
            <g key={seat.id} opacity={occupied ? 1 : 0.5}>
              {/* Seat marker */}
              <circle
                cx={seat.x}
                cy={seat.y}
                r={20}
                fill={
                  status === 2
                    ? "rgba(255,0,0,0.35)"      // occupied → red
                    : status === 1
                    ? "rgba(255,165,0,0.35)"     // unattended → orange
                    : "rgba(0,0,0,0.15)"         // unoccupied → faint
                }
                stroke="rgba(0,0,0,0.35)"
                strokeWidth="2"
              />
              {/* Label */}
              <text
                x={seat.x + 26}
                y={seat.y + 6}
                fontSize="26"
                fill="rgba(255,255,255,0.85)"
              >
                {seat.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
