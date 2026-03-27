const BASE_URL = "http://127.0.0.1:5001";

const getAuthToken = () => {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("auth_jwt");
};

const authHeaders = () => {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const DEFAULT_TIMEOUT_MS = 10000;

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timerId);
  }
}

export async function ping() {
  const res = await fetch(`${BASE_URL}/`);
  if (!res.ok) throw new Error("Ping failed");
  return res.json();
}

async function parseError(res, fallback) {
  try {
    const data = await res.json();
    if (data?.error) return data.error;
  } catch {}
  return fallback;
}

export async function authRegister(email, password, name = "") {
  const res = await fetch(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name }),
  });
  if (!res.ok) {
    const message = await parseError(res, "Failed to create account");
    throw new Error(message);
  }
  return res.json();
}

export async function authLogin(email, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const message = await parseError(res, "Failed to sign in");
    throw new Error(message);
  }
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

/**
 * Get a single frame from a stream as base64
 */
export async function getStreamFrame(streamId, options = {}) {
  const { fresh = false } = options;
  const cacheBust = `t=${Date.now()}`;
  const freshParam = fresh ? "&fresh=1" : "";
  const url = `${BASE_URL}/streams/${streamId}/frame?${cacheBust}${freshParam}`;
  let res;
  try {
    res = await fetchWithTimeout(url, { cache: "no-store" });
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new Error("Stream frame request timed out");
    }
    throw err;
  }
  if (!res.ok) {
    let details = "";
    try {
      const data = await res.json();
      if (data && data.error) details = `: ${data.error}`;
    } catch {}
    throw new Error(`Failed to get stream frame${details}`);
  }
  return res.json();
}

/**
 * Get a frame from any stream URL (doesn't require stream to be registered)
 */
export async function getFrameFromUrl(url) {
  let res;
  try {
    res = await fetchWithTimeout(`${BASE_URL}/frame-from-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new Error("Frame request timed out");
    }
    throw err;
  }
  if (!res.ok) throw new Error("Failed to get frame from URL");
  return res.json();
}

/**
 * Save seat mappings (camera coordinates) for a stream
 * @param {string} streamId - The stream ID
 * @param {object} mappings - Object mapping seat IDs to camera coordinates { seatId: { x, y, width, height } }
 */
export async function saveSeatMappings(streamId, mappings) {
  const res = await fetch(`${BASE_URL}/streams/${streamId}/seat-mappings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ mappings }),
  });
  if (!res.ok) throw new Error("Failed to save seat mappings");
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
    headers: { ...authHeaders() },
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
export async function submitFloorplanWithSeats(imageFile, seats, streamUrl, streamName, imageWidth, imageHeight, floorplanId = null, floorName = null) {
  const formData = new FormData();
  formData.append("floorplan", imageFile);
  formData.append("seats", JSON.stringify(seats));
  formData.append("stream_url", streamUrl);
  formData.append("stream_name", streamName);
  formData.append("image_width", imageWidth);
  formData.append("image_height", imageHeight);
  if (floorplanId) {
    formData.append("floorplan_id", floorplanId);
  }
  if (floorName) {
    formData.append("floor_name", floorName);
  }

  const res = await fetch(`${BASE_URL}/submit-floorplan`, {
    method: "POST",
    headers: { ...authHeaders() },
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
  const res = await fetch(`${BASE_URL}/floorplans`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error("Failed to get floorplans");
  return res.json();
}

/**
 * Get a specific floorplan by ID (includes image data)
 */
export async function getFloorplan(floorplanId) {
  const res = await fetch(`${BASE_URL}/floorplans/${floorplanId}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error("Failed to get floorplan");
  return res.json();
}

/**
 * Get latest occupancy snapshot for a stream (used by heatmap)
 * @param {string} streamId - The stream ID
 */
export async function getdata(streamId) {
  const res = await fetch(`${BASE_URL}/streams/${streamId}/latest`);
  if (!res.ok) throw new Error("Get data failed");
  return res.json();
}

/**
 * Get latest aggregated occupancy snapshot for a floorplan
 * @param {string} floorplanId - The floorplan ID
 */
export async function getFloorplanLatest(floorplanId) {
  const res = await fetch(`${BASE_URL}/floorplans/${floorplanId}/latest`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error("Get floorplan data failed");
  return res.json();
}

/**
 * Auto-generate floorplan shapes from an uploaded image
 * @param {File} imageFile - Floorplan image file
 */
export async function autoGenerateFloorplan(imageFile, trackingMode = "tables") {
  const formData = new FormData();
  formData.append("floorplan", imageFile);
  formData.append("trackingMode", trackingMode);

  const res = await fetch(`${BASE_URL}/api/auto-generate-floorplan`, {
    method: "POST",
    headers: { ...authHeaders() },
    body: formData,
  });
  if (!res.ok) throw new Error("Auto-generate failed");
  return res.json();
}

const apiExports = {
  ping,
  getServerStatus,
  authRegister,
  authLogin,
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
  getdata,
  getFloorplanLatest,
  autoGenerateFloorplan,
};

export default apiExports;
