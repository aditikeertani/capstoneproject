/**
 * API Client for Occupancy Detection Frontend
 * 
 * The frontend polls the backend for occupancy data.
 * All processing (screenshot capture, model prediction) happens on the backend.
 */

const BASE_URL = "http://127.0.0.1:5001";

// ============================================================================
// STATUS & MONITORING
// ============================================================================

/**
 * Check if the backend server is running (ping)
 */
export async function ping() {
  const res = await fetch(`${BASE_URL}/`);
  if (!res.ok) throw new Error("Server not reachable");
  return res.json();
}

// Alias for backward compatibility
export const getServerStatus = ping;

/**
 * Get all active video streams being monitored
 */
export async function getStreams() {
  const res = await fetch(`${BASE_URL}/streams`);
  if (!res.ok) throw new Error("Failed to get streams");
  return res.json();
}

// ============================================================================
// OCCUPANCY DATA - Main data the frontend displays
// ============================================================================

/**
 * Get current occupancy status for all streams
 */
export async function getOccupancy() {
  const res = await fetch(`${BASE_URL}/occupancy`);
  if (!res.ok) throw new Error("Failed to get occupancy");
  return res.json();
}

/**
 * Get occupancy status for a specific stream
 */
export async function getStreamOccupancy(streamId) {
  const res = await fetch(`${BASE_URL}/occupancy/${streamId}`);
  if (!res.ok) throw new Error("Failed to get stream occupancy");
  return res.json();
}

// ============================================================================
// STREAM MANAGEMENT
// ============================================================================

/**
 * Add a new stream to monitor
 * @param {string} url - RTSP stream URL (e.g., rtsp://localhost:8554/0.sdp)
 * @param {string} name - Display name for the stream
 */
export async function addStream(url, name = null) {
  const res = await fetch(`${BASE_URL}/streams`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, name }),
  });
  if (!res.ok) throw new Error("Failed to add stream");
  return res.json();
}

/**
 * Remove a stream from monitoring
 */
export async function removeStream(streamId) {
  const res = await fetch(`${BASE_URL}/streams/${streamId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to remove stream");
  return res.json();
}

/**
 * Manually trigger capture and prediction for a stream
 */
export async function captureStream(streamId) {
  const res = await fetch(`${BASE_URL}/streams/${streamId}/capture`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to capture stream");
  return res.json();
}

// ============================================================================
// FLOORPLAN
// ============================================================================

/**
 * Upload a floorplan image
 */
export async function uploadFloorplan(file) {
  const formData = new FormData();
  formData.append("floorplan", file);

  const res = await fetch(`${BASE_URL}/upload-floorplan`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error("Upload failed");
  return res.json();
}

// Legacy alias
export const assignStream = addStream;

// ============================================================================
// MONGODB DATA - Floorplans and History
// ============================================================================

/**
 * Get all uploaded floorplans from MongoDB
 */
export async function getFloorplans() {
  const res = await fetch(`${BASE_URL}/floorplans`);
  if (!res.ok) throw new Error("Failed to get floorplans");
  return res.json();
}

/**
 * Get a specific floorplan by ID (includes image data)
 */
export async function getFloorplan(floorplanId) {
  const res = await fetch(`${BASE_URL}/floorplans/${floorplanId}`);
  if (!res.ok) throw new Error("Failed to get floorplan");
  return res.json();
}

/**
 * Get occupancy history from MongoDB
 * @param {string} streamId - Optional stream ID filter
 * @param {number} limit - Max records to return (default 100)
 */
export async function getOccupancyHistory(streamId = null, limit = 100) {
  let url = `${BASE_URL}/occupancy/history?limit=${limit}`;
  if (streamId) url += `&stream_id=${streamId}`;
  
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to get occupancy history");
  return res.json();
}

export default {
  ping,
  getServerStatus,
  getStreams,
  getOccupancy,
  getStreamOccupancy,
  addStream,
  removeStream,
  captureStream,
  uploadFloorplan,
  assignStream,
  // MongoDB endpoints
  getFloorplans,
  getFloorplan,
  getOccupancyHistory,
};
