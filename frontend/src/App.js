import React, { useState, useEffect } from "react";
import { getFloorplans } from "./api"; 
import FloorplanDesigner from "./components/FloorplanDesigner";
import FeedSelection from "./components/FeedSelection";
import './App.css'; // Or whatever your CSS file is named
export default function App() {
  const [currentStep, setCurrentStep] = useState(1);

  useEffect(() => {
    const checkSavedData = async () => {
      try {
        const response = await getFloorplans();
        if (response.floorplans && response.floorplans.length > 0) {
          setCurrentStep(3); // If data exists, skip to Feed Selection
        }
      } catch (error) {
        console.error("Backend unreachable", error);
      }
    };
    checkSavedData();
  }, []);

  const nextStep = () => setCurrentStep((prev) => prev + 1);
  const prevStep = () => setCurrentStep((prev) => prev - 1);


  return (
    <div style={{ padding: 20, fontFamily: "Arial" }}>
      <h1>Occupancy Detection Setup</h1>
      
      {/* Combined Step 1: Design & Stream Upload */}
      {currentStep === 1 && (
        <div>
          <h2>Step 1: Design Floorplan & Assign Stream</h2>
          <FloorplanDesigner onComplete={nextStep} />
        </div>
      )}

      {/* Step 2: Feed Selection */}
      {currentStep === 2 && (
        <div>
          <h2>Step 2: Feed Selection</h2>
          <FeedSelection />
          <div style={{ marginTop: 20 }}>
            <button onClick={prevStep} className ="btn backbutton">Back</button>
            <button onClick={nextStep} style={{ marginLeft: 10 }}>Next: View Heatmap</button>
          </div>
        </div>
      )}

      {/* Step 3: Heatmap Display */}
      {currentStep === 3 && (
        <div>
          <button onClick={prevStep} className="btn backbutton">Back</button>        
          <h2>Step 3: Live Heatmap</h2>
          <button onClick={() => setCurrentStep(1)}>Restart</button>
          {/* Heatmap Overlay component goes here */}
        </div>
      )}
    </div>
  );
}