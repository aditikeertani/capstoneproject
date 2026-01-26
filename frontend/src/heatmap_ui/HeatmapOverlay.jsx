import React, { useEffect, useMemo, useRef } from "react";
import h337 from './heatmap.js';
  
    
function turnt(v){
  return Math.max(0, Math.min(1, v));
}

function seatsToHeatmapPoints(snapshot, displayW, displayH) {
  if (!snapshot?.seats?.length) return [];

  return snapshot.seats
    .filter(s => Number(s.status) === 1)
    .map(s => {
      const nx = turnt(Number(s.x) / Number(s.width));
      const ny = turnt(Number(s.y) / Number(s.height));
      return {
        x: Math.round(nx * displayW),
        y: Math.round(ny * displayH),
        value: Number(s.confidence ?? 1),
      };
    });
}

export default function HeatmapOverlay({
  snapshot,                 // backend JSON: {stream_id, timestamp, screenshot_path, seats:[...]}
  width = 640,
  height = 480,
  imageSrc = "/frame.jpg",  
}) {
  const containerRef = useRef(null);
  const heatmapRef = useRef(null);

  const points = useMemo(
    () => seatsToHeatmapPoints(snapshot, width, height),
    [snapshot, width, height]
  );

    useEffect(() => {
    if (!containerRef.current) return;

    // creation of heatmap once
    heatmapRef.current = h337.create({
      container: containerRef.current,
      radius: 40,
      maxOpacity: 0.6,
      blur: 0.85
    });

    return () => {
      heatmapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!heatmapRef.current || !points) return;

    // updating heatmap when the data changes
    heatmapRef.current.setData({
      max: 1,
      data: points
    });
  }, [points]);

  const frameW = snapshot?.seats?.[0]?.width ?? 1920;
  const frameH = snapshot?.seats?.[0]?.height ?? 1080;

    return (
    <div style={{ position: "relative", width, height }}>
      <img
        src={imageSrc}
        alt="frame"
        style={{ width: "100%", height: "100%", display: "block" }}
      />

      {/* Heatmap canvas goes inside here (heatmap.js appends a canvas) */}
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
      />

      {/* SVG overlay for seats/labels */}
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${frameW} ${frameH}`}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "auto", // allow hover/click
        }}
      >
        {snapshot?.seats?.map(seat => {
          const occupied = Number(seat.status) === 1;
          return (
            <g key={seat.id} opacity={occupied ? 1 : 0.5}>
              {/* seat marker */}
              <circle
                cx={seat.x}
                cy={seat.y}
                r={20}
                fill={occupied ? "rgba(255,0,0,0.35)" : "rgba(0,0,0,0.15)"}
                stroke="rgba(0,0,0,0.35)"
                strokeWidth="2"
              />
              {/* label */}
              <text
                x={seat.x + 26}
                y={seat.y + 6}
                fontSize="26"
                fill="rgba(0,0,0,0.85)"
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
