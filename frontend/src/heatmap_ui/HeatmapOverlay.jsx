import React, { useEffect, useMemo, useRef } from "react";
import h337 from './heatmap.js';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function seatsToHeatmapPoints(snapshot, displayW, displayH, useFloorplan) {
  if (!snapshot?.seats?.length) return [];

  const refW = useFloorplan
    ? (snapshot.floorplan_width || displayW)
    : (snapshot.frame_width || displayW);
  const refH = useFloorplan
    ? (snapshot.floorplan_height || displayH)
    : (snapshot.frame_height || displayH);

  return snapshot.seats
    .filter(s => Number(s.status) === 1 && !s.id.startsWith('entrance')) // 👉 Filter out entrances from Heatmap calculation
    .map(s => {
      let nx, ny;

      if (useFloorplan) {
        const cx = Number(s.x) + (Number(s.width) || 0) / 2;
        const cy = Number(s.y) + (Number(s.height) || 0) / 2;
        nx = clamp(cx / refW, 0, 1);
        ny = clamp(cy / refH, 0, 1);
      } else {
        const hasCameraCoords = s.camera_x != null && s.camera_width > 0;
        if (hasCameraCoords) {
          nx = clamp((Number(s.camera_x) + Number(s.camera_width) / 2) / refW, 0, 1);
          ny = clamp((Number(s.camera_y) + Number(s.camera_height) / 2) / refH, 0, 1);
        } else {
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
  snapshot,                
  width: maxWidth = 960,   
  height: maxHeight = 720,  
  imageSrc = null,         
}) {
  const containerRef = useRef(null);
  const heatmapRef = useRef(null);
  const useFloorplan = !!snapshot?.floorplan;

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

  useEffect(() => {
    if (!containerRef.current) return;
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

    return () => { heatmapRef.current = null; };
  }, [displayW, displayH, scale]);

  useEffect(() => {
    if (!heatmapRef.current) return;
    heatmapRef.current.setData({
      max: 1,
      data: points,
    });
  }, [points]);

  return (
    <div style={{ position: "relative", width: displayW, height: displayH }}>
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={useFloorplan ? "Floorplan" : "Camera frame"}
          style={{ width: displayW, height: displayH, display: "block", objectFit: "fill" }}
        />
      ) : (
        <div style={{ width: displayW, height: displayH, backgroundColor: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 14 }}>
          {snapshot ? "No frame available" : "Waiting for data…"}
        </div>
      )}

      <div ref={containerRef} style={{ position: "absolute", top: 0, left: 0, width: displayW, height: displayH }} />

      <svg
        width={displayW}
        height={displayH}
        viewBox={`0 0 ${sourceW} ${sourceH}`}
        preserveAspectRatio="none"
        style={{ position: "absolute", top: 0, left: 0, pointerEvents: "auto" }}
      >
        {snapshot?.seats?.map(item => {
          
          // 👉 NEW: Intercept Entrance shapes and draw them statically!
          if (item.id.startsWith("entrance")) {
            const isHorizontal = item.width >= item.height;
            const barW = 12; 
            const lineT = 6;
            
            return (
              <g key={item.id} opacity={0.85}>
                {isHorizontal ? (
                  <>
                    <rect x={item.x} y={item.y} width={barW} height={item.height} fill="#333" />
                    <rect x={item.x + item.width - barW} y={item.y} width={barW} height={item.height} fill="#333" />
                    <rect x={item.x} y={item.y + (item.height/2) - (lineT/2)} width={item.width} height={lineT} fill="#333" />
                  </>
                ) : (
                  <>
                    <rect x={item.x} y={item.y} width={item.width} height={barW} fill="#333" />
                    <rect x={item.x} y={item.y + item.height - barW} width={item.width} height={barW} fill="#333" />
                    <rect x={item.x + (item.width/2) - (lineT/2)} y={item.y} width={lineT} height={item.height} fill="#333" />
                  </>
                )}
                {/* Optional Label */}
                <text x={item.x} y={item.y - 10} fontSize="20" fontWeight="bold" fill="#333">{item.label}</text>
              </g>
            );
          }

          // Existing Seat Circle Logic
          const status = Number(item.status);
          const occupied = status === 1;

          let cx, cy;
          if (useFloorplan) {
            cx = Number(item.x) + (Number(item.width) || 0) / 2;
            cy = Number(item.y) + (Number(item.height) || 0) / 2;
          } else {
            const hasCameraCoords = item.camera_x != null && item.camera_width > 0;
            if (hasCameraCoords) {
              cx = Number(item.camera_x) + Number(item.camera_width) / 2;
              cy = Number(item.camera_y) + Number(item.camera_height) / 2;
            } else {
              cx = Number(item.x) + (Number(item.width) || 0) / 2;
              cy = Number(item.y) + (Number(item.height) || 0) / 2;
            }
          }

          return (
            <g key={item.id} opacity={1}>
              <circle
                cx={cx}
                cy={cy}
                r={20}
                fill={occupied ? "rgba(255,60,60,0.45)" : "rgba(60,255,60,0.25)"}
                stroke={occupied ? "rgba(255,60,60,0.9)" : "rgba(60,255,60,0.7)"}
                strokeWidth="3"
              />
              <text
                x={cx + 26}
                y={cy + 6}
                fontSize="22"
                fontWeight="bold"
                fill="rgba(255,255,255,0.9)"
                stroke="rgba(0,0,0,0.5)"
                strokeWidth="0.5"
              >
                {item.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}