import React, { useState, useRef, useEffect } from "react";
import { submitFloorplanWithSeats, autoGenerateFloorplan } from "../api";

export default function FloorplanDesigner({
  floors = [],
  streams = [],
  floorplanDrafts = {},
  setFloorplanDrafts,
  savedFloorplans = [],
  setSavedFloorplans,
  setupKey = 0,
  onBack,
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
  const [isPanning, setIsPanning] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentShape, setCurrentShape] = useState(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [panOrigin, setPanOrigin] = useState({ x: 0, y: 0 });

  // Form states
  const [seatLabel, setSeatLabel] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [showAutoGenModal, setShowAutoGenModal] = useState(false);
  const [autoGenLoading, setAutoGenLoading] = useState(false);
  const [autoGenStatus, setAutoGenStatus] = useState(null);
  const [trackingMode, setTrackingMode] = useState("tables");
  const [zoom, setZoom] = useState(1);
  const [backdropImg, setBackdropImg] = useState(null);

  const canvasRef = useRef(null);
  const HANDLE_SIZE = 10;
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 3;
  const ZOOM_STEP = 0.25;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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
  const hasSubmitShapes = shapes.some((shape) => shape.role !== "table");
  const displaySavedFloorplans = Array.from(
    savedFloorplans.reduce((acc, floorplan) => {
      if (floorplan?.floorId) {
        acc.set(floorplan.floorId, floorplan);
      }
      return acc;
    }, new Map()).values()
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
    backdrop,
    scale = 1,
    pan: panOffset = { x: 0, y: 0 },
  }) => {
    if (!ctx) return;

    const canvas = ctx.canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, panOffset.x, panOffset.y);

    if (backdrop) {
      const imgW = backdrop.naturalWidth || backdrop.width;
      const imgH = backdrop.naturalHeight || backdrop.height;
      if (imgW && imgH) {
        const fitScale = Math.min(canvas.width / imgW, canvas.height / imgH);
        const drawW = imgW * fitScale;
        const drawH = imgH * fitScale;
        const drawX = (canvas.width - drawW) / 2;
        const drawY = (canvas.height - drawH) / 2;
        ctx.globalAlpha = 0.5;
        ctx.drawImage(backdrop, drawX, drawY, drawW, drawH);
        ctx.globalAlpha = 1.0;
      }
    }

    ctx.strokeStyle = "#f0f0f0";
    ctx.lineWidth = 1;
    const viewLeft = -panOffset.x / scale;
    const viewTop = -panOffset.y / scale;
    const viewRight = viewLeft + canvas.width / scale;
    const viewBottom = viewTop + canvas.height / scale;
    const gridSize = 20;
    const startX = Math.floor(viewLeft / gridSize) * gridSize;
    const startY = Math.floor(viewTop / gridSize) * gridSize;
    for (let i = startX; i <= viewRight; i += gridSize) {
      ctx.beginPath();
      ctx.moveTo(i, viewTop);
      ctx.lineTo(i, viewBottom);
      ctx.stroke();
    }
    for (let i = startY; i <= viewBottom; i += gridSize) {
      ctx.beginPath();
      ctx.moveTo(viewLeft, i);
      ctx.lineTo(viewRight, i);
      ctx.stroke();
    }

    const allShapes = currentShapeToRender
      ? [...shapesToRender, currentShapeToRender]
      : shapesToRender;

    const fitText = (text, maxWidth, maxHeight) => {
      const minSize = 8;
      const maxSize = 16;
      let size = Math.min(maxSize, Math.max(minSize, Math.floor(maxHeight)));
      ctx.font = `${size}px Arial`;
      while (size > minSize && ctx.measureText(text).width > maxWidth) {
        size -= 1;
        ctx.font = `${size}px Arial`;
      }
      return size;
    };

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
        const barThickness = 4;
        const lineThickness = 2;

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
          const text = shape.label || "";
          const maxW = Math.max(10, shape.width * 0.9);
          const maxH = Math.max(10, shape.height * 0.6);
          const fontSize = fitText(text, maxW, maxH);
          ctx.fillStyle = "#000";
          ctx.font = `${fontSize}px Arial`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(
            text,
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
      backdrop: backdropImg,
      scale: zoom,
      pan,
    });
  }, [shapes, currentShape, selectedShapeId, tool, zoom, pan, backdropImg]);

  // --- INTERACTION LOGIC ---
  const getMousePos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const safeZoom = zoom || 1;
    return {
      x: (e.clientX - rect.left - pan.x) / safeZoom,
      y: (e.clientY - rect.top - pan.y) / safeZoom,
    };
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
      if (zoom > 1) {
        setIsPanning(true);
        setPanStart({ x: e.clientX, y: e.clientY });
        setPanOrigin({ x: pan.x, y: pan.y });
        return;
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
    } else if (isPanning) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      setPan({ x: panOrigin.x + dx, y: panOrigin.y + dy });
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
      let normalizedShape = {
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
    setIsPanning(false);
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

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(ZOOM_MAX, Number((prev + ZOOM_STEP).toFixed(2))));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(ZOOM_MIN, Number((prev - ZOOM_STEP).toFixed(2))));
  };

  useEffect(() => {
    if (zoom <= 1) {
      setPan({ x: 0, y: 0 });
    }
  }, [zoom]);

  const handleBackdropUpload = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      setBackdropImg(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  };

  const handleClearBackdrop = () => {
    setBackdropImg(null);
  };

  const readImageDimensions = (file) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(img.src);
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        URL.revokeObjectURL(img.src);
        reject(new Error("Failed to read image dimensions"));
      };
      img.src = URL.createObjectURL(file);
    });

  const rectsOverlap = (a, b) =>
    !(
      a.x + a.width <= b.x ||
      a.x >= b.x + b.width ||
      a.y + a.height <= b.y ||
      a.y >= b.y + b.height
    );

  const rectOverlapsEllipse = (rect, ellipse) => {
    const cx = ellipse.x + ellipse.width / 2;
    const cy = ellipse.y + ellipse.height / 2;
    const rx = Math.max(1, ellipse.width / 2);
    const ry = Math.max(1, ellipse.height / 2);

    const minX = (rect.x - cx) / rx;
    const maxX = (rect.x + rect.width - cx) / rx;
    const minY = (rect.y - cy) / ry;
    const maxY = (rect.y + rect.height - cy) / ry;

    const closestX = clamp(0, Math.min(minX, maxX), Math.max(minX, maxX));
    const closestY = clamp(0, Math.min(minY, maxY), Math.max(minY, maxY));

    return closestX * closestX + closestY * closestY < 1;
  };

  const seatOverlapsTable = (seat, table) =>
    table.type === "circle"
      ? rectOverlapsEllipse(seat, table)
      : rectsOverlap(seat, table);

  const seatOverlapsAnyTable = (seat, tables) =>
    tables.some((table) => seatOverlapsTable(seat, table));

  const generateSeatsAroundTable = (table, canvasWidth, canvasHeight) => {
    const seats = [];
    const baseSize = Math.min(table.width, table.height);
    const seatSize = clamp(Math.round(baseSize * 0.22), 10, 28);
    const gap = 0;

    const isWithinCanvas = (seat) =>
      seat.x >= 0 &&
      seat.y >= 0 &&
      seat.x + seat.width <= canvasWidth &&
      seat.y + seat.height <= canvasHeight;

    const addSeatIfValid = (x, y) => {
      const seat = {
        type: "rect",
        x: Math.round(x),
        y: Math.round(y),
        width: seatSize,
        height: seatSize,
      };
      if (!isWithinCanvas(seat)) return;
      if (seatOverlapsTable(seat, table)) return;
      seats.push(seat);
    };

    if (table.type === "circle") {
      const cx = table.x + table.width / 2;
      const cy = table.y + table.height / 2;
      const rx = table.width / 2;
      const ry = table.height / 2;
      const ringX = rx + seatSize / 2 + gap;
      const ringY = ry + seatSize / 2 + gap;
      const circumference =
        Math.PI *
        (3 * (ringX + ringY) -
          Math.sqrt((3 * ringX + ringY) * (ringX + 3 * ringY)));
      const count = clamp(Math.round(circumference / (seatSize * 1.8)), 4, 14);
      for (let i = 0; i < count; i++) {
        const angle = (2 * Math.PI * i) / count;
        const seatCx = cx + Math.cos(angle) * ringX;
        const seatCy = cy + Math.sin(angle) * ringY;
        addSeatIfValid(seatCx - seatSize / 2, seatCy - seatSize / 2);
      }
      return seats;
    }

    const countX = clamp(Math.round(table.width / (seatSize * 2)), 1, 6);
    const countY = clamp(Math.round(table.height / (seatSize * 2)), 1, 6);

    const totalSeatWidth = countX * seatSize + (countX - 1) * gap;
    const startX = table.x + (table.width - totalSeatWidth) / 2;
    const topY = table.y - seatSize - gap;
    const bottomY = table.y + table.height + gap;
    for (let i = 0; i < countX; i++) {
      const sx = startX + i * (seatSize + gap);
      addSeatIfValid(sx, topY);
      addSeatIfValid(sx, bottomY);
    }

    const totalSeatHeight = countY * seatSize + (countY - 1) * gap;
    const startY = table.y + (table.height - totalSeatHeight) / 2;
    const leftX = table.x - seatSize - gap;
    const rightX = table.x + table.width + gap;
    for (let i = 0; i < countY; i++) {
      const sy = startY + i * (seatSize + gap);
      addSeatIfValid(leftX, sy);
      addSeatIfValid(rightX, sy);
    }

    return seats;
  };

  const handleAutoGenerateClick = () => {
    setAutoGenStatus(null);
    setShowAutoGenModal(true);
  };

  const handleAutoGenerateFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setShowAutoGenModal(false);
    setAutoGenLoading(true);
    setAutoGenStatus(null);

    try {
      const dims = await readImageDimensions(file);
      const canvasWidth = canvasRef.current?.width || 800;
      const canvasHeight = canvasRef.current?.height || 500;
      const scaleX = dims.width ? canvasWidth / dims.width : 1;
      const scaleY = dims.height ? canvasHeight / dims.height : 1;
      const tableScale = trackingMode === "seats" ? 1.0 : 1.2;
      const timestamp = Date.now();

      const scaleTableShape = (shape) => {
        const nextWidth = Math.round(shape.width * tableScale);
        const nextHeight = Math.round(shape.height * tableScale);
        const dx = Math.round((nextWidth - shape.width) / 2);
        const dy = Math.round((nextHeight - shape.height) / 2);
        const nextX = clamp(shape.x - dx, 0, Math.max(0, canvasWidth - nextWidth));
        const nextY = clamp(shape.y - dy, 0, Math.max(0, canvasHeight - nextHeight));
        return {
          ...shape,
          x: nextX,
          y: nextY,
          width: nextWidth,
          height: nextHeight,
        };
      };

      const scaleRawShapes = (rawShapes, labelPrefix, options = {}) => {
        const { role, applyTableScale } = options;
        const base = rawShapes.map((shape, idx) => {
          const nextShape = {
            id: `shape_${timestamp}_${labelPrefix.toLowerCase()}_${idx + 1}`,
            type: shape.type || "rect",
            x: Math.round((shape.x || 0) * scaleX),
            y: Math.round((shape.y || 0) * scaleY),
            width: Math.round((shape.width || 40) * scaleX),
            height: Math.round((shape.height || 40) * scaleY),
            label: `${labelPrefix} ${idx + 1}`,
          };
          if (role) nextShape.role = role;
          return nextShape;
        });
        if (!applyTableScale) return base;
        return base.map(scaleTableShape);
      };

      let nextShapes = [];
      let statusMessage = "";

      if (trackingMode === "seats") {
        const [tablesData, seatsData] = await Promise.all([
          autoGenerateFloorplan(file, "tables"),
          autoGenerateFloorplan(file, "seats"),
        ]);
        const rawTables = tablesData?.shapes || tablesData || [];
        const rawSeats = seatsData?.shapes || seatsData || [];

        const tableShapes = scaleRawShapes(rawTables, "Table", {
          role: "table",
          applyTableScale: true,
        });

        const detectedSeats = scaleRawShapes(rawSeats, "Seat").filter(
          (seat) => !seatOverlapsAnyTable(seat, tableShapes)
        );

        const generatedSeats = tableShapes.flatMap((table) =>
          generateSeatsAroundTable(table, canvasWidth, canvasHeight)
        );

        const isDuplicateSeat = (seat, existing) => {
          const cx1 = seat.x + seat.width / 2;
          const cy1 = seat.y + seat.height / 2;
          const cx2 = existing.x + existing.width / 2;
          const cy2 = existing.y + existing.height / 2;
          const dx = cx1 - cx2;
          const dy = cy1 - cy2;
          const dist = Math.hypot(dx, dy);
          return dist < Math.min(seat.width, existing.width) * 0.6;
        };

        const seatShapes = [...detectedSeats];
        generatedSeats.forEach((seat) => {
          if (seatOverlapsAnyTable(seat, tableShapes)) return;
          if (seatShapes.some((existing) => isDuplicateSeat(seat, existing))) return;
          seatShapes.push(seat);
        });

        const labeledSeats = seatShapes.map((seat, idx) => ({
          ...seat,
          id: `shape_${timestamp}_seat_${idx + 1}`,
          label: `Seat ${idx + 1}`,
        }));

        nextShapes = [...tableShapes, ...labeledSeats];
        statusMessage = `Auto-generated ${labeledSeats.length} seats with ${tableShapes.length} tables.`;
      } else {
        const data = await autoGenerateFloorplan(file, trackingMode);
        const rawShapes = data?.shapes || data || [];
        nextShapes = scaleRawShapes(rawShapes, "Table", { applyTableScale: true });
        statusMessage = `Auto-generated ${nextShapes.length} tables.`;
      }

      setShapes(nextShapes);
      setSelectedShapeId(null);
      setSeatLabel("");
      setTool("select");
      setAutoGenStatus({
        success: true,
        message: statusMessage,
      });
    } catch (error) {
      setAutoGenStatus({
        success: false,
        message: error.message || "Auto-generate failed.",
      });
    }

    setAutoGenLoading(false);
  };

  const handleSubmit = async () => {
    if (!selectedFloorId) {
      alert("Please select a floor before saving.");
      return;
    }
    const submitShapes = shapes.filter((shape) => shape.role !== "table");
    if (submitShapes.length === 0) {
      alert("Please draw at least one seat before saving.");
      return;
    }
    if (assignedStreams.length === 0) {
      alert("Please assign a stream to this floor in Step 1.");
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
      scale: 1,
      pan: { x: 0, y: 0 },
    });

    const previewUrl = exportCanvas.toDataURL("image/png");

    exportCanvas.toBlob(async (blob) => {
      const imageFile = new File([blob], "custom_floorplan.png", {
        type: "image/png",
      });

      const streamsToSubmit = assignedStreams.length
        ? assignedStreams
        : selectedStream
        ? [selectedStream]
        : [];

      if (streamsToSubmit.length === 0) {
        setSubmitResult({
          success: false,
          error: "No stream available for this floor.",
        });
        setIsSubmitting(false);
        return;
      }

      try {
        const results = await Promise.allSettled(
          streamsToSubmit.map(async (stream) => {
            const streamName = stream?.name || stream?.id || "Unnamed Stream";
            const floorplanIdForSubmit = selectedFloorId
              ? `${selectedFloorId}_${setupKey}`
              : null;
            const result = await submitFloorplanWithSeats(
              imageFile,
              submitShapes,
              stream?.url,
              streamName,
              canvasRef.current.width,
              canvasRef.current.height,
              floorplanIdForSubmit,
              selectedFloor?.name || ""
            );
            return { result, stream, streamName };
          })
        );

        const successes = results
          .filter((item) => item.status === "fulfilled")
          .map((item) => item.value);
        const failures = results.filter((item) => item.status === "rejected");

        if (successes.length > 0 && setSavedFloorplans) {
          const first = successes[0];
          const entry = {
            id: first?.result?.floorplan_id || selectedFloorId,
            floorId: selectedFloorId,
            floorName: selectedFloor?.name || selectedFloorId,
            streamCount: successes.length,
            streamIds: successes.map((item) => item.stream?.id).filter(Boolean),
            streamNames: successes.map((item) => item.streamName).filter(Boolean),
            previewUrl,
            savedAt: new Date().toISOString(),
            backendFloorplanId: first?.result?.floorplan_id,
          };

          setSavedFloorplans((prev) => {
            const next = prev.filter(
              (floorplan) => floorplan.floorId !== selectedFloorId
            );
            return [...next, entry];
          });
        }

        if (failures.length > 0) {
          const firstError = failures[0]?.reason?.message || "Some saves failed.";
          setSubmitResult({
            success: false,
            error: `Saved ${successes.length}/${streamsToSubmit.length}. ${firstError}`,
          });
        } else {
          setSubmitResult({
            success: true,
            data: { savedCount: successes.length },
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
      {onBack && (
        <button
          onClick={onBack}
          style={{
            alignSelf: "flex-start",
            padding: "8px 12px",
            backgroundColor: "#f1f3f5",
            color: "#333",
            border: "1px solid #ddd",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          &lt;- Back to Dashboard
        </button>
      )}
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
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span aria-hidden="true" style={{ fontSize: 14 }}>
                  👉
                </span>
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
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 16,
                    height: 12,
                    border: tool === "rect" ? "2px solid #fff" : "2px solid #2e7d32",
                    borderRadius: 2,
                    boxSizing: "border-box",
                  }}
                />
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
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 14,
                    height: 14,
                    border: tool === "circle" ? "2px solid #fff" : "2px solid #2e7d32",
                    borderRadius: "50%",
                    boxSizing: "border-box",
                  }}
                />
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
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span aria-hidden="true" style={{ fontSize: 14 }}>
                  🚪
                </span>
                Entrance
              </button>
              <button
                onClick={handleAutoGenerateClick}
                disabled={autoGenLoading}
                style={{
                  padding: "8px 12px",
                  backgroundColor: autoGenLoading ? "#b39ddb" : "#673AB7",
                  color: "white",
                  border: "none",
                  borderRadius: 4,
                  cursor: autoGenLoading ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                Generate Floorplan
              </button>
              <input
                id="backdrop-upload-input"
                type="file"
                accept="image/*"
                onChange={handleBackdropUpload}
                style={{ display: "none" }}
              />
              <label
                htmlFor="backdrop-upload-input"
                style={{
                  padding: "8px 12px",
                  backgroundColor: "#607D8B",
                  color: "white",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                Upload Backdrop (Trace)
              </label>
              {backdropImg && (
                <button
                  onClick={handleClearBackdrop}
                  style={{
                    padding: "8px 12px",
                    backgroundColor: "#9E9E9E",
                    color: "white",
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  Clear Backdrop
                </button>
              )}
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <button
                  onClick={handleZoomOut}
                  disabled={zoom <= ZOOM_MIN}
                  style={{
                    padding: "6px 10px",
                    backgroundColor: zoom <= ZOOM_MIN ? "#ccc" : "#2196F3",
                    color: "white",
                    border: "none",
                    borderRadius: 4,
                    cursor: zoom <= ZOOM_MIN ? "not-allowed" : "pointer",
                  }}
                >
                  Zoom -
                </button>
                <div style={{ minWidth: 48, textAlign: "center", fontSize: 12 }}>
                  {Math.round(zoom * 100)}%
                </div>
                <button
                  onClick={handleZoomIn}
                  disabled={zoom >= ZOOM_MAX}
                  style={{
                    padding: "6px 10px",
                    backgroundColor: zoom >= ZOOM_MAX ? "#ccc" : "#2196F3",
                    color: "white",
                    border: "none",
                    borderRadius: 4,
                    cursor: zoom >= ZOOM_MAX ? "not-allowed" : "pointer",
                  }}
                >
                  Zoom +
                </button>
              </div>
            </div>

            {autoGenStatus && (
              <div
                style={{
                  marginBottom: 10,
                  padding: 8,
                  borderRadius: 4,
                  fontSize: 12,
                  backgroundColor: autoGenStatus.success ? "#e8f5e9" : "#ffebee",
                  color: autoGenStatus.success ? "#2e7d32" : "#c62828",
                }}
              >
                {autoGenStatus.message}
              </div>
            )}

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
                  cursor:
                    tool === "select"
                      ? isPanning
                        ? "grabbing"
                        : zoom > 1
                        ? "grab"
                        : "default"
                      : "crosshair",
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
                  ? `Design saved for ${submitResult.data?.savedCount || 1} stream(s).`
                  : `Error: ${submitResult.error}`}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={
                !hasSubmitShapes ||
                assignedStreams.length === 0 ||
                isSubmitting
              }
              style={{
                width: "100%",
                padding: 10,
                backgroundColor:
                  !hasSubmitShapes ||
                  assignedStreams.length === 0 ||
                  isSubmitting
                    ? "#ccc"
                    : "#4CAF50",
                color: "white",
                border: "none",
                borderRadius: 4,
                cursor:
                  !hasSubmitShapes ||
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
        {displaySavedFloorplans.length === 0 ? (
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
            {displaySavedFloorplans.map((floorplan) => (
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
                  Cameras: {floorplan.streamCount ?? (floorplan.streamIds?.length || 0)}
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

      {showAutoGenModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              backgroundColor: "white",
              borderRadius: 8,
              padding: 20,
              boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
            }}
          >
            <h3 style={{ marginTop: 0 }}>Auto-Generate Floorplan</h3>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: "bold", marginBottom: 6 }}>
                What would you like to track?
              </div>
              <label style={{ display: "block", marginBottom: 6, fontSize: 14 }}>
                <input
                  type="radio"
                  name="trackingMode"
                  value="tables"
                  checked={trackingMode === "tables"}
                  onChange={() => setTrackingMode("tables")}
                  style={{ marginRight: 6 }}
                />
                Tables (Entire table occupancy)
              </label>
              <label style={{ display: "block", fontSize: 14 }}>
                <input
                  type="radio"
                  name="trackingMode"
                  value="seats"
                  checked={trackingMode === "seats"}
                  onChange={() => setTrackingMode("seats")}
                  style={{ marginRight: 6 }}
                />
                Seats (Individual chair occupancy)
              </label>
            </div>

            <div style={{ marginBottom: 12 }}>
              <input
                type="file"
                accept="image/*"
                onChange={handleAutoGenerateFile}
                disabled={autoGenLoading}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                onClick={() => setShowAutoGenModal(false)}
                style={{
                  padding: "8px 12px",
                  backgroundColor: "#e0e0e0",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
