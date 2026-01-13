import React, { useState } from "react";
import { uploadFloorplan } from "../api";

export default function FloorplanUpload({ onUploaded }) {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [status, setStatus] = useState("");

  const onPick = (f) => {
    setFile(f);
    setStatus("");
    if (f) setPreviewUrl(URL.createObjectURL(f));
  };

  const onUpload = async () => {
    if (!file) return setStatus("❌ Please pick an image first.");
    setStatus("Uploading...");
    try {
      const resp = await uploadFloorplan(file);
      setStatus(`✅ Uploaded: ${resp.filename || "ok"}`);
      onUploaded?.({ file, previewUrl, resp });
    } catch (e) {
      setStatus("❌ Upload failed. Is Flask running?");
    }
  };

  return (
    <div style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8 }}>
      <h2 style={{ marginTop: 0 }}>1) Upload Floorplan</h2>

      <input
        type="file"
        accept="image/*"
        onChange={(e) => onPick(e.target.files?.[0])}
      />
      <button onClick={onUpload} style={{ marginLeft: 10, padding: "8px 12px" }}>
        Upload
      </button>

      <div style={{ marginTop: 10 }}>{status}</div>

      {previewUrl && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, marginBottom: 6 }}>Preview:</div>
          <img
            src={previewUrl}
            alt="floorplan preview"
            style={{ maxWidth: "100%", border: "1px solid #eee" }}
          />
        </div>
      )}
    </div>
  );
}
