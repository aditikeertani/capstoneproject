import React, { useEffect, useMemo, useRef } from "react";
import h337 from './heatmap.js';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
function isEntrance(item) {
  if (!item) return false;
  if (item.type === "entrance") return true;
  if (typeof item.id === "string" && item.id.startsWith("entrance")) return true;
  if (typeof item.label === "string" && item.label.toLowerCase().startsWith("entrance")) return true;
  return false;
}

function hasCameraMapping(item) {
  if (!item) return false;
  const cx = Number(item.camera_x);
  const cy = Number(item.camera_y);
  const cw = Number(item.camera_width ?? item.camera_w);
  const ch = Number(item.camera_height ?? item.camera_h);
  if (![cx, cy, cw, ch].every(Number.isFinite)) return false;
  return cx > 0 && cy > 0 && cw > 0 && ch > 0;
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
    // 👉 1. STRICT FILTER: Ignore anything that is an entrance
    .filter(s => {
      const status = Number(s.status);
      if (status === -1) return false; // Explicitly exclude offline seats from glow
      if (!hasCameraMapping(s)) return false; // Unmapped seats shouldn't glow
      return status === 1 && !isEntrance(s);
    })
    .map(s => {
      let nx, ny;

      if (useFloorplan) {
        const cx = Number(s.x) + (Number(s.width) || 0) / 2;
        const cy = Number(s.y) + (Number(s.height) || 0) / 2;
        nx = clamp(cx / refW, 0, 1);
        ny = clamp(cy / refH, 0, 1);
      } else {
        const hasCameraCoords = hasCameraMapping(s);
        if (hasCameraCoords) {
          const cw = Number(s.camera_width ?? s.camera_w);
          const ch = Number(s.camera_height ?? s.camera_h);
          nx = clamp((Number(s.camera_x) + cw / 2) / refW, 0, 1);
          ny = clamp((Number(s.camera_y) + ch / 2) / refH, 0, 1);
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
  showLegend = true,
}) {
  const useFloorplan = !!snapshot?.floorplan;
  const containerRef = useRef(null);
  const heatmapRef = useRef(null);

  const sourceW = useFloorplan
    ? (snapshot?.floorplan_width || 1920)
    : (snapshot?.frame_width || 1920);
  const sourceH = useFloorplan
    ? (snapshot?.floorplan_height || 1080)
    : (snapshot?.frame_height || 1080);

  const scale = Math.min(maxWidth / sourceW, maxHeight / sourceH);
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
      radius: Math.round(50 * scale), // Slightly larger radius for visual blending
      maxOpacity: 0.55,
      blur: 0.85,
      width: displayW,
      height: displayH,
    });

    return () => { heatmapRef.current = null; };
  }, [displayW, displayH, scale]);

  useEffect(() => {
    if (!heatmapRef.current) return;
    heatmapRef.current.setData({ max: 1, data: points });
  }, [points]);
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
    <div ref={containerRef} style={{ position: "relative", width: displayW, height: displayH }}>
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

      {/* The precise Shapes layer */}
      <svg
        width={displayW}
        height={displayH}
        viewBox={`0 0 ${sourceW} ${sourceH}`}
        preserveAspectRatio="none"
        style={{ position: "absolute", top: 0, left: 0, pointerEvents: "auto" }}
      >
        {snapshot?.seats?.map((item) => {
          // 👉 2. RENDER ENTRANCES (Cosmetic Only)
          if (isEntrance(item)) {
            const isHorizontal = item.width >= item.height;
            const barW = 8; 
            const lineT = 4;
            
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
              </g>
            );
          }
          // 👉 3. RENDER SEATS (Warped to exact floorplan shapes)
          const status = Number(item.status);
          const isUnmapped = !hasCameraMapping(item);
          const isOffline = status === -1 || isUnmapped;
          const occupied = status === 1;

          // Determine dimensions based on whether we are looking at the floorplan or the camera feed
          let renderX, renderY, renderW, renderH;
          if (!useFloorplan && hasCameraMapping(item)) {
            renderX = Number(item.camera_x);
            renderY = Number(item.camera_y);
            renderW = Number(item.camera_width ?? item.camera_w);
            renderH = Number(item.camera_height ?? item.camera_h);
          } else {
            renderX = Number(item.x);
            renderY = Number(item.y);
            renderW = Number(item.width) || 40;
            renderH = Number(item.height) || 40;
          }
          const cx = renderX + renderW / 2;
          const cy = renderY + renderH / 2;

          const fillColor = isOffline
            ? "rgba(0, 0, 0, 0.7)"
            : (occupied ? "rgba(255, 60, 60, 0.45)" : "rgba(60, 255, 60, 0.25)");
          const strokeColor = isOffline
            ? "rgba(100, 100, 100, 0.9)"
            : (occupied ? "rgba(255, 60, 60, 0.9)" : "rgba(60, 255, 60, 0.7)");

          return (
            <g key={item.id} opacity={1}>
              
              {/* Draw Ellipse or Rectangle based on the shape drawn in Step 1 */}
              {item.type === "circle" ? (
                <ellipse
                  cx={cx}
                  cy={cy}
                  rx={renderW / 2}
                  ry={renderH / 2}
                  fill={fillColor}
                  stroke={strokeColor}
                  strokeWidth="3"
                />
              ) : (
                <rect
                  x={renderX}
                  y={renderY}
                  width={renderW}
                  height={renderH}
                  fill={fillColor}
                  stroke={strokeColor}
                  strokeWidth="3"
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
    {showLegend && (
      <div style={{
        minWidth: 180,
        padding: 10,
        border: "1px solid #ddd",
        borderRadius: 8,
        backgroundColor: "#fafafa",
        color: "#222",
        fontSize: 12,
      }}>
        <div style={{ fontWeight: "bold", marginBottom: 8 }}>Legend</div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div style={{ width: 24, height: 24, backgroundColor: "rgba(60, 255, 60, 0.25)", border: "2px solid rgba(60, 255, 60, 0.7)" }} />
          <div>Unoccupied seat</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div style={{ width: 24, height: 24, backgroundColor: "rgba(255, 60, 60, 0.45)", border: "2px solid rgba(255, 60, 60, 0.9)" }} />
          <div>Occupied seat</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div style={{ width: 24, height: 24, backgroundColor: "rgba(0, 0, 0, 0.7)", border: "2px solid rgba(100, 100, 100, 0.9)" }} />
          <div>Camera offline or unmapped</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <svg width="28" height="18" viewBox="0 0 28 18" aria-hidden="true">
            <rect x="0" y="0" width="4" height="18" fill="#333" />
            <rect x="24" y="0" width="4" height="18" fill="#333" />
            <rect x="0" y="7" width="28" height="4" fill="#333" />
          </svg>
          <div>Entrance</div>
        </div>
      </div>
    )}
    </div>
  );
}
