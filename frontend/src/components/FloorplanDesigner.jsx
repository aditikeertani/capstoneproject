import React, { useState, useRef, useEffect } from "react";
import { submitFloorplanWithSeats } from "../api";

export default function FloorplanDesigner({
  floors = [],
  streams = [],
  floorplanDrafts = {},
  setFloorplanDrafts,
  savedFloorplans = [],
  setSavedFloorplans,
}) {
  const [selectedFloorId, setSelectedFloorId] = useState("");
  const [selectedStreamId, setSelectedStreamId] = useState("");

  // Tools: 'select', 'rect', 'circle', 'entrance'
  const [tool, setTool] = useState("rect");
  const [shapes, setShapes] = useState([]);
  const [selectedShapeId, setSelectedShapeId] = useState(null);

  // Interaction states
  const [isDrawing, setIsDrawing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentShape, setCurrentShape] = useState(null);

  // Form states
  const [seatLabel, setSeatLabel] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);

  const canvasRef = useRef(null);
  const HANDLE_SIZE = 10;

  const selectedFloor = floors.find((floor) => floor.id === selectedFloorId);
  const assignedStreams = streams.filter(
    (stream) => stream.floorId === selectedFloorId
  );
  const selectedStream = assignedStreams.find(
    (stream) => stream.id === selectedStreamId
  );
  const savedForSelectedFloor = savedFloorplans.find(
    (floorplan) => floorplan.floorId === selectedFloorId
  );

  useEffect(() => {
    if (floors.length === 0) {
      setSelectedFloorId("");
      return;
    }

    const hasSelected = floors.some((floor) => floor.id === selectedFloorId);
    if (!selectedFloorId || !hasSelected) {
      setSelectedFloorId(floors[0].id);
    }
  }, [floors, selectedFloorId]);

  useEffect(() => {
    if (!selectedFloorId) {
      setShapes([]);
      setSelectedStreamId("");
      setSelectedShapeId(null);
      setSeatLabel("");
      return;
    }

    const draft = floorplanDrafts[selectedFloorId];
    setShapes(draft?.shapes || []);
    setSelectedStreamId(draft?.streamId || "");
    setSelectedShapeId(null);
    setSeatLabel("");
  }, [selectedFloorId]);

  useEffect(() => {
    if (!selectedFloorId) return;
    if (assignedStreams.length === 0) {
      if (selectedStreamId) setSelectedStreamId("");
      return;
    }
    const exists = assignedStreams.some(
      (stream) => stream.id === selectedStreamId
    );
    if (!exists) {
      setSelectedStreamId(assignedStreams[0].id);
    }
  }, [assignedStreams, selectedFloorId, selectedStreamId]);

  useEffect(() => {
    if (!selectedFloorId || !setFloorplanDrafts) return;
    setFloorplanDrafts((prev) => ({
      ...prev,
      [selectedFloorId]: {
        ...(prev[selectedFloorId] || {}),
        shapes,
        streamId: selectedStreamId,
      },
    }));
  }, [selectedFloorId, shapes, selectedStreamId, setFloorplanDrafts]);

  const renderFloorplan = ({
    ctx,
    shapesToRender,
    currentShapeToRender,
    selectedId,
    activeTool,
    includeLabels,
    includeSelection,
  }) => {
    if (!ctx) return;

    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "#f0f0f0";
    ctx.lineWidth = 1;
    for (let i = 0; i < canvas.width; i += 20) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, canvas.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(canvas.width, i);
      ctx.stroke();
    }

    const allShapes = currentShapeToRender
      ? [...shapesToRender, currentShapeToRender]
      : shapesToRender;

    allShapes.forEach((shape) => {
      const isSelected = selectedId === shape.id;

      ctx.beginPath();
      if (shape.type === "rect") {
        ctx.rect(shape.x, shape.y, shape.width, shape.height);
      } else if (shape.type === "circle") {
        ctx.ellipse(
          shape.x + shape.width / 2,
          shape.y + shape.height / 2,
          Math.abs(shape.width / 2),
          Math.abs(shape.height / 2),
          0,
          0,
          2 * Math.PI
        );
      } else if (shape.type === "entrance") {
        const isHorizontal = Math.abs(shape.width) >= Math.abs(shape.height);
        const barThickness = 10;
        const lineThickness = 4;

        ctx.fillStyle = isSelected ? "#2196F3" : "#333";
        if (isHorizontal) {
          ctx.fillRect(shape.x, shape.y, barThickness, shape.height);
          ctx.fillRect(
            shape.x + shape.width - barThickness,
            shape.y,
            barThickness,
            shape.height
          );
          ctx.fillRect(
            shape.x,
            shape.y + shape.height / 2 - lineThickness / 2,
            shape.width,
            lineThickness
          );
        } else {
          ctx.fillRect(shape.x, shape.y, shape.width, barThickness);
          ctx.fillRect(
            shape.x,
            shape.y + shape.height - barThickness,
            shape.width,
            barThickness
          );
          ctx.fillRect(
            shape.x + shape.width / 2 - lineThickness / 2,
            shape.y,
            lineThickness,
            shape.height
          );
        }

        if (includeLabels) {
          ctx.fillStyle = "#333";
          ctx.font = "bold 14px Arial";
          ctx.textAlign = "center";
          ctx.fillText(shape.label || "", shape.x + shape.width / 2, shape.y - 10);
        }
      }

      // Fill/Stroke for standard shapes (skipped for custom entrance bars)
      if (shape.type !== "entrance") {
        ctx.fillStyle = isSelected
          ? "rgba(33, 150, 243, 0.2)"
          : "rgba(76, 175, 80, 0.2)";
        ctx.fill();
        ctx.strokeStyle = isSelected ? "#2196F3" : "#4CAF50";
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.stroke();
        if (includeLabels) {
          ctx.fillStyle = "#000";
          ctx.font = "14px Arial";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(
            shape.label || "",
            shape.x + shape.width / 2,
            shape.y + shape.height / 2
          );
        }
      }

      if (includeSelection && isSelected && activeTool === "select") {
        ctx.fillStyle = "#FF5722";
        ctx.fillRect(
          shape.x + shape.width - HANDLE_SIZE / 2,
          shape.y + shape.height - HANDLE_SIZE / 2,
          HANDLE_SIZE,
          HANDLE_SIZE
        );
      }
    });
  };

  // --- RENDERING ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    renderFloorplan({
      ctx,
      shapesToRender: shapes,
      currentShapeToRender: currentShape,
      selectedId: selectedShapeId,
      activeTool: tool,
      includeLabels: true,
      includeSelection: true,
    });
  }, [shapes, currentShape, selectedShapeId, tool]);

  // --- INTERACTION LOGIC ---
  const getMousePos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleMouseDown = (e) => {
    const pos = getMousePos(e);
    setStartPos(pos);

    if (["rect", "circle", "entrance"].includes(tool)) {
      setIsDrawing(true);
      setSelectedShapeId(null);
      setCurrentShape({
        id: `shape_${Date.now()}`,
        type: tool,
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        label:
          tool === "entrance"
            ? `Entrance ${shapes.filter((s) => s.type === "entrance").length + 1}`
            : `Seat ${shapes.length + 1}`,
      });
      return;
    }

    if (tool === "select") {
      if (selectedShapeId) {
        const shape = shapes.find((s) => s.id === selectedShapeId);
        if (shape) {
          const handleX = shape.x + shape.width - HANDLE_SIZE / 2;
          const handleY = shape.y + shape.height - HANDLE_SIZE / 2;
          if (
            pos.x >= handleX &&
            pos.x <= handleX + HANDLE_SIZE &&
            pos.y >= handleY &&
            pos.y <= handleY + HANDLE_SIZE
          ) {
            setIsResizing(true);
            return;
          }
        }
      }

      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i];
        if (
          pos.x >= s.x &&
          pos.x <= s.x + s.width &&
          pos.y >= s.y &&
          pos.y <= s.y + s.height
        ) {
          setSelectedShapeId(s.id);
          setSeatLabel(s.label);
          setIsDragging(true);
          return;
        }
      }
      setSelectedShapeId(null);
    }
  };

  const handleMouseMove = (e) => {
    const pos = getMousePos(e);

    if (isDrawing && currentShape) {
      setCurrentShape({
        ...currentShape,
        width: pos.x - startPos.x,
        height: pos.y - startPos.y,
      });
    } else if (isDragging && selectedShapeId) {
      const dx = pos.x - startPos.x;
      const dy = pos.y - startPos.y;
      setShapes(
        shapes.map((s) =>
          s.id === selectedShapeId ? { ...s, x: s.x + dx, y: s.y + dy } : s
        )
      );
      setStartPos(pos);
    } else if (isResizing && selectedShapeId) {
      const dx = pos.x - startPos.x;
      const dy = pos.y - startPos.y;
      setShapes(
        shapes.map((s) =>
          s.id === selectedShapeId
            ? {
                ...s,
                width: Math.max(20, s.width + dx),
                height: Math.max(20, s.height + dy),
              }
            : s
        )
      );
      setStartPos(pos);
    }
  };

  const handleMouseUp = () => {
    if (isDrawing && currentShape) {
      const normalizedShape = {
        ...currentShape,
        x:
          currentShape.width < 0
            ? currentShape.x + currentShape.width
            : currentShape.x,
        y:
          currentShape.height < 0
            ? currentShape.y + currentShape.height
            : currentShape.y,
        width: Math.abs(currentShape.width),
        height: Math.abs(currentShape.height),
      };

      if (normalizedShape.width > 10 && normalizedShape.height > 10) {
        setShapes([...shapes, normalizedShape]);
        setSelectedShapeId(normalizedShape.id);
        setSeatLabel(normalizedShape.label);
        setTool("select");
      }
    }

    setIsDrawing(false);
    setIsDragging(false);
    setIsResizing(false);
    setCurrentShape(null);
  };

  const updateSeatLabel = () => {
    if (!selectedShapeId) return;
    setShapes(
      shapes.map((s) =>
        s.id === selectedShapeId ? { ...s, label: seatLabel } : s
      )
    );
  };

  const deleteSeat = () => {
    setShapes(shapes.filter((s) => s.id !== selectedShapeId));
    setSelectedShapeId(null);
  };

  const handleDeleteSavedFloorplan = () => {
    if (!selectedFloorId || !setSavedFloorplans) return;
    setSavedFloorplans((prev) =>
      prev.filter((floorplan) => floorplan.floorId !== selectedFloorId)
    );
    setSubmitResult(null);
  };

  const handleSubmit = async () => {
    if (!selectedFloorId) {
      alert("Please select a floor before saving.");
      return;
    }
    if (shapes.length === 0) {
      alert("Please draw at least one shape before saving.");
      return;
    }
    if (assignedStreams.length === 0) {
      alert("Please assign a stream to this floor in Step 1.");
      return;
    }
    const chosenStream = selectedStream || assignedStreams[0];
    if (!chosenStream) {
      alert("No stream available for this floor.");
      return;
    }

    setIsSubmitting(true);

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvasRef.current.width;
    exportCanvas.height = canvasRef.current.height;
    const exportCtx = exportCanvas.getContext("2d");
    renderFloorplan({
      ctx: exportCtx,
      shapesToRender: shapes,
      currentShapeToRender: null,
      selectedId: null,
      activeTool: tool,
      includeLabels: false, // remove labels from exported floorplan
      includeSelection: false,
    });

    const previewUrl = exportCanvas.toDataURL("image/png");

    exportCanvas.toBlob(async (blob) => {
      const imageFile = new File([blob], "custom_floorplan.png", {
        type: "image/png",
      });
      try {
        const streamName =
          chosenStream?.name || chosenStream?.id || "Unnamed Stream";
        const result = await submitFloorplanWithSeats(
          imageFile,
          shapes,
          chosenStream?.url,
          streamName,
          canvasRef.current.width,
          canvasRef.current.height
        );
        setSubmitResult({ success: true, data: result });
        if (setSavedFloorplans) {
          setSavedFloorplans((prev) => {
            const next = prev.filter(
              (floorplan) => floorplan.floorId !== selectedFloorId
            );
            return [
              ...next,
              {
                id: result?.id || `saved_${Date.now()}`,
                floorId: selectedFloorId,
                floorName: selectedFloor?.name || selectedFloorId,
                streamId: chosenStream?.id,
                streamName: streamName,
                previewUrl,
                savedAt: new Date().toISOString(),
              },
            ];
          });
        }
      } catch (error) {
        setSubmitResult({ success: false, error: error.message });
      }
      setIsSubmitting(false);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <label style={{ fontWeight: "bold" }}>Floor</label>
          <select
            value={selectedFloorId}
            onChange={(e) => setSelectedFloorId(e.target.value)}
            style={{ padding: 8, borderRadius: 4, border: "1px solid #ddd" }}
          >
            <option value="">Select a floor...</option>
            {floors.map((floor) => (
              <option key={floor.id} value={floor.id}>
                {floor.name || floor.id}
              </option>
            ))}
          </select>
        </div>
        {selectedFloorId && assignedStreams.length === 0 && (
          <div style={{ color: "#b00020", fontSize: 13 }}>
            No streams assigned to this floor. Add or assign one in Step 1.
          </div>
        )}
      </div>

      {!selectedFloorId ? (
        <div
          style={{
            padding: 20,
            border: "1px dashed #ccc",
            borderRadius: 8,
            textAlign: "center",
            color: "#666",
          }}
        >
          Select a floor to start designing its floorplan.
        </div>
      ) : (
        <div style={{ display: "flex", gap: "15px" }}>
          <div style={{ flex: 1 }}>
            <div style={{ marginBottom: 10, display: "flex", gap: 10 }}>
              <button
                onClick={() => setTool("select")}
                style={{
                  padding: "8px 12px",
                  backgroundColor: tool === "select" ? "#2196F3" : "#eee",
                  color: tool === "select" ? "white" : "black",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                Select
              </button>
              <button
                onClick={() => setTool("rect")}
                style={{
                  padding: "8px 12px",
                  backgroundColor: tool === "rect" ? "#4CAF50" : "#eee",
                  color: tool === "rect" ? "white" : "black",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                Seat (Rect)
              </button>
              <button
                onClick={() => setTool("circle")}
                style={{
                  padding: "8px 12px",
                  backgroundColor: tool === "circle" ? "#4CAF50" : "#eee",
                  color: tool === "circle" ? "white" : "black",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                Seat (Circle)
              </button>
              <button
                onClick={() => setTool("entrance")}
                style={{
                  padding: "8px 12px",
                  backgroundColor: tool === "entrance" ? "#333" : "#eee",
                  color: tool === "entrance" ? "white" : "black",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                Entrance
              </button>
            </div>

            <div
              style={{
                border: "2px solid #ccc",
                borderRadius: 8,
                overflow: "hidden",
                backgroundColor: "#fff",
              }}
            >
              <canvas
                ref={canvasRef}
                width={800}
                height={500}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                style={{
                  cursor: tool === "select" ? "default" : "crosshair",
                  display: "block",
                }}
              />
            </div>
          </div>

          <div
            style={{
              width: 280,
              padding: 15,
              backgroundColor: "#f5f5f5",
              borderRadius: 8,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <h3 style={{ marginTop: 0 }}>
              Design Elements ({shapes.length})
            </h3>

            {selectedShapeId ? (
              <div
                style={{
                  marginBottom: 20,
                  padding: 10,
                  backgroundColor: "#e3f2fd",
                  borderRadius: 4,
                }}
              >
                <label
                  style={{
                    display: "block",
                    marginBottom: 4,
                    fontWeight: "bold",
                    fontSize: 13,
                  }}
                >
                  Edit Label:
                </label>
                <input
                  type="text"
                  value={seatLabel}
                  onChange={(e) => setSeatLabel(e.target.value)}
                  onBlur={updateSeatLabel}
                  onKeyDown={(e) => e.key === "Enter" && updateSeatLabel()}
                  style={{
                    width: "100%",
                    padding: 6,
                    boxSizing: "border-box",
                    marginBottom: 10,
                  }}
                />
                <button
                  onClick={deleteSeat}
                  style={{
                    width: "100%",
                    padding: 6,
                    backgroundColor: "#f44336",
                    color: "white",
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                >
                  Delete Selected
                </button>
              </div>
            ) : (
              <div
                style={{
                  marginBottom: 20,
                  padding: 10,
                  color: "#666",
                  fontSize: 13,
                  textAlign: "center",
                  border: "1px dashed #ccc",
                }}
              >
                Select a shape to edit its label or delete it.
              </div>
            )}

            {assignedStreams.length === 0 && (
              <div style={{ marginBottom: 12, fontSize: 12, color: "#b00020" }}>
                No stream assigned. Add one in Step 1.
              </div>
            )}

            {savedForSelectedFloor && (
              <button
                onClick={handleDeleteSavedFloorplan}
                style={{
                  width: "100%",
                  padding: 8,
                  marginBottom: 10,
                  backgroundColor: "#f44336",
                  color: "white",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                Delete Saved Floorplan Image
              </button>
            )}

            {submitResult && (
              <div
                style={{
                  padding: 8,
                  marginBottom: 10,
                  borderRadius: 4,
                  fontSize: 12,
                  backgroundColor: submitResult.success
                    ? "#e8f5e9"
                    : "#ffebee",
                  color: submitResult.success ? "#2e7d32" : "#c62828",
                }}
              >
                {submitResult.success
                  ? "Design saved."
                  : `Error: ${submitResult.error}`}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={
                shapes.length === 0 ||
                assignedStreams.length === 0 ||
                isSubmitting
              }
              style={{
                width: "100%",
                padding: 10,
                backgroundColor:
                  shapes.length === 0 ||
                  assignedStreams.length === 0 ||
                  isSubmitting
                    ? "#ccc"
                    : "#4CAF50",
                color: "white",
                border: "none",
                borderRadius: 4,
                cursor:
                  shapes.length === 0 ||
                  assignedStreams.length === 0 ||
                  isSubmitting
                    ? "not-allowed"
                    : "pointer",
                fontWeight: "bold",
              }}
            >
              {isSubmitting ? "Saving..." : "Save Custom Floorplan"}
            </button>
          </div>
        </div>
      )}

      <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 8 }}>
        <h3 style={{ marginTop: 0 }}>Saved Floorplans</h3>
        {savedFloorplans.length === 0 ? (
          <div style={{ color: "#666", fontSize: 13 }}>
            No saved floorplans yet.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: 12,
            }}
          >
            {savedFloorplans.map((floorplan) => (
              <div
                key={floorplan.id}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 6,
                  padding: 8,
                  backgroundColor: "white",
                }}
              >
                {floorplan.previewUrl ? (
                  <img
                    src={floorplan.previewUrl}
                    alt={`${floorplan.floorName} floorplan`}
                    style={{
                      width: "100%",
                      height: 100,
                      objectFit: "cover",
                      borderRadius: 4,
                      border: "1px solid #eee",
                      marginBottom: 8,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      height: 100,
                      border: "1px dashed #ccc",
                      borderRadius: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#999",
                      marginBottom: 8,
                    }}
                  >
                    No preview
                  </div>
                )}
                <div style={{ fontWeight: "bold", fontSize: 13 }}>
                  {floorplan.floorName || floorplan.floorId}
                </div>
                <div style={{ fontSize: 12, color: "#666" }}>
                  Stream: {floorplan.streamName || floorplan.streamId}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button
                    onClick={() => setSelectedFloorId(floorplan.floorId)}
                    style={{
                      flex: 1,
                      padding: "6px 8px",
                      backgroundColor: "#2196F3",
                      color: "white",
                      border: "none",
                      borderRadius: 4,
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    Open
                  </button>
                  <button
                    onClick={() =>
                      setSavedFloorplans((prev) =>
                        prev.filter((item) => item.id !== floorplan.id)
                      )
                    }
                    style={{
                      flex: 1,
                      padding: "6px 8px",
                      backgroundColor: "#f44336",
                      color: "white",
                      border: "none",
                      borderRadius: 4,
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
