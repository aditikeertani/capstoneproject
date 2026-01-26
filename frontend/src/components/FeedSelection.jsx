import React, { useState, useRef, useEffect } from "react";
import { getStreams, getStreamFrame, saveSeatMappings } from "../api";

export default function FeedSelection() {
  const [streams, setStreams] = useState([]);
  const [selectedStreamId, setSelectedStreamId] = useState("");
  const [frameData, setFrameData] = useState(null);
  const [seats, setSeats] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState(null);
  const [currentBox, setCurrentBox] = useState(null);
  const [selectedSeatId, setSelectedSeatId] = useState(null);
  const [seatMappings, setSeatMappings] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  const [error, setError] = useState("");
  const [scale, setScale] = useState(1);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const imageRef = useRef(null);

  // Load available streams on mount
  useEffect(() => {
    loadStreams();
  }, [selectedStreamId]);

  const loadStreams = async () => {
    try {
      const data = await getStreams();
      setStreams(data.streams || []);
      if (data.streams?.length > 0 && !selectedStreamId) {
        setSelectedStreamId(data.streams[0].id);
      }
    } catch (e) {
      console.error("Failed to load streams:", e);
    }
  };

  // Load frame when stream is selected
  const loadFrame = async () => {
    if (!selectedStreamId) return;
    
    setLoading(true);
    setError("");
    
    try {
      const data = await getStreamFrame(selectedStreamId);
      setFrameData(data);
      setSeats(data.seats || []);
      // Initialize mappings for seats that don't have one yet
      const newMappings = { ...seatMappings };
      (data.seats || []).forEach(seat => {
        if (!newMappings[seat.id]) {
          newMappings[seat.id] = null;
        }
      });
      setSeatMappings(newMappings);
    } catch (e) {
      setError("Failed to load frame: " + e.message);
    }
    
    setLoading(false);
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
    if (!frameData || !selectedSeatId) return;
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
    if (!isDrawing || !currentBox || !selectedSeatId) return;
    
    // Only save if box is large enough
    if (currentBox.width > 10 && currentBox.height > 10) {
      setSeatMappings(prev => ({
        ...prev,
        [selectedSeatId]: {
          x: Math.round(currentBox.x),
          y: Math.round(currentBox.y),
          width: Math.round(currentBox.width),
          height: Math.round(currentBox.height)
        }
      }));
    }
    
    setIsDrawing(false);
    setStartPoint(null);
    setCurrentBox(null);
  };

  // Draw on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !frameData) return;
    
    const ctx = canvas.getContext("2d");
    const img = imageRef.current;
    
    if (!img) return;
    
    img.onload = () => {
      // Calculate scale
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
      const scaleX = containerWidth / img.width;
      const scaleY = containerHeight / img.height;
      const newScale = Math.min(scaleX, scaleY, 1);
      setScale(newScale);
      
      canvas.width = img.width * newScale;
      canvas.height = img.height * newScale;
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // Draw existing mappings
      Object.entries(seatMappings).forEach(([seatId, mapping]) => {
        if (!mapping) return;
        
        const seat = seats.find(s => s.id === seatId);
        const isSelected = seatId === selectedSeatId;
        
        const sx = mapping.x * newScale;
        const sy = mapping.y * newScale;
        const sw = mapping.width * newScale;
        const sh = mapping.height * newScale;
        
        ctx.strokeStyle = isSelected ? "#2196F3" : "#4CAF50";
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.strokeRect(sx, sy, sw, sh);
        
        ctx.fillStyle = isSelected ? "rgba(33, 150, 243, 0.3)" : "rgba(76, 175, 80, 0.3)";
        ctx.fillRect(sx, sy, sw, sh);
        
        // Draw label
        if (seat) {
          ctx.fillStyle = "#fff";
          ctx.font = `bold ${Math.max(12, 14 * newScale)}px Arial`;
          ctx.fillText(seat.label, sx + 5, sy + 18);
        }
      });
      
      // Draw current box
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
    
    img.src = `data:image/jpeg;base64,${frameData.frame}`;
  }, [frameData, seatMappings, currentBox, selectedSeatId, seats]);

  // Save mappings to database
  const handleSaveMappings = async () => {
    if (!selectedStreamId) return;
    
    setSaving(true);
    setSaveResult(null);
    
    try {
      const result = await saveSeatMappings(selectedStreamId, seatMappings);
      setSaveResult({ success: true, data: result });
      console.log("Mappings saved:", result);
      
      // Update local seats with camera coordinates
      if (result.updated_seats) {
        setSeats(result.updated_seats);
      }
    } catch (e) {
      setSaveResult({ success: false, error: e.message });
      console.error("Failed to save mappings:", e);
    }
    
    setSaving(false);
  };

  const getSeatStatus = (seatId) => {
    if (seatMappings[seatId]) return "mapped";
    return "unmapped";
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
        <h2 style={{ margin: 0 }}>Feed Selection</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select
            value={selectedStreamId}
            onChange={(e) => setSelectedStreamId(e.target.value)}
            style={{ padding: 8, borderRadius: 4, border: "1px solid #ddd" }}
          >
            <option value="">Select a stream...</option>
            {streams.map(stream => (
              <option key={stream.id} value={stream.id}>
                {stream.name || stream.id}
              </option>
            ))}
          </select>
          <button
            onClick={loadFrame}
            disabled={!selectedStreamId || loading}
            style={{
              padding: "8px 16px",
              backgroundColor: selectedStreamId ? "#2196F3" : "#ccc",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: selectedStreamId ? "pointer" : "not-allowed"
            }}
          >
            {loading ? "Loading..." : "Load Frame"}
          </button>
          <button
            onClick={loadStreams}
            style={{
              padding: "8px 16px",
              backgroundColor: "#666",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: "pointer"
            }}
          >
            Refresh Streams
          </button>
        </div>
      </div>

      {error && (
        <div style={{ 
          padding: 10, 
          backgroundColor: "#ffebee", 
          color: "#c62828",
          borderRadius: 4,
          marginBottom: 10
        }}>
          {error}
        </div>
      )}

      {/* Instructions */}
      {!frameData && (
        <div style={{ 
          padding: 15, 
          backgroundColor: "#e3f2fd", 
          borderRadius: 4, 
          marginBottom: 10 
        }}>
          <strong>How to use:</strong>
          <ol style={{ margin: "5px 0 0 0", paddingLeft: 20 }}>
            <li>Select a stream from the dropdown (streams are created in Floorplan Designer)</li>
            <li>Click "Load Frame" to get a sample image from the camera</li>
            <li>Select a seat from the list on the right</li>
            <li>Draw a box on the camera frame to map where that seat appears</li>
          </ol>
        </div>
      )}

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
          {!frameData ? (
            <div style={{ color: "#999", textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 10 }}>📹</div>
              <div>Select a stream and load a frame</div>
            </div>
          ) : (
            <>
              <img 
                ref={imageRef}
                alt="Stream frame"
                style={{ display: "none" }}
              />
              <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                style={{ 
                  cursor: selectedSeatId ? "crosshair" : "default",
                  border: selectedSeatId ? "2px solid #2196F3" : "none"
                }}
              />
            </>
          )}
        </div>

        {/* Controls Panel */}
        <div style={{ 
          width: 280, 
          padding: 12, 
          backgroundColor: "#f5f5f5", 
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          flexShrink: 0
        }}>
          <h3 style={{ margin: "0 0 10px 0", fontSize: 16 }}>
            Seats to Map ({seats.filter(s => seatMappings[s.id]).length}/{seats.length})
          </h3>
          
          {!frameData ? (
            <div style={{ padding: 10, color: "#999", textAlign: "center" }}>
              Load a frame to see seats
            </div>
          ) : seats.length === 0 ? (
            <div style={{ padding: 10, color: "#999", textAlign: "center", fontSize: 13 }}>
              No seats defined for this stream. Go to Floorplan Designer first.
            </div>
          ) : (
            <>
              {/* Seat List */}
              <div style={{ 
                flex: 1,
                overflowY: "auto", 
                marginBottom: 10,
                border: "1px solid #ddd",
                borderRadius: 4,
                backgroundColor: "white"
              }}>
                {seats.map(seat => {
                  const status = getSeatStatus(seat.id);
                  const isSelected = selectedSeatId === seat.id;
                  
                  return (
                    <div
                      key={seat.id}
                      onClick={() => setSelectedSeatId(seat.id)}
                      style={{
                        padding: "8px 10px",
                        borderBottom: "1px solid #eee",
                        cursor: "pointer",
                        backgroundColor: isSelected ? "#e3f2fd" : "white",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center"
                      }}
                    >
                      <div>
                        <strong>{seat.label}</strong>
                        <div style={{ fontSize: 11, color: "#666" }}>
                          Floorplan: ({seat.x}, {seat.y})
                        </div>
                      </div>
                      <span style={{
                        fontSize: 11,
                        padding: "2px 6px",
                        borderRadius: 10,
                        backgroundColor: status === "mapped" ? "#c8e6c9" : "#ffecb3",
                        color: status === "mapped" ? "#2e7d32" : "#f57f17"
                      }}>
                        {status === "mapped" ? "✓ Mapped" : "Pending"}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Selected Seat Info */}
              {selectedSeatId && (
                <div style={{ 
                  padding: 10, 
                  backgroundColor: "#e3f2fd", 
                  borderRadius: 4,
                  marginBottom: 10,
                  fontSize: 13
                }}>
                  <strong>Selected:</strong> {seats.find(s => s.id === selectedSeatId)?.label}
                  <div style={{ marginTop: 5 }}>
                    Draw a box on the camera frame to map this seat
                  </div>
                  {seatMappings[selectedSeatId] && (
                    <button
                      onClick={() => setSeatMappings(prev => ({ ...prev, [selectedSeatId]: null }))}
                      style={{
                        marginTop: 8,
                        padding: "4px 8px",
                        backgroundColor: "#f44336",
                        color: "white",
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontSize: 12
                      }}
                    >
                      Clear Mapping
                    </button>
                  )}
                </div>
              )}

              {/* Save Result */}
              {saveResult && (
                <div style={{
                  padding: 8,
                  marginBottom: 10,
                  borderRadius: 4,
                  fontSize: 12,
                  backgroundColor: saveResult.success ? "#e8f5e9" : "#ffebee",
                  color: saveResult.success ? "#2e7d32" : "#c62828"
                }}>
                  {saveResult.success 
                    ? `✓ Saved ${saveResult.data.mappings_count} seat mappings!`
                    : `✗ ${saveResult.error}`
                  }
                </div>
              )}

              {/* Save Button */}
              <button
                onClick={handleSaveMappings}
                disabled={Object.values(seatMappings).every(v => !v) || saving}
                style={{
                  width: "100%",
                  padding: 10,
                  backgroundColor: (Object.values(seatMappings).some(v => v) && !saving) ? "#4CAF50" : "#ccc",
                  color: "white",
                  border: "none",
                  borderRadius: 4,
                  cursor: (Object.values(seatMappings).some(v => v) && !saving) ? "pointer" : "not-allowed",
                  fontSize: 14,
                  fontWeight: "bold"
                }}
              >
                {saving ? "Saving..." : "Save Mappings"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
