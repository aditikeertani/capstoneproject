import React, { useState, useRef, useEffect } from "react";
import { submitFloorplanWithSeats } from "../api";

export default function FloorplanDesigner() {
  const [image, setImage] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [seats, setSeats] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState(null);
  const [currentBox, setCurrentBox] = useState(null);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [seatLabel, setSeatLabel] = useState("");
  const [scale, setScale] = useState(1);
  const [originalDimensions, setOriginalDimensions] = useState({ width: 0, height: 0 });
  const [streamUrl, setStreamUrl] = useState("");
  const [streamName, setStreamName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // Handle image upload
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImage(file);
      const url = URL.createObjectURL(file);
      setImageUrl(url);
      setSeats([]);
    }
  };

  // Get mouse position relative to canvas (scaled)
  const getMousePos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale
    };
  };

  // Start drawing a box
  const handleMouseDown = (e) => {
    if (!imageUrl) return;
    const pos = getMousePos(e);
    setIsDrawing(true);
    setStartPoint(pos);
    setCurrentBox({ x: pos.x, y: pos.y, width: 0, height: 0 });
  };

  // Update box while drawing
  const handleMouseMove = (e) => {
    if (!isDrawing || !startPoint) return;
    const pos = getMousePos(e);
    setCurrentBox({
      x: Math.min(startPoint.x, pos.x),
      y: Math.min(startPoint.y, pos.y),
      width: Math.abs(pos.x - startPoint.x),
      height: Math.abs(pos.y - startPoint.y)
    });
  };

  // Finish drawing a box
  const handleMouseUp = () => {
    if (!isDrawing || !currentBox) return;
    
    // Only add if box is large enough (scaled threshold)
    if (currentBox.width > 20 && currentBox.height > 20) {
      const newSeat = {
        id: `seat_${Date.now()}`,
        ...currentBox,
        label: `Seat ${seats.length + 1}`
      };
      setSeats([...seats, newSeat]);
      setSelectedSeat(newSeat.id);
      setSeatLabel(newSeat.label);
    }
    
    setIsDrawing(false);
    setStartPoint(null);
    setCurrentBox(null);
  };

  // Calculate scale and draw on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    
    const ctx = canvas.getContext("2d");
    
    if (imageUrl) {
      const img = new Image();
      img.src = imageUrl;
      img.onload = () => {
        // Store original dimensions
        setOriginalDimensions({ width: img.width, height: img.height });
        
        // Calculate scale to fit container
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;
        const scaleX = containerWidth / img.width;
        const scaleY = containerHeight / img.height;
        const newScale = Math.min(scaleX, scaleY, 1); // Don't scale up
        setScale(newScale);
        
        // Set canvas size to scaled dimensions
        canvas.width = img.width * newScale;
        canvas.height = img.height * newScale;
        
        // Draw scaled image
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        // Draw existing seats (scaled)
        seats.forEach((seat) => {
          const sx = seat.x * newScale;
          const sy = seat.y * newScale;
          const sw = seat.width * newScale;
          const sh = seat.height * newScale;
          
          ctx.strokeStyle = selectedSeat === seat.id ? "#2196F3" : "#4CAF50";
          ctx.lineWidth = selectedSeat === seat.id ? 3 : 2;
          ctx.strokeRect(sx, sy, sw, sh);
          
          ctx.fillStyle = selectedSeat === seat.id ? "rgba(33, 150, 243, 0.2)" : "rgba(76, 175, 80, 0.2)";
          ctx.fillRect(sx, sy, sw, sh);
          
          ctx.fillStyle = "#000";
          ctx.font = `${Math.max(12, 14 * newScale)}px Arial`;
          ctx.fillText(seat.label, sx + 5, sy + 18);
        });
        
        // Draw current box being drawn (scaled)
        if (currentBox) {
          ctx.strokeStyle = "#FF5722";
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.strokeRect(
            currentBox.x * newScale, 
            currentBox.y * newScale, 
            currentBox.width * newScale, 
            currentBox.height * newScale
          );
          ctx.setLineDash([]);
        }
      };
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [imageUrl, seats, currentBox, selectedSeat]);

  // Update seat label
  const updateSeatLabel = () => {
    if (!selectedSeat) return;
    setSeats(seats.map(s => 
      s.id === selectedSeat ? { ...s, label: seatLabel } : s
    ));
  };

  // Delete selected seat
  const deleteSeat = () => {
    if (!selectedSeat) return;
    setSeats(seats.filter(s => s.id !== selectedSeat));
    setSelectedSeat(null);
    setSeatLabel("");
  };

  // Select a seat when clicked
  const handleCanvasClick = (e) => {
    if (isDrawing) return;
    const pos = getMousePos(e);
    
    const clickedSeat = seats.find(seat => 
      pos.x >= seat.x && pos.x <= seat.x + seat.width &&
      pos.y >= seat.y && pos.y <= seat.y + seat.height
    );
    
    if (clickedSeat) {
      setSelectedSeat(clickedSeat.id);
      setSeatLabel(clickedSeat.label);
    } else {
      setSelectedSeat(null);
      setSeatLabel("");
    }
  };

  // Submit floorplan with seats to database
  const handleSubmit = async () => {
    if (!image || seats.length === 0 || !streamUrl) {
      alert("Please upload an image, draw at least one seat, and enter a stream URL");
      return;
    }
    
    setIsSubmitting(true);
    setSubmitResult(null);
    
    try {
      const seatsData = seats.map(({ id, x, y, width, height, label }) => ({
        id,
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
        label
      }));
      
      const result = await submitFloorplanWithSeats(
        image,
        seatsData,
        streamUrl,
        streamName,
        originalDimensions.width,
        originalDimensions.height
      );
      
      setSubmitResult({ success: true, data: result });
      console.log("Submitted successfully:", result);
    } catch (error) {
      setSubmitResult({ success: false, error: error.message });
      console.error("Submit failed:", error);
    }
    
    setIsSubmitting(false);
  };

  return (
    <div style={{ 
      height: "calc(100vh - 120px)", 
      overflow: "hidden",
      display: "flex",
      flexDirection: "column"
    }}>
      {/* Header */}
      <div style={{ 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "center",
        marginBottom: 10,
        flexShrink: 0
      }}>
        <h2 style={{ margin: 0 }}>Floorplan Designer</h2>
        <div>
          <label 
            htmlFor="floorplan-upload"
            style={{
              display: "inline-block",
              padding: "8px 16px",
              backgroundColor: "#2196F3",
              color: "white",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 14
            }}
          >
            Upload Floorplan
          </label>
          <input
            id="floorplan-upload"
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            style={{ display: "none" }}
          />
          {image && <span style={{ marginLeft: 10, fontSize: 14 }}>{image.name}</span>}
        </div>
      </div>

      {/* Main Content */}
      <div style={{ display: "flex", gap: 15, flex: 1, minHeight: 0 }}>
        {/* Canvas Area */}
        <div 
          ref={containerRef}
          style={{ 
            flex: 1,
            border: "2px dashed #ccc", 
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#fafafa",
            overflow: "hidden"
          }}
        >
          {!imageUrl ? (
            <div style={{ color: "#999", textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 10 }}>📐</div>
              <div>Upload a floorplan image to get started</div>
              <div style={{ fontSize: 12, marginTop: 5 }}>Click and drag to draw seating areas</div>
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onClick={handleCanvasClick}
              style={{ cursor: isDrawing ? "crosshair" : "default" }}
            />
          )}
        </div>

        {/* Controls Panel */}
        <div style={{ 
          width: 260, 
          padding: 12, 
          backgroundColor: "#f5f5f5", 
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          flexShrink: 0
        }}>
          <h3 style={{ margin: "0 0 10px 0", fontSize: 16 }}>Seating Areas ({seats.length})</h3>
          
          {/* Seat List */}
          <div style={{ 
            flex: 1,
            overflowY: "auto", 
            marginBottom: 10,
            border: "1px solid #ddd",
            borderRadius: 4,
            backgroundColor: "white",
            minHeight: 100
          }}>
            {seats.length === 0 ? (
              <div style={{ padding: 10, color: "#999", textAlign: "center", fontSize: 13 }}>
                No seats defined yet
              </div>
            ) : (
              seats.map(seat => (
                <div
                  key={seat.id}
                  onClick={() => {
                    setSelectedSeat(seat.id);
                    setSeatLabel(seat.label);
                  }}
                  style={{
                    padding: "6px 8px",
                    borderBottom: "1px solid #eee",
                    cursor: "pointer",
                    backgroundColor: selectedSeat === seat.id ? "#e3f2fd" : "white",
                    fontSize: 13
                  }}
                >
                  <strong>{seat.label}</strong>
                  <div style={{ fontSize: 11, color: "#666" }}>
                    {Math.round(seat.width)}x{Math.round(seat.height)} at ({Math.round(seat.x)}, {Math.round(seat.y)})
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Edit Selected Seat */}
          {selectedSeat && (
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: "block", marginBottom: 4, fontWeight: "bold", fontSize: 13 }}>
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
                  border: "1px solid #ddd",
                  borderRadius: 4,
                  boxSizing: "border-box",
                  fontSize: 13
                }}
              />
              <button
                onClick={deleteSeat}
                style={{
                  marginTop: 8,
                  width: "100%",
                  padding: 6,
                  backgroundColor: "#f44336",
                  color: "white",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: 13
                }}
              >
                Delete Seat
              </button>
            </div>
          )}

          {/* Stream Configuration */}
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: "block", marginBottom: 4, fontWeight: "bold", fontSize: 13 }}>
              Stream URL *
            </label>
            <input
              type="text"
              value={streamUrl}
              onChange={(e) => setStreamUrl(e.target.value)}
              placeholder="rtsp://localhost:8554/0.sdp"
              style={{
                width: "100%",
                padding: 6,
                border: "1px solid #ddd",
                borderRadius: 4,
                boxSizing: "border-box",
                fontSize: 12
              }}
            />
          </div>
          
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: "block", marginBottom: 4, fontWeight: "bold", fontSize: 13 }}>
              Stream Name
            </label>
            <input
              type="text"
              value={streamName}
              onChange={(e) => setStreamName(e.target.value)}
              placeholder="Lobby Camera"
              style={{
                width: "100%",
                padding: 6,
                border: "1px solid #ddd",
                borderRadius: 4,
                boxSizing: "border-box",
                fontSize: 12
              }}
            />
          </div>

          {/* Submit Result */}
          {submitResult && (
            <div style={{
              padding: 8,
              marginBottom: 10,
              borderRadius: 4,
              fontSize: 12,
              backgroundColor: submitResult.success ? "#e8f5e9" : "#ffebee",
              color: submitResult.success ? "#2e7d32" : "#c62828"
            }}>
              {submitResult.success 
                ? `✓ Saved! Stream ID: ${submitResult.data.stream_id}`
                : `✗ ${submitResult.error}`
              }
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ flexShrink: 0 }}>
            <button
              onClick={handleSubmit}
              disabled={!image || seats.length === 0 || !streamUrl || isSubmitting}
              style={{
                width: "100%",
                padding: 10,
                backgroundColor: (!image || seats.length === 0 || !streamUrl || isSubmitting) ? "#ccc" : "#4CAF50",
                color: "white",
                border: "none",
                borderRadius: 4,
                cursor: (!image || seats.length === 0 || !streamUrl || isSubmitting) ? "not-allowed" : "pointer",
                fontSize: 14,
                fontWeight: "bold"
              }}
            >
              {isSubmitting ? "Submitting..." : "Submit"}
            </button>

            <button
              onClick={() => {
                setSeats([]);
                setSelectedSeat(null);
                setSubmitResult(null);
              }}
              disabled={seats.length === 0}
              style={{
                marginTop: 8,
                width: "100%",
                padding: 8,
                backgroundColor: seats.length > 0 ? "#ff9800" : "#ccc",
                color: "white",
                border: "none",
                borderRadius: 4,
                cursor: seats.length > 0 ? "pointer" : "not-allowed",
                fontSize: 13
              }}
            >
              Clear All
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
