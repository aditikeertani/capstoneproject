import React from "react";

export default function Dashboard({ onCreate, onView }) {
  return (
    <div
      style={{
        padding: 24,
        background: "#f5f7fb",
        borderRadius: 12,
        border: "1px solid #e0e6ef",
      }}
    >
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Dashboard</h2>
        <p style={{ marginTop: 6, color: "#556" }}>
          Choose what you want to do next.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
        }}
      >
        <button
          onClick={onView}
          style={{
            padding: 18,
            borderRadius: 12,
            border: "1px solid #d8e2f0",
            background: "white",
            cursor: "pointer",
            textAlign: "left",
            boxShadow: "0 6px 18px rgba(20, 40, 80, 0.08)",
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
            View Existing Heatmaps
          </div>
          <div style={{ fontSize: 13, color: "#667" }}>
            Jump straight into a live occupancy view.
          </div>
        </button>

        <button
          onClick={onCreate}
          style={{
            padding: 18,
            borderRadius: 12,
            border: "1px solid #cfe6d5",
            background: "white",
            cursor: "pointer",
            textAlign: "left",
            boxShadow: "0 6px 18px rgba(20, 80, 40, 0.08)",
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
            Create New Heatmap
          </div>
          <div style={{ fontSize: 13, color: "#667" }}>
            Start the setup wizard from scratch.
          </div>
        </button>
      </div>
    </div>
  );
}
