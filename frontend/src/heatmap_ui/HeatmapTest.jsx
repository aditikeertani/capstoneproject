import React, { useEffect, useState, useCallback } from "react";
import HeatmapOverlay from "./HeatmapOverlay";
import { getdata, getStreams } from "../api";

const POLL_INTERVAL_MS = 5000; // refresh every 5 seconds

export default function HeatmapTest() {
  const [snapshot, setSnapshot] = useState(null);
  const [streams, setStreams] = useState([]);
  const [selectedStreamId, setSelectedStreamId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Load available streams on mount
  useEffect(() => {
    (async () => {
      try {
        const data = await getStreams();
        const list = data.streams || [];
        setStreams(list);
        if (list.length > 0 && !selectedStreamId) {
          setSelectedStreamId(list[0].id);
        }
      } catch (e) {
        console.error("Failed to load streams:", e);
        setError("Failed to load streams. Is the backend running?");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch the latest snapshot for the selected stream
  const fetchSnapshot = useCallback(async () => {
    if (!selectedStreamId) return;
    setLoading(true);
    setError("");
    try {
      const data = await getdata(selectedStreamId);
      console.log("snapshot from backend:", data);
      setSnapshot(data);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (e) {
      console.error("Snapshot fetch error:", e);
      setError("Failed to load occupancy data: " + e.message);
    }
    setLoading(false);
  }, [selectedStreamId]);

  // Initial fetch when stream changes
  useEffect(() => {
    if (selectedStreamId) {
      fetchSnapshot();
    }
  }, [selectedStreamId, fetchSnapshot]);

  // Polling
  useEffect(() => {
    if (!autoRefresh || !selectedStreamId) return;
    const timer = setInterval(fetchSnapshot, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, selectedStreamId, fetchSnapshot]);

  // Build the image source from the backend response
  const imageSrc = snapshot?.frame
    ? `data:image/jpeg;base64,${snapshot.frame}`
    : null;

  const displayWidth = snapshot?.frame_width || 640;
  const displayHeight = snapshot?.frame_height || 480;

  return (
    <div>
      {/* Controls */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginBottom: 16,
        flexWrap: "wrap",
      }}>
        <select
          value={selectedStreamId}
          onChange={(e) => {
            setSelectedStreamId(e.target.value);
            setSnapshot(null);
          }}
          style={{ padding: 8, borderRadius: 4, border: "1px solid #ddd" }}
        >
          <option value="">Select a stream…</option>
          {streams.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name || s.id}
            </option>
          ))}
        </select>

        <button
          onClick={fetchSnapshot}
          disabled={!selectedStreamId || loading}
          style={{
            padding: "8px 16px",
            backgroundColor: selectedStreamId ? "#2196F3" : "#ccc",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: selectedStreamId ? "pointer" : "not-allowed",
          }}
        >
          {loading ? "Loading…" : "Refresh Now"}
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
      {!selectedStreamId ? (
        <div style={{ color: "#999", textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>🔥</div>
          <div>Select a stream above to view the occupancy heatmap</div>
        </div>
      ) : (
        <HeatmapOverlay
          snapshot={snapshot}
          width={Math.min(displayWidth, 960)}
          height={Math.min(displayHeight, 720)}
          imageSrc={imageSrc}
        />
      )}
    </div>
  );
}
