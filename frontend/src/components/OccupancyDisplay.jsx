import React, { useState, useEffect } from "react";
import { getOccupancy } from "../api";

export default function OccupancyDisplay() {
  const [occupancy, setOccupancy] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);

  const loadOccupancy = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getOccupancy();
      setOccupancy(data);
    } catch (e) {
      setError("Failed to load occupancy data");
    }
    setLoading(false);
  };

  // Load on mount
  useEffect(() => {
    loadOccupancy();
  }, []);

  // Auto-refresh every 10 seconds if enabled
  useEffect(() => {
    if (!autoRefresh) return;
    
    const interval = setInterval(loadOccupancy, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const getStatusColor = (status) => {
    switch (status) {
      case "Occupied": return "#f44336";
      case "Unattended": return "#ff9800";
      case "Unoccupied": return "#4CAF50";
      default: return "#9e9e9e";
    }
  };

  const getStatusEmoji = (status) => {
    switch (status) {
      case "Occupied": return "🔴";
      case "Unattended": return "🟡";
      case "Unoccupied": return "🟢";
      default: return "⚪";
    }
  };

  return (
    <div style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ marginTop: 0 }}>📊 Occupancy Status</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 4 }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh
          </label>
          <button 
            onClick={loadOccupancy}
            disabled={loading}
            style={{ 
              padding: "6px 12px", 
              backgroundColor: "#2196F3", 
              color: "white", 
              border: "none", 
              borderRadius: 4,
              cursor: loading ? "not-allowed" : "pointer"
            }}
          >
            {loading ? "Loading..." : "🔄 Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "8px 12px", backgroundColor: "#ffebee", borderRadius: 4, marginBottom: 16 }}>
          ❌ {error}
        </div>
      )}

      {occupancy && (
        <>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 16 }}>
            Last updated: {new Date(occupancy.timestamp).toLocaleTimeString()}
            {autoRefresh && " (auto-refreshing every 10s)"}
          </div>

          {/* Legend */}
          <div style={{ display: "flex", gap: 16, marginBottom: 16, fontSize: 14 }}>
            <span>🟢 Unoccupied</span>
            <span>🟡 Unattended</span>
            <span>🔴 Occupied</span>
          </div>

          {/* Streams with occupancy data */}
          {Object.keys(occupancy.streams).length === 0 ? (
            <p style={{ color: "#666" }}>
              No occupancy data yet. Add a stream and wait for capture, or trigger a manual capture.
            </p>
          ) : (
            Object.entries(occupancy.streams).map(([streamId, seats]) => (
              <div key={streamId} style={{ marginBottom: 16 }}>
                <h4 style={{ marginBottom: 8 }}>Stream: {streamId}</h4>
                <div style={{ 
                  display: "grid", 
                  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", 
                  gap: 8 
                }}>
                  {Object.values(seats).map((seat) => (
                    <div 
                      key={seat.id}
                      style={{ 
                        padding: "10px 14px",
                        backgroundColor: getStatusColor(seat.status) + "20",
                        borderLeft: `4px solid ${getStatusColor(seat.status)}`,
                        borderRadius: 4
                      }}
                    >
                      <div style={{ fontWeight: "bold" }}>
                        {getStatusEmoji(seat.status)} {seat.label}
                      </div>
                      <div style={{ fontSize: 13 }}>
                        Status: <strong>{seat.status}</strong>
                      </div>
                      <div style={{ fontSize: 12, color: "#666" }}>
                        Confidence: {(seat.confidence * 100).toFixed(1)}%
                      </div>
                      <div style={{ fontSize: 11, color: "#999" }}>
                        Position: ({seat.x}, {seat.y})
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}

          {/* Coordinates reference */}
          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: "pointer", color: "#666" }}>
              View all seat coordinates ({occupancy.coordinates?.length || 0})
            </summary>
            <pre style={{ 
              backgroundColor: "#f5f5f5", 
              padding: 12, 
              borderRadius: 4, 
              fontSize: 12,
              overflow: "auto"
            }}>
              {JSON.stringify(occupancy.coordinates, null, 2)}
            </pre>
          </details>
        </>
      )}
    </div>
  );
}
