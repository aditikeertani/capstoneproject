import React, { useEffect, useState } from "react";
import HeatmapOverlay from "./HeatmapOverlay";
import { getdata } from "../api";

export default function HeatmapTest() {
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await getdata("52c2a4d0");
        console.log("snapshot from backend:", data);
        setSnapshot(data);
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h2>Heatmap Test</h2>
      <HeatmapOverlay
        snapshot={snapshot}
        width={640}
        height={480}
        imageSrc="/frame.jpg"
      />
    </div>
  );
}
