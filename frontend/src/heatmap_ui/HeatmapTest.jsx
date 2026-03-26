import React, { useEffect, useState, useCallback, useRef } from "react";
import HeatmapOverlay from "./HeatmapOverlay";
import { getFloorplanLatest, getFloorplans } from "../api";

const POLL_INTERVAL_MS = 10000; // refresh every 10 seconds

export default function HeatmapTest({ onBack }) {
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
  const pollRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qpFloorplanId =
      params.get("floorplanId") || params.get("floorplan_id") || "";
    const embedParam = (params.get("embed") || "").toLowerCase();
    const embed = embedParam === "1" || embedParam === "true" || embedParam === "yes" || window.location.pathname.includes("/embed");
    if (qpFloorplanId) setInitialFloorplanId(qpFloorplanId);
    if (embed) setIsEmbed(true);
  }, []);

  // Load available floorplans on mount
  useEffect(() => {
    (async () => {
      try {
        const data = await getFloorplans();
        const list = data.floorplans || [];
        const floorplanList = list.map((fp) => {
          const id = fp.id || fp._id;
          const label =
            fp.floor_name ||
            fp.floorName ||
            fp.filename ||
            (id ? `Floorplan ${id}` : "Floorplan");
          const streamCount = Array.isArray(fp.stream_ids)
            ? fp.stream_ids.length
            : fp.stream_id
            ? 1
            : 0;
          return { id, label, streamCount };
        });
        setFloorplans(floorplanList);
        if (initialFloorplanId) {
          setSelectedFloorplanId(initialFloorplanId);
        } else if (floorplanList.length > 0 && !selectedFloorplanId) {
          setSelectedFloorplanId(floorplanList[0].id);
        }
      } catch (e) {
        console.error("Failed to load floorplans:", e);
        if (initialFloorplanId) setSelectedFloorplanId(initialFloorplanId);
        if (!initialFloorplanId) setError("Failed to load floorplans. Is the backend running?");
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
    pollRef.current = timer;
    return () => {
      clearInterval(timer);
      if (pollRef.current === timer) {
        pollRef.current = null;
      }
    };
  }, [autoRefresh, selectedFloorplanId, fetchSnapshot]);

  // Load immediately when floorplan changes
  useEffect(() => {
    if (!selectedFloorplanId) return;
    fetchSnapshot();
  }, [selectedFloorplanId, fetchSnapshot]);

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
    const base = `${window.location.origin}/embed`;
    const params = new URLSearchParams();
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

  const handleBack = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setAutoRefresh(false);
    setSnapshot(null);
    setSelectedFloorplanId("");
    if (onBack) onBack();
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
            {onBack && (
              <button
                onClick={handleBack}
                style={{
                  padding: "8px 12px",
                  backgroundColor: "#f1f3f5",
                  color: "#333",
                  border: "1px solid #ddd",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                &larr; Back to Dashboard
              </button>
            )}
            <select
              value={selectedFloorplanId}
              onChange={(e) => {
                setSelectedFloorplanId(e.target.value);
                setSnapshot(null);
              }}
              style={{ padding: 8, borderRadius: 4, border: "1px solid #ddd" }}
            >
              <option value="">Select Floorplan / Heatmap...</option>
              {floorplans.map((fp) => (
                <option key={fp.id} value={fp.id}>
                  {fp.label}{fp.streamCount ? ` (${fp.streamCount} cameras)` : ""}
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
            height: isEmbed ? "100vh" : "70vh",
            minHeight: isEmbed ? "100vh" : 420,
          }}
        >
          <HeatmapOverlay
            snapshot={snapshot}
            width={Math.max(1, containerSize.width || 960)}
            height={Math.max(1, containerSize.height || 540)}
            imageSrc={imageSrc}
          />
        </div>
      )}
    </div>
  );
}
