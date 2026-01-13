import React, { useState } from "react";
import { ping } from "./api";
import FloorplanUpload from "./components/FloorplanUpload";
import StreamAssignment from "./components/StreamAssignment";

export default function App() {
  const [pingResult, setPingResult] = useState("");

  const onPing = async () => {
    setPingResult("Pinging...");
    try {
      const data = await ping();
      setPingResult("✅ " + JSON.stringify(data));
    } catch (e) {
      setPingResult("❌ Failed to reach backend. Is Flask running?");
    }
  };

  return (
    <div style={{ padding: 20, fontFamily: "Arial" }}>
      <h1 style={{ marginTop: 0 }}>Occupancy Detection Dashboard</h1>

      <div style={{ marginBottom: 16 }}>
        <button onClick={onPing} style={{ padding: "8px 12px" }}>
          Ping Backend
        </button>
        <span style={{ marginLeft: 10 }}>{pingResult}</span>
      </div>

      <div style={{ display: "grid", gap: 16 }}>
        <FloorplanUpload />
        <StreamAssignment />
      </div>
    </div>
  );
}
