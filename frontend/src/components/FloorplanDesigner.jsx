import React, { useState, useRef, useEffect } from "react";
import { submitFloorplanWithSeats } from "../api";
import '../App.css'; // Or whatever your CSS file is named
export default function FloorplanDesigner({ onComplete }) {
  // Tools: 'select', 'rect', 'circle'
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
  const [streamUrl, setStreamUrl] = useState("");
  const [streamName, setStreamName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  
  const canvasRef = useRef(null);
  const HANDLE_SIZE = 10; // Size of the resize handle

  // --- RENDERING ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    
    // Clear canvas and draw a subtle grid for that "draw.io" feel
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.strokeStyle = "#f0f0f0";
    ctx.lineWidth = 1;
    for (let i = 0; i < canvas.width; i += 20) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, canvas.height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(canvas.width, i); ctx.stroke();
    }

    // Draw all saved shapes
    const allShapes = currentShape ? [...shapes, currentShape] : shapes;

    allShapes.forEach((shape) => {
      const isSelected = selectedShapeId === shape.id;
      
      ctx.beginPath();
      if (shape.type === "rect") {
        ctx.rect(shape.x, shape.y, shape.width, shape.height);
      } else if (shape.type === "circle") {
        // Draw ellipse inside the bounding box
        ctx.ellipse(
          shape.x + shape.width / 2, 
          shape.y + shape.height / 2, 
          Math.abs(shape.width / 2), 
          Math.abs(shape.height / 2), 
          0, 0, 2 * Math.PI
        );
      }

      ctx.fillStyle = isSelected ? "rgba(33, 150, 243, 0.2)" : "rgba(76, 175, 80, 0.2)";
      ctx.fill();
      ctx.strokeStyle = isSelected ? "#2196F3" : "#4CAF50";
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.stroke();

      // Draw label
      ctx.fillStyle = "#000";
      ctx.font = "14px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(shape.label || "", shape.x + shape.width / 2, shape.y + shape.height / 2);

      // Draw resize handle (Bottom-Right corner) if selected
      if (isSelected && tool === "select") {
        ctx.fillStyle = "#FF5722";
        ctx.fillRect(
          shape.x + shape.width - HANDLE_SIZE / 2, 
          shape.y + shape.height - HANDLE_SIZE / 2, 
          HANDLE_SIZE, HANDLE_SIZE
        );
      }
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

    if (tool === "rect" || tool === "circle") {
      setIsDrawing(true);
      setSelectedShapeId(null);
      setCurrentShape({
        id: `shape_${Date.now()}`,
        type: tool,
        x: pos.x, y: pos.y, width: 0, height: 0,
        label: `Seat ${shapes.length + 1}`
      });
      return;
    }

    if (tool === "select") {
      // Check if clicking resize handle of currently selected shape
      if (selectedShapeId) {
        const shape = shapes.find(s => s.id === selectedShapeId);
        if (shape) {
          const handleX = shape.x + shape.width - HANDLE_SIZE / 2;
          const handleY = shape.y + shape.height - HANDLE_SIZE / 2;
          if (pos.x >= handleX && pos.x <= handleX + HANDLE_SIZE &&
              pos.y >= handleY && pos.y <= handleY + HANDLE_SIZE) {
            setIsResizing(true);
            return;
          }
        }
      }

      // Check if clicking inside a shape to select/drag
      // Loop backwards to select top-most shape
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i];
        if (pos.x >= s.x && pos.x <= s.x + s.width && pos.y >= s.y && pos.y <= s.y + s.height) {
          setSelectedShapeId(s.id);
          setSeatLabel(s.label);
          setIsDragging(true);
          return;
        }
      }
      
      // Clicked empty space
      setSelectedShapeId(null);
    }
  };

  const handleMouseMove = (e) => {
    const pos = getMousePos(e);

    if (isDrawing && currentShape) {
      setCurrentShape({
        ...currentShape,
        width: pos.x - startPos.x,
        height: pos.y - startPos.y
      });
    } else if (isDragging && selectedShapeId) {
      const dx = pos.x - startPos.x;
      const dy = pos.y - startPos.y;
      setShapes(shapes.map(s => 
        s.id === selectedShapeId ? { ...s, x: s.x + dx, y: s.y + dy } : s
      ));
      setStartPos(pos); // reset start pos for continuous dragging
    } else if (isResizing && selectedShapeId) {
      const dx = pos.x - startPos.x;
      const dy = pos.y - startPos.y;
      setShapes(shapes.map(s => 
        s.id === selectedShapeId ? { ...s, width: Math.max(20, s.width + dx), height: Math.max(20, s.height + dy) } : s
      ));
      setStartPos(pos);
    }
  };

  const handleMouseUp = () => {
    if (isDrawing && currentShape) {
      // Ensure positive width/height
      const normalizedShape = {
        ...currentShape,
        x: currentShape.width < 0 ? currentShape.x + currentShape.width : currentShape.x,
        y: currentShape.height < 0 ? currentShape.y + currentShape.height : currentShape.y,
        width: Math.abs(currentShape.width),
        height: Math.abs(currentShape.height)
      };
      
      if (normalizedShape.width > 10 && normalizedShape.height > 10) {
        setShapes([...shapes, normalizedShape]);
        setSelectedShapeId(normalizedShape.id);
        setSeatLabel(normalizedShape.label);
        setTool("select"); // Auto-switch to select mode after drawing
      }
    }
    
    setIsDrawing(false);
    setIsDragging(false);
    setIsResizing(false);
    setCurrentShape(null);
  };

  // --- FORM ACTIONS ---
  const updateSeatLabel = () => {
    if (!selectedShapeId) return;
    setShapes(shapes.map(s => s.id === selectedShapeId ? { ...s, label: seatLabel } : s));
  };

  const deleteSeat = () => {
    setShapes(shapes.filter(s => s.id !== selectedShapeId));
    setSelectedShapeId(null);
  };

  const handleSubmit = async () => {
  if (shapes.length === 0 || !streamUrl) {
    alert("Please draw at least one seat and provide a Stream URL.");
    return;
  }
  setIsSubmitting(true);
  
    canvasRef.current.toBlob(async (blob) => {
      const imageFile = new File([blob], "custom_floorplan.png", { type: "image/png" });
      
      try {
        // This sends everything to the backend in one request
        const result = await submitFloorplanWithSeats(
          imageFile, 
          shapes, 
          streamUrl, 
          streamName, 
          canvasRef.current.width, 
          canvasRef.current.height
        );
        setSubmitResult({ success: true, data: result });
        setTimeout(() => onComplete(), 1000); 
      } catch (error) {
        setSubmitResult({ success: false, error: error.message });
      }
      setIsSubmitting(false);
    });
  };

  return (
    <div style={{ display: "flex", gap: "15px" }}>
      
      {/* Canvas Area */}
      <div style={{ flex: 1 }}>
        
        {/* Toolbar */}
        <div style={{ marginBottom: 10, display: "flex", gap: 10 }}>
          <button 
            onClick={() => setTool("select")}
            style={{ padding: "8px 12px", backgroundColor: tool === "select" ? "#2196F3" : "#eee", color: tool === "select" ? "white" : "black", border: "none", borderRadius: 4, cursor: "pointer" }}
            
          >
            👆 Select / Move
          </button>
          <button 
            onClick={() => setTool("rect")}
            style={{ padding: "8px 12px", backgroundColor: tool === "rect" ? "#2196F3" : "#eee", color: tool === "rect" ? "white" : "black", border: "none", borderRadius: 4, cursor: "pointer" }}
          >
            ⬜ Draw Rectangle
          </button>
          <button 
            onClick={() => setTool("circle")}
            style={{ padding: "8px 12px", backgroundColor: tool === "circle" ? "#2196F3" : "#eee", color: tool === "circle" ? "white" : "black", border: "none", borderRadius: 4, cursor: "pointer" }}
          >
            ◯ Draw Circle
          </button>
        </div>

        <div style={{ border: "2px solid #ccc", borderRadius: 8, overflow: "hidden", backgroundColor: "#fff" }}>
          <canvas
            ref={canvasRef}
            width={800}
            height={500}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ cursor: tool === "select" ? "default" : "crosshair", display: "block" }}
          />
        </div>
      </div>

      {/* Controls Panel */}
      <div style={{ width: 260, padding: 15, backgroundColor: "#f5f5f5", borderRadius: 8, display: "flex", flexDirection: "column" }}>
        <h3 style={{ marginTop: 0 }}>Seating Setup ({shapes.length})</h3>
        
        {selectedShapeId ? (
          <div style={{ marginBottom: 20, padding: 10, backgroundColor: "#e3f2fd", borderRadius: 4 }}>
            <label style={{ display: "block", marginBottom: 4, fontWeight: "bold", fontSize: 13 }}>Edit Label:</label>
            <input
              type="text"
              value={seatLabel}
              onChange={(e) => setSeatLabel(e.target.value)}
              onBlur={updateSeatLabel}
              onKeyDown={(e) => e.key === "Enter" && updateSeatLabel()}
              style={{ width: "100%", padding: 6, boxSizing: "border-box", marginBottom: 10 }}
              
            />
            <button onClick={deleteSeat} style={{ width: "100%", padding: 6, backgroundColor: "#f44336", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>
              Delete Selected
            </button>
          </div>
        ) : (
          <div style={{ marginBottom: 20, padding: 10, color: "#666", fontSize: 13, textAlign: "center", border: "1px dashed #ccc" }}>
            Select a shape to edit its label or delete it.
          </div>
        )}

        <div style={{ marginTop: "auto", borderTop: "1px solid #ddd", pt: 10 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: "bold" }}>Stream URL *</label>
          <input 
            type="text" 
            value={streamUrl} 
            onChange={(e) => setStreamUrl(e.target.value)} 
            placeholder="rtsp://..." 
            style={{ width: "100%", marginBottom: 10 }} 
          />
          <label style={{ display: "block", fontSize: 12, fontWeight: "bold" }}>Stream Name</label>
          <input 
            type="text" 
            value={streamName} 
            onChange={(e) => setStreamName(e.target.value)} 
            placeholder="Main Entrance" 
            style={{ width: "100%", marginBottom: 10 }} 
          />
        </div>
        
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", marginBottom: 4, fontWeight: "bold", fontSize: 13 }}>Stream Name</label>
          <input type="text" value={streamName} onChange={(e) => setStreamName(e.target.value)} placeholder="Main Floor" style={{ width: "100%", padding: 6, boxSizing: "border-box" }} />
        </div>

        {submitResult && (
          <div style={{ padding: 8, marginBottom: 10, borderRadius: 4, fontSize: 12, backgroundColor: submitResult.success ? "#e8f5e9" : "#ffebee", color: submitResult.success ? "#2e7d32" : "#c62828" }}>
            {submitResult.success ? "✓ Floorplan Saved!" : `✗ ${submitResult.error}`}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={shapes.length === 0 || !streamUrl || isSubmitting}
          style={{ width: "100%", padding: 10, backgroundColor: (shapes.length === 0 || !streamUrl || isSubmitting) ? "#ccc" : "#4CAF50", color: "white", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: "bold" }}
        >
          {isSubmitting ? "Generating..." : "Save Custom Floorplan"}
        </button>
      </div>
    </div>
  );
}