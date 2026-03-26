import React, { useState, useEffect } from "react";
import { getFloorplans } from "./api";
import SetupStep from "./components/SetupStep";
import FloorplanDesigner from "./components/FloorplanDesigner";
import FeedSelection from "./components/FeedSelection";
import LoginPage from "./components/LoginPage";
import Dashboard from "./components/Dashboard";
import HeatmapTest from "./heatmap_ui/HeatmapTest";

import { Routes, Route } from "react-router-dom";

export default function App() {
  return (
    <Routes>
      <Route path="/embed" element={<HeatmapTest />} />
      <Route path="*" element={<MainApp />} />
    </Routes>
  );
}

function MainApp() {
  const [currentStep, setCurrentStep] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [setupKey, setSetupKey] = useState(0);
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    if (typeof window === "undefined") return false;
    return Boolean(localStorage.getItem("auth_jwt"));
  });

  const [floors, setFloors] = useState([]);
  const [streams, setStreams] = useState([]);
  const [floorplanDrafts, setFloorplanDrafts] = useState({});
  const [savedFloorplans, setSavedFloorplans] = useState([]);

  const isValidRtspUrl = (value) => {
    if (!value) return false;
    return /^rtsp:\/\/[^/\s]+\/.+/i.test(value.trim());
  };

  const hasFloors = floors.length > 0;
  const floorNamesComplete = floors.every((floor) => floor.name?.trim());
  const hasStreams = streams.length > 0;
  const streamFieldsComplete = streams.every(
    (stream) => stream.name?.trim() && stream.url?.trim() && stream.floorId
  );
  const streamUrlsValid = streams.every((stream) => isValidRtspUrl(stream.url));
  const setupReady =
    hasFloors &&
    floorNamesComplete &&
    hasStreams &&
    streamFieldsComplete &&
    streamUrlsValid;
  const setupErrors = [];
  if (!hasFloors) setupErrors.push("Add at least one floor.");
  if (!floorNamesComplete)
    setupErrors.push("Provide a name for every floor.");
  if (!hasStreams) setupErrors.push("Add at least one camera stream.");
  if (!streamFieldsComplete)
    setupErrors.push("Complete name, URL, and floor for each stream.");
  if (!streamUrlsValid)
    setupErrors.push("RTSP URLs must look like rtsp://host:port/path.");

  // Check the database for existing setup when the app loads
  useEffect(() => {
    const checkSavedData = async () => {
      try {
        await getFloorplans();
        // Always start at Dashboard on first load
        setCurrentStep(0);
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
  const resetSetupState = () => {
    setSetupKey((prev) => prev + 1);
    setFloors([]);
    setStreams([]);
    setFloorplanDrafts({});
  };
  const startNewSetup = () => {
    resetSetupState();
    setCurrentStep(1);
  };
  const backToDashboard = () => {
    resetSetupState();
    setCurrentStep(0);
  };
  const handleLogin = () => {
    setIsAuthenticated(true);
    setCurrentStep(0);
  };

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  if (isLoading) {
    return <div style={{ padding: 40, fontSize: "18px" }}>Loading your workspace...</div>;
  }

  return (
    <div style={{ padding: 20, fontFamily: "Arial" }}>
      <h1 style={{ marginTop: 0 }}>Occupancy Detection Setup</h1>

      {/* Show a progress indicator */}
      <div style={{ marginBottom: 20, color: "gray", fontWeight: "bold" }}>
        {currentStep === 0 ? "Dashboard" : `Step ${currentStep} of 4`}
      </div>

      {/* Step 0: Dashboard */}
      {currentStep === 0 && (
        <Dashboard
          onCreate={startNewSetup}
          onView={() => goToStep(4)}
        />
      )}

      {/* Step 1: Configuration / Setup */}
      {currentStep === 1 && (
        <div>
          <h2>Step 1: Configuration / Setup</h2>
          <p style={{ color: "#555" }}>
            Define your floors and enter the camera streams for each floor.
          </p>

          <SetupStep
            key={`setup-${setupKey}`}
            floors={floors}
            setFloors={setFloors}
            streams={streams}
            setStreams={setStreams}
          />

          {!setupReady && (
            <div
              style={{
                marginTop: 12,
                padding: 10,
                borderRadius: 6,
                backgroundColor: "#ffebee",
                color: "#c62828",
                fontSize: 13,
              }}
            >
              <div style={{ fontWeight: "bold", marginBottom: 6 }}>
                Complete setup before continuing:
              </div>
              {setupErrors.map((err) => (
                <div key={err}>- {err}</div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 20 }}>
            <button
              onClick={nextStep}
              disabled={!setupReady}
              style={{
                padding: "10px 20px",
                backgroundColor: setupReady ? "#007bff" : "#9bb7d6",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: setupReady ? "pointer" : "not-allowed",
                fontSize: "16px",
              }}
            >
              Next: Floorplan Designer
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Design the Floorplan */}
      {currentStep === 2 && (
        <div>
          <h2>Step 2: Floorplan Designer</h2>
          <p style={{ color: "#555" }}>
            Select a floor and draw its layout and seating.
          </p>

          <FloorplanDesigner
            key={`designer-${setupKey}`}
            floors={floors}
            streams={streams}
            floorplanDrafts={floorplanDrafts}
            setFloorplanDrafts={setFloorplanDrafts}
            savedFloorplans={savedFloorplans}
            setSavedFloorplans={setSavedFloorplans}
            setupKey={setupKey}
            onBack={backToDashboard}
          />

          <div style={{ marginTop: 20 }}>
            <button
              onClick={prevStep}
              style={{
                padding: "10px 20px",
                marginRight: 15,
                cursor: "pointer",
                fontSize: "16px",
                backgroundColor: "#6c757d",
                color: "white",
                border: "none",
                borderRadius: "4px",
              }}
            >
              Back
            </button>
            <button
              onClick={nextStep}
              style={{
                padding: "10px 20px",
                backgroundColor: "#007bff",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "16px",
              }}
            >
              Next: Feed Selection
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Feed Selection (Mapping) */}
      {currentStep === 3 && (
        <div>
          <h2>Step 3: Feed Selection</h2>
          <p style={{ color: "#555" }}>
            Highlight where the tables from your floorplan appear in the camera feed.
          </p>

          <FeedSelection key={`mapping-${setupKey}`} />

          <div style={{ marginTop: 20 }}>
            <button
              onClick={prevStep}
              style={{
                padding: "10px 20px",
                marginRight: 15,
                cursor: "pointer",
                fontSize: "16px",
                backgroundColor: "#6c757d",
                color: "white",
                border: "none",
                borderRadius: "4px",
              }}
            >
              Back
            </button>
            <button
              onClick={nextStep}
              style={{
                padding: "10px 20px",
                backgroundColor: "#28a745",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "16px",
                fontWeight: "bold",
              }}
            >
              Next: Heatmap
            </button>
          </div>
        </div>
      )}

      {/* Step 4: The Heatmap Display */}
      {currentStep === 4 && (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "20px",
            }}
          >
            <h2 style={{ margin: 0 }}>Step 4: Live Occupancy Heatmap</h2>
            <button
              onClick={() => {
                resetSetupState();
                goToStep(0);
              }}
              style={{
                padding: "8px 16px",
                backgroundColor: "#dc3545",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Restart Setup
            </button>
          </div>

          <div
            style={{
              padding: 16,
              border: "2px dashed #ccc",
              borderRadius: 8,
              backgroundColor: "#f8f9fa",
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
            }}
          >
            <HeatmapTest onBack={backToDashboard} />
          </div>
        </div>
      )}
    </div>
  );
}
