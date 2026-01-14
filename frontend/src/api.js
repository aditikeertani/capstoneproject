const BASE_URL = "http://127.0.0.1:5000";

export async function ping() {
  const res = await fetch(`${BASE_URL}/`);
  if (!res.ok) throw new Error("Ping failed");
  return res.json();
}

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

export async function assignStream(payload) {
  const res = await fetch(`${BASE_URL}/assign-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Assign stream failed");
  return res.json();
}
