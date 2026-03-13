import React from "react";

export default function SetupStep({
  floors,
  setFloors,
  streams,
  setStreams,
}) {
  const baseInputStyle = {
    padding: 6,
    border: "1px solid #ccc",
    borderRadius: 4,
  };
  const errorInputStyle = {
    ...baseInputStyle,
    border: "1px solid #f44336",
  };
  const isValidRtspUrl = (value) => {
    if (!value) return false;
    return /^rtsp:\/\/[^/\s]+\/.+/i.test(value.trim());
  };
  const addFloor = () => {
    const newId = `floor_${Date.now()}`;
    setFloors((prev) => [
      ...prev,
      { id: newId, name: `Floor ${prev.length + 1}` },
    ]);
  };

  const updateFloorName = (floorId, name) => {
    setFloors((prev) =>
      prev.map((floor) =>
        floor.id === floorId ? { ...floor, name } : floor
      )
    );
  };

  const removeFloor = (floorId) => {
    setFloors((prev) => prev.filter((floor) => floor.id !== floorId));
    setStreams((prev) =>
      prev.map((stream) =>
        stream.floorId === floorId ? { ...stream, floorId: "" } : stream
      )
    );
  };

  const addStream = () => {
    const newId = `stream_${Date.now()}`;
    const defaultFloorId = floors[0]?.id || "";
    setStreams((prev) => [
      ...prev,
      { id: newId, name: "", url: "", floorId: defaultFloorId },
    ]);
  };

  const updateStream = (streamId, field, value) => {
    setStreams((prev) =>
      prev.map((stream) =>
        stream.id === streamId ? { ...stream, [field]: value } : stream
      )
    );
  };

  const removeStream = (streamId) => {
    setStreams((prev) => prev.filter((stream) => stream.id !== streamId));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Floors</h3>
          <button
            onClick={addFloor}
            style={{
              padding: "6px 10px",
              backgroundColor: "#2196F3",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Add Floor
          </button>
        </div>

        {floors.length === 0 ? (
          <div style={{ marginTop: 10, color: "#666", fontSize: 13 }}>
            No floors yet. Add at least one floor to continue.
          </div>
        ) : (
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {floors.map((floor, index) => (
              <div
                key={floor.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 8,
                  alignItems: "center",
                  padding: 8,
                  border: "1px solid #eee",
                  borderRadius: 6,
                }}
              >
                <input
                  type="text"
                  value={floor.name}
                  onChange={(e) => updateFloorName(floor.id, e.target.value)}
                  placeholder={`Floor ${index + 1}`}
                  style={
                    floor.name?.trim() ? baseInputStyle : errorInputStyle
                  }
                />
                <button
                  onClick={() => removeFloor(floor.id)}
                  style={{
                    padding: "6px 10px",
                    backgroundColor: "#f44336",
                    color: "white",
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Camera Streams</h3>
          <button
            onClick={addStream}
            style={{
              padding: "6px 10px",
              backgroundColor: "#4CAF50",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Add Stream
          </button>
        </div>

        {streams.length === 0 ? (
          <div style={{ marginTop: 10, color: "#666", fontSize: 13 }}>
            No streams yet. Add your camera URLs and assign them to floors.
          </div>
        ) : (
          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            {streams.map((stream) => (
              <div
                key={stream.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr auto",
                  gap: 8,
                  alignItems: "center",
                  padding: 8,
                  border: "1px solid #eee",
                  borderRadius: 6,
                }}
              >
                <input
                  type="text"
                  value={stream.name}
                  onChange={(e) => updateStream(stream.id, "name", e.target.value)}
                  placeholder="Stream name"
                  style={stream.name?.trim() ? baseInputStyle : errorInputStyle}
                />
                <input
                  type="text"
                  value={stream.url}
                  onChange={(e) => updateStream(stream.id, "url", e.target.value)}
                  placeholder="rtsp://..."
                  style={
                    stream.url?.trim() && isValidRtspUrl(stream.url)
                      ? baseInputStyle
                      : errorInputStyle
                  }
                />
                <select
                  value={stream.floorId}
                  onChange={(e) =>
                    updateStream(stream.id, "floorId", e.target.value)
                  }
                  style={
                    stream.floorId ? baseInputStyle : errorInputStyle
                  }
                >
                  <option value="">Select floor</option>
                  {floors.map((floor) => (
                    <option key={floor.id} value={floor.id}>
                      {floor.name || floor.id}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => removeStream(stream.id)}
                  style={{
                    padding: "6px 10px",
                    backgroundColor: "#f44336",
                    color: "white",
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
