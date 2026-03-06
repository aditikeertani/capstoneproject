import React, { useState } from "react";
import FloorplanDesigner from "./components/FloorplanDesigner";
import FeedSelection from "./components/FeedSelection";
import HeatmapTest from "./heatmap_ui/HeatmapTest";

export default function App() {
  const [activeTab, setActiveTab] = useState("designer");

  const tabStyle = (tab) => ({
    padding: "10px 16px",
    border: "none",
    backgroundColor: activeTab === tab ? "#007bff" : "#f0f0f0",
    color: activeTab === tab ? "white" : "black",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: activeTab === tab ? "bold" : "normal",
  });

 return (
  <div style={{ padding: 20, fontFamily: "Arial" }}>
    <h1 style={{ marginTop: 0 }}>Occupancy Detection Dashboard</h1>

      {/* Tab Navigation */}
      <div style={{ borderBottom: "1px solid #ddd", marginBottom: 20 }}>
        <button style={tabStyle("designer")} onClick={() => setActiveTab("designer")}>
          Floorplan Designer
        </button>
        <button style={tabStyle("feeds")} onClick={() => setActiveTab("feeds")}>
          Feed Selection
        </button>
        <button style={tabStyle("heatmap")} onClick={() => setActiveTab("heatmap")}>
          Heatmap
        </button>
      </div>

      {activeTab === "feeds" && <FeedSelection />}

      {activeTab === "designer" && <FloorplanDesigner />}

      {activeTab === "heatmap" && <HeatmapTest />}
    </div>
  );
}

