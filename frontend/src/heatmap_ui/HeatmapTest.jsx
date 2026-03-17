import React, { useEffect, useState, useCallback, useRef } from "react";
import HeatmapOverlay from "./HeatmapOverlay";
import { getFloorplanLatest, getStreams } from "../api";

const POLL_INTERVAL_MS = 5000; // refresh every 5 seconds

export default function HeatmapTest() {
  const [snapshot, setSnapshot] = useState(null);
  const [floorplans, setFloorplans] = useState([]);
  const [selectedFloorplanId, setSelectedFloorplanId] = useState("");
  const [initialFloorplanId, setInitialFloorplanId] = useState("");
  const [isEmbed, setIsEmbed] = useState(false);
  const [embedLink, setEmbedLink] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [containerSize, setContainerSize] = useState({ width: 960, height: 540 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const containerRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qpFloorplanId =
      params.get("floorplanId") || params.get("floorplan_id") || "";
    const embedParam = (params.get("embed") || "").toLowerCase();
    const embed = embedParam === "1" || embedParam === "true" || embedParam === "yes";
    if (qpFloorplanId) setInitialFloorplanId(qpFloorplanId);
    if (embed) setIsEmbed(true);
  }, []);

  // Load available floorplans on mount (derived from streams)
  useEffect(() => {
    (async () => {
      try {
        const data = await getStreams();
        const list = data.streams || [];

        const grouped = new Map();
        list.forEach((stream) => {
          const floorplanId = stream.floorplan_id;
          if (!floorplanId) return;
          const floorName = stream.floor_name || "";
          if (!grouped.has(floorplanId)) {
            grouped.set(floorplanId, {
              id: floorplanId,
              label: floorName ? floorName : `Floorplan ${floorplanId}`,
              streamCount: 0,
            });
          }
          const entry = grouped.get(floorplanId);
          entry.streamCount += 1;
          if (floorName && entry.label && entry.label.startsWith("Floorplan ")) {
            entry.label = floorName;
          }
        });

        const floorplanList = Array.from(grouped.values());
        setFloorplans(floorplanList);
        const hasInitial = initialFloorplanId
          ? floorplanList.some((fp) => fp.id === initialFloorplanId)
          : false;
        if (hasInitial) {
          setSelectedFloorplanId(initialFloorplanId);
        } else if (floorplanList.length > 0 && !selectedFloorplanId) {
          setSelectedFloorplanId(floorplanList[0].id);
        }
      } catch (e) {
        console.error("Failed to load floorplans:", e);
        setError("Failed to load floorplans. Is the backend running?");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFloorplanId]);

  // Fetch the latest snapshot for the selected floorplan
  const fetchSnapshot = useCallback(async () => {
    if (!selectedFloorplanId) return;
    setLoading(true);
    setError("");
    try {
      const data = await getFloorplanLatest(selectedFloorplanId);
      console.log("LIVE AGGREGATED RESULT:", data.seats);
      setSnapshot(data);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (e) {
      console.error("Snapshot fetch error:", e);
      setError("Failed to load occupancy data: " + e.message);
    }
    setLoading(false);
  }, [selectedFloorplanId]);

  // Polling
  useEffect(() => {
    if (!autoRefresh || !selectedFloorplanId) return;
    const timer = setInterval(fetchSnapshot, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, selectedFloorplanId, fetchSnapshot]);

  // Prefer the uploaded floorplan over any live camera frame
  const floorplanSrc = snapshot?.floorplan
    ? `data:image/png;base64,${snapshot.floorplan}`
    : null;
  const frameSrc = snapshot?.frame
    ? `data:image/jpeg;base64,${snapshot.frame}`
    : null;
  const imageSrc = floorplanSrc || frameSrc;

  useEffect(() => {
    if (!selectedFloorplanId) {
      setEmbedLink("");
      return;
    }
    const base = `${window.location.origin}${window.location.pathname}`;
    const params = new URLSearchParams();
    params.set("embed", "1");
    params.set("floorplanId", selectedFloorplanId);
    setEmbedLink(`${base}?${params.toString()}`);
  }, [selectedFloorplanId]);

  useEffect(() => {
    if (!containerRef.current) return;
    const target = containerRef.current;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      setContainerSize({ width, height });
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [isEmbed, selectedFloorplanId]);

  const iframeSnippet = embedLink
    ? `<iframe src="${embedLink}" width="960" height="540" style="border:0;" loading="lazy"></iframe>`
    : "";

  const handleCopy = async (text) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("Copied");
    } catch (e) {
      setCopyStatus("Copy failed");
    }
    setTimeout(() => setCopyStatus(""), 2000);
  };

  return (
    <div>
      {!isEmbed && (
        <>
          {/* Controls */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 16,
            flexWrap: "wrap",
          }}>
            <select
              value={selectedFloorplanId}
              onChange={(e) => {
                setSelectedFloorplanId(e.target.value);
                setSnapshot(null);
              }}
              style={{ padding: 8, borderRadius: 4, border: "1px solid #ddd" }}
            >
              <option value="">Select a floorplan...</option>
              {floorplans.map((fp) => (
                <option key={fp.id} value={fp.id}>
                  {fp.label} ({fp.streamCount} cameras)
                </option>
              ))}
            </select>

            <button
              onClick={fetchSnapshot}
              disabled={!selectedFloorplanId || loading}
              style={{
                padding: "8px 16px",
                backgroundColor: selectedFloorplanId ? "#2196F3" : "#ccc",
                color: "white",
                border: "none",
                borderRadius: 4,
                cursor: selectedFloorplanId ? "pointer" : "not-allowed",
              }}
            >
              {loading ? "Loading..." : "Refresh Now"}
            </button>

            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              Auto-refresh ({POLL_INTERVAL_MS / 1000}s)
            </label>

            {lastUpdated && (
              <span style={{ fontSize: 12, color: "#888" }}>
                Last update: {lastUpdated}
              </span>
            )}
          </div>

          {/* Embed Controls */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            marginBottom: 16,
          }}>
            <input
              type="text"
              readOnly
              value={embedLink || "Select a floorplan to generate an embed link"}
              style={{
                flex: 1,
                minWidth: 240,
                padding: 8,
                borderRadius: 4,
                border: "1px solid #ddd",
                fontSize: 12,
              }}
            />
            <button
              onClick={() => handleCopy(embedLink)}
              disabled={!embedLink}
              style={{
                padding: "8px 12px",
                backgroundColor: embedLink ? "#4CAF50" : "#ccc",
                color: "white",
                border: "none",
                borderRadius: 4,
                cursor: embedLink ? "pointer" : "not-allowed",
              }}
            >
              Copy Link
            </button>
            <button
              onClick={() => handleCopy(iframeSnippet)}
              disabled={!embedLink}
              style={{
                padding: "8px 12px",
                backgroundColor: embedLink ? "#6c757d" : "#ccc",
                color: "white",
                border: "none",
                borderRadius: 4,
                cursor: embedLink ? "pointer" : "not-allowed",
              }}
            >
              Copy Iframe
            </button>
            {copyStatus && (
              <span style={{ fontSize: 12, color: "#2e7d32" }}>
                {copyStatus}
              </span>
            )}
          </div>
        </>
      )}

      {/* Error banner */}
      {error && (
        <div style={{
          padding: 10,
          backgroundColor: "#ffebee",
          color: "#c62828",
          borderRadius: 4,
          marginBottom: 12,
        }}>
          {error}
        </div>
      )}

      {/* Heatmap */}
      {!selectedFloorplanId ? (
        <div style={{ color: "#999", textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>HEAT</div>
          <div>
            {isEmbed
              ? "Missing floorplanId in the embed link."
              : "Select a floorplan above to view the occupancy heatmap"}
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          style={{
            width: "100%",
            height: isEmbed ? "100vh" : "auto",
            minHeight: isEmbed ? "100vh" : 540,
          }}
        >
          <HeatmapOverlay
            snapshot={snapshot}
            width={isEmbed ? containerSize.width : 960}
            height={isEmbed ? containerSize.height : 540}
            imageSrc={imageSrc}
          />
        </div>
      )}
    </div>
  );
}
