const BASE_URL = "http://127.0.0.1:5001";

export async function ping() {
  const res = await fetch(`${BASE_URL}/`);
  if (!res.ok) throw new Error("Ping failed");
  return res.json();
}


export const getServerStatus = ping;

/**
 * Get all active video streams being monitored
 */
export async function getStreams() {
  const res = await fetch(`${BASE_URL}/streams`);
  if (!res.ok) throw new Error("Failed to get streams");
  return res.json();
}

// Occupancy Data

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

// Stream Management

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

// Floorplan

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

/**
 * Submit floorplan with seats and associate with a stream
 * @param {File} imageFile - The floorplan image file
 * @param {Array} seats - Array of seat objects with { id, x, y, width, height, label }
 * @param {string} streamUrl - RTSP stream URL
 * @param {string} streamName - Display name for the stream
 * @param {number} imageWidth - Original image width
 * @param {number} imageHeight - Original image height
 */
export async function submitFloorplanWithSeats(imageFile, seats, streamUrl, streamName, imageWidth, imageHeight) {
  const formData = new FormData();
  formData.append("floorplan", imageFile);
  formData.append("seats", JSON.stringify(seats));
  formData.append("stream_url", streamUrl);
  formData.append("stream_name", streamName);
  formData.append("image_width", imageWidth);
  formData.append("image_height", imageHeight);

  const res = await fetch(`${BASE_URL}/submit-floorplan`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error("Failed to submit floorplan");
  return res.json();
}

// Legacy alias
export const assignStream = addStream;

// MongoDB Data

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
  submitFloorplanWithSeats,
  assignStream,
  getFloorplans,
  getFloorplan,
  getOccupancyHistory,
};
