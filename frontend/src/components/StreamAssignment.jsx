import React, { useState } from "react";
import { assignStream } from "../api";

export default function StreamAssignment() {
  const [cameraId, setCameraId] = useState("cam-1");
  const [zoneId, setZoneId] = useState("zone-A");
  const [streamUrl, setStreamUrl] = useState("rtsp://example/stream");
  const [status, setStatus] = useState("");

  const onSubmit = async () => {
    setStatus("Sending...");
    try {
      const payload = { cameraId, zoneId, streamUrl };
      const resp = await assignStream(payload);
      setStatus("✅ Assigned! " + JSON.stringify(resp));
    } catch (e) {
      setStatus("❌ Failed. Check Flask + CORS.");
    }
  };

  return (
    <div style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8 }}>
      <h2 style={{ marginTop: 0 }}>2) Assign Stream</h2>

      <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
        <label>
          Camera ID
          <input
            value={cameraId}
            onChange={(e) => setCameraId(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>

        <label>
          Zone ID (table/seat group)
          <input
            value={zoneId}
            onChange={(e) => setZoneId(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>

        <label>
          Stream URL
          <input
            value={streamUrl}
            onChange={(e) => setStreamUrl(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>

        <button onClick={onSubmit} style={{ padding: "8px 12px" }}>
          Save Assignment
        </button>

        <div>{status}</div>
      </div>
    </div>
  );
}
