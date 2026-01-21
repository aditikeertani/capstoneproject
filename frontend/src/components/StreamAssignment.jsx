import React, { useState, useEffect } from "react";
import { addStream, getStreams, removeStream, captureStream } from "../api";

export default function StreamAssignment() {
  const [streamName, setStreamName] = useState("Camera 1");
  const [streamUrl, setStreamUrl] = useState("rtsp://localhost:8554/0.sdp");
  const [status, setStatus] = useState("");
  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(false);

  // Load existing streams on mount
  useEffect(() => {
    loadStreams();
  }, []);

  const loadStreams = async () => {
    try {
      const data = await getStreams();
      setStreams(data.streams || []);
    } catch (e) {
      console.error("Failed to load streams:", e);
    }
  };

  const onAddStream = async () => {
    if (!streamUrl) {
      setStatus("❌ Please enter a stream URL");
      return;
    }
    
    setLoading(true);
    setStatus("Adding stream...");
    
    try {
      const resp = await addStream(streamUrl, streamName);
      setStatus(`✅ Stream added: ${resp.stream.id}`);
      setStreams([...streams, resp.stream]);
      setStreamName(`Camera ${streams.length + 2}`);
    } catch (e) {
      setStatus("❌ Failed to add stream. Is the backend running?");
    }
    
    setLoading(false);
  };

  const onRemoveStream = async (streamId) => {
    try {
      await removeStream(streamId);
      setStreams(streams.filter(s => s.id !== streamId));
      setStatus(`✅ Stream ${streamId} removed`);
    } catch (e) {
      setStatus(`❌ Failed to remove stream: ${e.message}`);
    }
  };

  const onCaptureStream = async (streamId) => {
    setStatus(`Capturing from ${streamId}...`);
    try {
      const result = await captureStream(streamId);
      setStatus(`✅ Captured! Prediction: ${result.prediction.class_name} (${(result.prediction.confidence * 100).toFixed(1)}%)`);
    } catch (e) {
      setStatus(`❌ Capture failed: ${e.message}`);
    }
  };

  return (
    <div style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8 }}>
      <h2 style={{ marginTop: 0 }}>📹 Video Streams</h2>

      {/* Add New Stream Form */}
      <div style={{ display: "grid", gap: 8, maxWidth: 520, marginBottom: 16 }}>
        <label>
          Stream Name
          <input
            value={streamName}
            onChange={(e) => setStreamName(e.target.value)}
            style={{ width: "100%", padding: "6px 10px", marginTop: 4 }}
            placeholder="e.g., Camera 1"
          />
        </label>

        <label>
          Stream URL
          <input
            value={streamUrl}
            onChange={(e) => setStreamUrl(e.target.value)}
            style={{ width: "100%", padding: "6px 10px", marginTop: 4 }}
            placeholder="rtsp://localhost:8554/0.sdp"
          />
        </label>

        <button 
          onClick={onAddStream} 
          disabled={loading}
          style={{ 
            padding: "10px 16px", 
            backgroundColor: "#4CAF50", 
            color: "white", 
            border: "none", 
            borderRadius: 4,
            cursor: loading ? "not-allowed" : "pointer"
          }}
        >
          {loading ? "Adding..." : "➕ Add Stream"}
        </button>
      </div>

      {/* Status Message */}
      {status && (
        <div style={{ 
          padding: "8px 12px", 
          backgroundColor: status.startsWith("✅") ? "#e8f5e9" : status.startsWith("❌") ? "#ffebee" : "#fff3e0",
          borderRadius: 4,
          marginBottom: 16
        }}>
          {status}
        </div>
      )}

      {/* Active Streams List */}
      <h3>Active Streams ({streams.length})</h3>
      {streams.length === 0 ? (
        <p style={{ color: "#666" }}>No streams added yet. Add a stream URL above.</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {streams.map((stream) => (
            <div 
              key={stream.id} 
              style={{ 
                display: "flex", 
                justifyContent: "space-between", 
                alignItems: "center",
                padding: "10px 14px", 
                backgroundColor: "#f5f5f5", 
                borderRadius: 4 
              }}
            >
              <div>
                <strong>{stream.name}</strong>
                <div style={{ fontSize: 12, color: "#666" }}>{stream.url}</div>
                <div style={{ fontSize: 11, color: "#999" }}>ID: {stream.id}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button 
                  onClick={() => onCaptureStream(stream.id)}
                  style={{ 
                    padding: "6px 12px", 
                    backgroundColor: "#2196F3", 
                    color: "white", 
                    border: "none", 
                    borderRadius: 4,
                    cursor: "pointer"
                  }}
                >
                  📸 Capture
                </button>
                <button 
                  onClick={() => onRemoveStream(stream.id)}
                  style={{ 
                    padding: "6px 12px", 
                    backgroundColor: "#f44336", 
                    color: "white", 
                    border: "none", 
                    borderRadius: 4,
                    cursor: "pointer"
                  }}
                >
                  ✕ Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
