import React, { useState, useEffect } from "react";
import { getFloorplans } from "./api"; 
import StreamAssignment from "./components/StreamAssignment";
import FloorplanDesigner from "./components/FloorplanDesigner";
import FeedSelection from "./components/FeedSelection";
import HeatmapTest from "./heatmap_ui/HeatmapTest";
export default function App() {
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  // Check the database for existing setup when the app loads
  useEffect(() => {
    const checkSavedData = async () => {
      try {
        const response = await getFloorplans();
        // If they already designed a floorplan, skip straight to the Heatmap (Step 4)
        if (response.floorplans && response.floorplans.length > 0) {
          setCurrentStep(3);
        }
      } catch (error) {
        console.error("Backend not reachable or no floorplans found.", error);
      } finally {
        setIsLoading(false); 
      }
    };

    checkSavedData();
  }, []);

  const nextStep = () => setCurrentStep((prev) => prev + 1);
  const prevStep = () => setCurrentStep((prev) => prev - 1);
  const goToStep = (stepNumber) => setCurrentStep(stepNumber);

  if (isLoading) {
    return <div style={{ padding: 40, fontSize: "18px" }}>Loading your workspace...</div>;
  }

  return (
    <div style={{ padding: 20, fontFamily: "Arial" }}>
      <h1 style={{ marginTop: 0 }}>Occupancy Detection Setup</h1>
      
      {/* Show a progress indicator */}
      <div style={{ marginBottom: 20, color: "gray", fontWeight: "bold" }}>
        Step {currentStep} of 3
      </div>


      {/* Step 2: Design the Floorplan */}
      {currentStep === 1 && (
        <div>
          <h2>Step 1: Design Your Floorplan</h2>
          <p style={{ color: "#555" }}>Draw the physical layout of your space and place your tables.</p>
          
          <FloorplanDesigner />
          
          <div style={{ marginTop: 20 }}>
            <button onClick={nextStep} style={{ padding: "10px 20px", backgroundColor: "#007bff", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "16px" }}>
              Next: Map Seats to Camera
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Feed Selection (Mapping) */}
      {currentStep === 2 && (
        <div>
          <h2>Step 2: Feed Selection</h2>
          <p style={{ color: "#555" }}>Highlight where the tables from your floorplan appear in the camera feed.</p>
          
          <FeedSelection />
          
          <div style={{ marginTop: 20 }}>
            <button onClick={prevStep} style={{ padding: "10px 20px", marginRight: 15, cursor: "pointer", fontSize: "16px", backgroundColor: "#6c757d", color: "white", border: "none", borderRadius: "4px" }}>
              Back
            </button>
            <button onClick={nextStep} style={{ padding: "10px 20px", backgroundColor: "#28a745", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "16px", fontWeight: "bold" }}>
              Finish: View Heatmap
            </button>
          </div>
        </div>
      )}

      {/* Step 4: The Heatmap Display */}
      {currentStep === 3 && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
             <h2 style={{ margin: 0 }}>Step 3: Live Occupancy Heatmap</h2>
             <button onClick={() => goToStep(1)} style={{ padding: "8px 16px", backgroundColor: "#dc3545", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}>
               Restart Setup
             </button>
          </div>
          
          {/* PLACEHOLDER FOR YOUR HEATMAP COMPONENT */}
          <div style={{ padding: 60, border: "2px dashed #ccc", borderRadius: 8, textAlign: "center", backgroundColor: "#f8f9fa" }}>
            <HeatmapTest/>
          </div>

        </div>
      )}

    </div>
  );
}