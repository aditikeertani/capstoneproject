import React, { useState } from "react";
import { ping } from "./api";
import FloorplanUpload from "./components/FloorplanUpload";
import StreamAssignment from "./components/StreamAssignment";
import HeatmapOverlay from "./heatmap_ui/HeatmapOverlay";
import HeatmapTest from "./heatmap_ui/HeatmapTest";
import FloorplanDesigner from "./components/FloorplanDesigner";
import FeedSelection from "./components/FeedSelection";

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

   const detectionPoints = [
    { x: 320, y: 240, value: 0.9 },
    { x: 200, y: 180, value: 0.7 }
  ];


 return (
  <div style={{ padding: 20, fontFamily: "Arial" }}>
    <h1 style={{ marginTop: 0 }}>Occupancy Detection Dashboard</h1>

      {/* Tab Navigation */}
      <div style={{ borderBottom: "1px solid #ddd", marginBottom: 20 }}>
        <button style={tabStyle("dashboard")} onClick={() => setActiveTab("dashboard")}>
          Dashboard
        </button>
        <button style={tabStyle("designer")} onClick={() => setActiveTab("designer")}>
          Floorplan Designer
        </button>
      </div>

      {activeTab === "dashboard" && (
        <>
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
        </>
      )}

      {activeTab === "designer" && <FloorplanDesigner />}
    </div>
  );
}

