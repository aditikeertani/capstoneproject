import React, { useEffect, useMemo, useRef } from "react";
import h337 from './heatmap.js';

/**
 * Clamp a value between min and max.
 */
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Convert the backend seat array into heatmap data-points.
 *
 * When rendering on the floorplan, seats are positioned using their
 * floorplan-relative coordinates (x, y within image_width × image_height).
 *
 * When rendering on the camera frame, we use camera coordinates if available.
 */
function seatsToHeatmapPoints(snapshot, displayW, displayH, useFloorplan) {
  if (!snapshot?.seats?.length) return [];

  const refW = useFloorplan
    ? (snapshot.floorplan_width || displayW)
    : (snapshot.frame_width || displayW);
  const refH = useFloorplan
    ? (snapshot.floorplan_height || displayH)
    : (snapshot.frame_height || displayH);

  return snapshot.seats
    .filter(s => Number(s.status) === 1)
    .map(s => {
      let nx, ny;

      if (useFloorplan) {
        // Use the centre of the floorplan bounding box
        const cx = Number(s.x) + (Number(s.width) || 0) / 2;
        const cy = Number(s.y) + (Number(s.height) || 0) / 2;
        nx = clamp(cx / refW, 0, 1);
        ny = clamp(cy / refH, 0, 1);
      } else {
        // Camera frame: prefer camera coordinates if available
        const hasCameraCoords = s.camera_x != null && s.camera_width > 0;
        if (hasCameraCoords) {
          nx = clamp((Number(s.camera_x) + Number(s.camera_width) / 2) / refW, 0, 1);
          ny = clamp((Number(s.camera_y) + Number(s.camera_height) / 2) / refH, 0, 1);
        } else {
          // Fallback: centre of the floorplan bounding box
          const cx = Number(s.x) + (Number(s.width) || 0) / 2;
          const cy = Number(s.y) + (Number(s.height) || 0) / 2;
          nx = clamp(cx / refW, 0, 1);
          ny = clamp(cy / refH, 0, 1);
        }
      }

      return {
        x: Math.round(nx * displayW),
        y: Math.round(ny * displayH),
        value: Number(s.confidence ?? 1),
      };
    });
}

export default function HeatmapOverlay({
  snapshot,                 // backend JSON from /streams/<id>/latest
  width: maxWidth = 960,    // maximum display width
  height: maxHeight = 720,  // maximum display height
  imageSrc = null,          // data-URI or URL; null → dark placeholder
}) {
  const containerRef = useRef(null);
  const heatmapRef = useRef(null);

  // Determine whether we're rendering on the floorplan or the camera frame
  const useFloorplan = !!snapshot?.floorplan;

  // Use floorplan dimensions when available, otherwise fall back to camera frame
  const sourceW = useFloorplan
    ? (snapshot?.floorplan_width || 1920)
    : (snapshot?.frame_width || 1920);
  const sourceH = useFloorplan
    ? (snapshot?.floorplan_height || 1080)
    : (snapshot?.frame_height || 1080);

  const scale = Math.min(maxWidth / sourceW, maxHeight / sourceH, 1);
  const displayW = Math.round(sourceW * scale);
  const displayH = Math.round(sourceH * scale);

  const points = useMemo(
    () => seatsToHeatmapPoints(snapshot, displayW, displayH, useFloorplan),
    [snapshot, displayW, displayH, useFloorplan]
  );

  // Create the heatmap instance (re-create when display size changes)
  useEffect(() => {
    if (!containerRef.current) return;

    // Clear any existing heatmap canvas
    const existing = containerRef.current.querySelector('.heatmap-canvas');
    if (existing) existing.remove();

    heatmapRef.current = h337.create({
      container: containerRef.current,
      radius: Math.round(40 * scale),
      maxOpacity: 0.6,
      blur: 0.85,
      width: displayW,
      height: displayH,
    });

    return () => {
      heatmapRef.current = null;
    };
  }, [displayW, displayH, scale]);

  // Update heatmap data when points change
  useEffect(() => {
    if (!heatmapRef.current) return;

    heatmapRef.current.setData({
      max: 1,
      data: points,
    });
  }, [points]);

  return (
    <div style={{ position: "relative", width: displayW, height: displayH }}>
      {/* Background image (live frame) or a dark placeholder */}
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={useFloorplan ? "Floorplan" : "Camera frame"}
          style={{
            width: displayW,
            height: displayH,
            display: "block",
            objectFit: "fill",
          }}
        />
      ) : (
        <div
          style={{
            width: displayW,
            height: displayH,
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

      {/* Heatmap canvas layer */}
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: displayW,
          height: displayH,
        }}
      />

      {/* SVG overlay for seat markers / labels */}
      <svg
        width={displayW}
        height={displayH}
        viewBox={`0 0 ${sourceW} ${sourceH}`}
        preserveAspectRatio="none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          pointerEvents: "auto",
        }}
      >
        {snapshot?.seats?.map(seat => {
          const status = Number(seat.status);
          const occupied = status === 1;

          let cx, cy;
          if (useFloorplan) {
            // Centre of the floorplan bounding box
            cx = Number(seat.x) + (Number(seat.width) || 0) / 2;
            cy = Number(seat.y) + (Number(seat.height) || 0) / 2;
          } else {
            // On the camera frame, prefer camera coords if available
            const hasCameraCoords = seat.camera_x != null && seat.camera_width > 0;
            if (hasCameraCoords) {
              cx = Number(seat.camera_x) + Number(seat.camera_width) / 2;
              cy = Number(seat.camera_y) + Number(seat.camera_height) / 2;
            } else {
              // Fallback: centre of the floorplan bounding box
              cx = Number(seat.x) + (Number(seat.width) || 0) / 2;
              cy = Number(seat.y) + (Number(seat.height) || 0) / 2;
            }
          }

          return (
            <g key={seat.id} opacity={1}>
              {/* Seat marker */}
              <circle
                cx={cx}
                cy={cy}
                r={20}
                fill={
                  occupied
                    ? "rgba(255,60,60,0.45)"       // occupied → red
                    : "rgba(60,255,60,0.25)"       // unoccupied → green
                }
                stroke={
                  occupied 
                    ? "rgba(255,60,60,0.9)" 
                    : "rgba(60,255,60,0.7)"
                }
                strokeWidth="3"
              />
              {/* Label */}
              <text
                x={cx + 26}
                y={cy + 6}
                fontSize="22"
                fontWeight="bold"
                fill="rgba(255,255,255,0.9)"
                stroke="rgba(0,0,0,0.5)"
                strokeWidth="0.5"
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
