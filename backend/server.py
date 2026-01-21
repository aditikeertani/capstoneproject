"""
Occupancy Detection Backend Server

This server:
1. Receives video stream URLs
2. Captures screenshots every 30 seconds
3. Runs occupancy detection model on captured frames
4. Stores occupancy status (frontend polls via REST API)
"""

from flask_pymongo import PyMongo
from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import sys
import threading
import time
import cv2
import base64
import numpy as np
from datetime import datetime
from collections import defaultdict
import uuid

# Add od-model to path for importing the model
OD_MODEL_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../od-model'))
sys.path.insert(0, OD_MODEL_PATH)

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

app.config["MONGO_URI"] = "mongodb://localhost:27017/myDatabase"

# Try to initialize MongoDB, but don't fail if it's not available
try:
    mongo = PyMongo(app)
    MONGO_AVAILABLE = True
except Exception as e:
    print(f"MongoDB not available: {e}. Running without database.")
    mongo = None
    MONGO_AVAILABLE = False

# ============================================================================
# CONFIGURATION
# ============================================================================
SCREENSHOT_INTERVAL = 30  # seconds between screenshots
NUM_CLASSES = 3
IMG_SIZE = 224
CLASS_NAMES = ["Unoccupied", "Unattended", "Occupied"]

# Model paths - will check in order
BACKEND_DIR = os.path.dirname(__file__)
MODELS_DIR = os.path.join(BACKEND_DIR, 'models')
os.makedirs(MODELS_DIR, exist_ok=True)

MODEL_PATHS = [
    os.path.join(MODELS_DIR, 'occupancy_model.pth'),
    os.path.join(MODELS_DIR, 'model1.pth'),
    os.path.join(OD_MODEL_PATH, 'model1.pth'),
    os.path.join(OD_MODEL_PATH, 'occupancy_model.pth'),
]

# Directory for saving screenshots
SCREENSHOTS_DIR = os.path.join(BACKEND_DIR, 'screenshots')
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

# ============================================================================
# GLOBAL STATE
# ============================================================================
active_streams = {}  # stream_id -> stream_info
stream_threads = {}  # stream_id -> thread
occupancy_data = defaultdict(dict)  # stream_id -> {seat_id: occupancy_info}

# Dummy coordinates for seats/tables
DUMMY_COORDINATES = [
    {"id": "seat_1", "x": 100, "y": 150, "label": "Table 1"},
    {"id": "seat_2", "x": 250, "y": 150, "label": "Table 2"},
    {"id": "seat_3", "x": 400, "y": 150, "label": "Table 3"},
    {"id": "seat_4", "x": 100, "y": 300, "label": "Table 4"},
    {"id": "seat_5", "x": 250, "y": 300, "label": "Table 5"},
    {"id": "seat_6", "x": 400, "y": 300, "label": "Table 6"},
]

# ============================================================================
# MODEL LOADING
# ============================================================================
model = None
device = None
model_loaded_path = None

def load_model():
    """Load the occupancy detection model."""
    global model, device, model_loaded_path
    
    try:
        import torch
        from model import Classifier
        
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        print(f"🔧 PyTorch available, using device: {device}")
        
        # Search for model weights
        for model_path in MODEL_PATHS:
            if os.path.exists(model_path):
                try:
                    temp_model = Classifier(num_classes=NUM_CLASSES).to(device)
                    temp_model.load_state_dict(torch.load(model_path, map_location=device, weights_only=True))
                    temp_model.eval()
                    model = temp_model
                    model_loaded_path = model_path
                    print(f"✅ Model loaded from: {model_path}")
                    return True
                except Exception as e:
                    print(f"⚠️ Failed to load weights from {model_path}: {e}")
                    continue
        
        print(f"ℹ️  No model weights found - using MOCK predictions (random)")
        print(f"   To use real predictions, place model file in: {MODELS_DIR}")
        model = None
        return False
        
    except ImportError:
        print(f"ℹ️  PyTorch not available - using MOCK predictions")
        model = None
        device = None
        return False
    except Exception as e:
        print(f"⚠️ Error during model setup: {e}")
        model = None
        return False


def predict_occupancy(image):
    """Run occupancy prediction on an image."""
    global model, device
    
    if model is None:
        # Mock prediction
        import random
        class_idx = random.randint(0, 2)
        confidence = random.uniform(0.7, 0.99)
        return {
            "class_index": class_idx,
            "class_name": CLASS_NAMES[class_idx],
            "confidence": round(confidence, 4),
            "is_occupied": class_idx == 2,
            "is_mock": True
        }
    
    try:
        import torch
        from torchvision.transforms import ToTensor, Resize, Compose
        
        preprocess = Compose([
            ToTensor(),
            Resize((IMG_SIZE, IMG_SIZE))
        ])
        
        img_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        img_tensor = preprocess(img_rgb).unsqueeze(0).to(device)
        
        with torch.no_grad():
            outputs = model(img_tensor)
            probs = torch.nn.functional.softmax(outputs, dim=1)
            confidence, predicted_idx = torch.max(probs, 1)
        
        class_idx = predicted_idx.item()
        conf = confidence.item()
        
        return {
            "class_index": class_idx,
            "class_name": CLASS_NAMES[class_idx],
            "confidence": round(conf, 4),
            "is_occupied": class_idx == 2,
            "is_mock": False
        }
        
    except Exception as e:
        print(f"Error during prediction: {e}")
        return {
            "class_index": -1,
            "class_name": "Error",
            "confidence": 0,
            "is_occupied": False,
            "error": str(e)
        }

# ============================================================================
# VIDEO STREAM PROCESSING
# ============================================================================
def capture_frame_from_stream(stream_url):
    """Capture a single frame from a video stream."""
    try:
        cap = cv2.VideoCapture(stream_url)
        if not cap.isOpened():
            print(f"Failed to open stream: {stream_url}")
            return None
        
        ret, frame = cap.read()
        cap.release()
        
        if not ret or frame is None:
            return None
        return frame
        
    except Exception as e:
        print(f"Error capturing frame: {e}")
        return None

def process_stream(stream_id, stream_url):
    """Background thread: capture frames and run detection every 30 seconds."""
    print(f"🎥 Starting stream processing for {stream_id}: {stream_url}")
    
    while stream_id in active_streams and active_streams[stream_id].get('active', False):
        try:
            frame = capture_frame_from_stream(stream_url)
            
            if frame is not None:
                # Save screenshot
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                screenshot_path = os.path.join(SCREENSHOTS_DIR, f"{stream_id}_{timestamp}.jpg")
                cv2.imwrite(screenshot_path, frame)
                print(f"📸 Screenshot saved: {screenshot_path}")
                
                # Run prediction
                prediction = predict_occupancy(frame)
                
                # Update occupancy data (frontend can poll this via REST)
                seats_data = []
                for coord in DUMMY_COORDINATES:
                    seat_result = {
                        **coord,
                        "status": prediction["class_name"],
                        "is_occupied": prediction["is_occupied"],
                        "confidence": prediction["confidence"],
                        "timestamp": datetime.now().isoformat()
                    }
                    occupancy_data[stream_id][coord["id"]] = seat_result
                    seats_data.append(seat_result)
                
                # Store in MongoDB if available
                if MONGO_AVAILABLE and mongo:
                    try:
                        occupancy_doc = {
                            "stream_id": stream_id,
                            "timestamp": datetime.now().isoformat(),
                            "prediction": prediction,
                            "seats": seats_data,
                            "screenshot_path": screenshot_path
                        }
                        mongo.db.occupancy_history.insert_one(occupancy_doc)
                        
                        # Also update current occupancy
                        mongo.db.current_occupancy.update_one(
                            {"stream_id": stream_id},
                            {"$set": occupancy_doc},
                            upsert=True
                        )
                    except Exception as e:
                        print(f"⚠️ Failed to store occupancy in MongoDB: {e}")
                
                print(f"📊 Occupancy updated for {stream_id}: {prediction['class_name']}")
                
            else:
                print(f"⚠️ No frame captured for {stream_id}")
                
        except Exception as e:
            print(f"❌ Error processing stream {stream_id}: {e}")
        
        time.sleep(SCREENSHOT_INTERVAL)
    
    print(f"🛑 Stream processing stopped for {stream_id}")

# ============================================================================
# REST API ENDPOINTS
# ============================================================================
@app.route("/")
def health_check():
    """Health check endpoint."""
    return jsonify({
        "status": "running",
        "message": "Occupancy Detection Server is running",
        "model_loaded": model is not None,
        "model_path": model_loaded_path if model_loaded_path else "No model loaded (using mock predictions)",
        "device": str(device) if device else "N/A",
        "active_streams": len(active_streams),
        "mongodb_available": MONGO_AVAILABLE,
        "screenshot_interval_seconds": SCREENSHOT_INTERVAL,
        "models_directory": MODELS_DIR
    })

@app.route("/upload-floorplan", methods=["POST"])
def upload_floorplan():
    """Upload a floorplan image and store in MongoDB."""
    if "floorplan" not in request.files:
        return jsonify({"error": "No floorplan uploaded"}), 400

    file = request.files["floorplan"]
    
    # Also save to disk as backup
    floorplan_dir = os.path.join(BACKEND_DIR, 'floorplans')
    os.makedirs(floorplan_dir, exist_ok=True)
    
    floorplan_id = str(uuid.uuid4())[:8]
    filename = f"floorplan_{floorplan_id}_{file.filename}"
    filepath = os.path.join(floorplan_dir, filename)
    file.save(filepath)
    
    # Store in MongoDB if available
    if MONGO_AVAILABLE and mongo:
        try:
            # Read file content for MongoDB storage
            with open(filepath, 'rb') as f:
                file_content = f.read()
            
            # Store floorplan metadata and image data
            floorplan_doc = {
                "_id": floorplan_id,
                "filename": file.filename,
                "stored_filename": filename,
                "filepath": filepath,
                "content_type": file.content_type,
                "size_bytes": len(file_content),
                "image_data": base64.b64encode(file_content).decode('utf-8'),
                "uploaded_at": datetime.now().isoformat(),
                "coordinates": []  # Will be populated when user maps seats
            }
            
            mongo.db.floorplans.insert_one(floorplan_doc)
            print(f"✅ Floorplan {floorplan_id} stored in MongoDB")
            
        except Exception as e:
            print(f"⚠️ Failed to store floorplan in MongoDB: {e}")
    
    return jsonify({
        "message": "Floorplan received and saved",
        "floorplan_id": floorplan_id,
        "filename": filename,
        "filepath": filepath,
        "stored_in_db": MONGO_AVAILABLE
    })

@app.route("/floorplans", methods=["GET"])
def get_floorplans():
    """Get all uploaded floorplans."""
    if not MONGO_AVAILABLE or not mongo:
        return jsonify({"error": "MongoDB not available", "floorplans": []}), 200
    
    try:
        floorplans = list(mongo.db.floorplans.find({}, {"image_data": 0}))  # Exclude image data for list
        # Convert ObjectId to string if needed
        for fp in floorplans:
            fp["id"] = str(fp.pop("_id"))
        return jsonify({"floorplans": floorplans, "count": len(floorplans)})
    except Exception as e:
        return jsonify({"error": str(e), "floorplans": []}), 500

@app.route("/floorplans/<floorplan_id>", methods=["GET"])
def get_floorplan(floorplan_id):
    """Get a specific floorplan by ID."""
    if not MONGO_AVAILABLE or not mongo:
        return jsonify({"error": "MongoDB not available"}), 503
    
    try:
        floorplan = mongo.db.floorplans.find_one({"_id": floorplan_id})
        if not floorplan:
            return jsonify({"error": "Floorplan not found"}), 404
        floorplan["id"] = str(floorplan.pop("_id"))
        return jsonify(floorplan)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/streams", methods=["GET"])
def get_streams():
    """Get all active streams."""
    return jsonify({
        "streams": list(active_streams.values()),
        "count": len(active_streams)
    })

@app.route("/streams", methods=["POST"])
def add_stream():
    """Add a new video stream for processing."""
    data = request.json
    
    if not data or "url" not in data:
        return jsonify({"error": "Stream URL is required"}), 400
    
    stream_url = data["url"]
    stream_name = data.get("name", f"Stream {len(active_streams) + 1}")
    stream_id = str(uuid.uuid4())[:8]
    
    stream_info = {
        "id": stream_id,
        "url": stream_url,
        "name": stream_name,
        "active": True,
        "created_at": datetime.now().isoformat(),
        "coordinates": DUMMY_COORDINATES
    }
    
    active_streams[stream_id] = stream_info
    
    # Store in MongoDB if available
    if MONGO_AVAILABLE and mongo:
        try:
            stream_doc = {**stream_info, "_id": stream_id}
            mongo.db.streams.update_one(
                {"_id": stream_id}, 
                {"$set": stream_doc}, 
                upsert=True
            )
            print(f"✅ Stream {stream_id} stored in MongoDB")
        except Exception as e:
            print(f"⚠️ Failed to store stream in MongoDB: {e}")
    
    # Start background processing thread
    thread = threading.Thread(
        target=process_stream,
        args=(stream_id, stream_url),
        daemon=True
    )
    thread.start()
    stream_threads[stream_id] = thread
    
    return jsonify({
        "message": "Stream added and processing started",
        "stream": stream_info
    }), 201

@app.route("/streams/<stream_id>", methods=["DELETE"])
def remove_stream(stream_id):
    """Stop and remove a stream."""
    if stream_id not in active_streams:
        return jsonify({"error": "Stream not found"}), 404
    
    active_streams[stream_id]["active"] = False
    del active_streams[stream_id]
    
    if stream_id in occupancy_data:
        del occupancy_data[stream_id]
    
    return jsonify({"message": f"Stream {stream_id} stopped and removed"})

@app.route("/streams/<stream_id>/capture", methods=["POST"])
def manual_capture(stream_id):
    """Manually trigger a capture and prediction for a stream."""
    if stream_id not in active_streams:
        return jsonify({"error": "Stream not found"}), 404
    
    stream_url = active_streams[stream_id]["url"]
    frame = capture_frame_from_stream(stream_url)
    
    if frame is None:
        return jsonify({"error": "Failed to capture frame"}), 500
    
    # Save screenshot
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    screenshot_path = os.path.join(SCREENSHOTS_DIR, f"{stream_id}_{timestamp}.jpg")
    cv2.imwrite(screenshot_path, frame)
    
    # Run prediction
    prediction = predict_occupancy(frame)
    
    # Build results with coordinates
    results = []
    for coord in DUMMY_COORDINATES:
        seat_result = {
            **coord,
            "status": prediction["class_name"],
            "is_occupied": prediction["is_occupied"],
            "confidence": prediction["confidence"],
            "timestamp": datetime.now().isoformat()
        }
        results.append(seat_result)
        occupancy_data[stream_id][coord["id"]] = seat_result
    
    return jsonify({
        "stream_id": stream_id,
        "timestamp": datetime.now().isoformat(),
        "screenshot_path": screenshot_path,
        "prediction": prediction,
        "seats": results
    })

@app.route("/occupancy", methods=["GET"])
def get_occupancy():
    """Get current occupancy status for all streams."""
    return jsonify({
        "timestamp": datetime.now().isoformat(),
        "streams": dict(occupancy_data),
        "coordinates": DUMMY_COORDINATES
    })

@app.route("/occupancy/<stream_id>", methods=["GET"])
def get_stream_occupancy(stream_id):
    """Get occupancy status for a specific stream."""
    if stream_id not in active_streams:
        return jsonify({"error": "Stream not found"}), 404
    
    return jsonify({
        "stream_id": stream_id,
        "timestamp": datetime.now().isoformat(),
        "seats": occupancy_data.get(stream_id, {}),
        "coordinates": DUMMY_COORDINATES
    })

@app.route("/occupancy/history", methods=["GET"])
def get_occupancy_history():
    """Get occupancy history from MongoDB."""
    if not MONGO_AVAILABLE or not mongo:
        return jsonify({"error": "MongoDB not available", "history": []}), 200
    
    try:
        # Get optional query params
        stream_id = request.args.get("stream_id")
        limit = int(request.args.get("limit", 100))
        
        query = {}
        if stream_id:
            query["stream_id"] = stream_id
        
        history = list(
            mongo.db.occupancy_history
            .find(query, {"_id": 0})
            .sort("timestamp", -1)
            .limit(limit)
        )
        
        return jsonify({
            "history": history,
            "count": len(history),
            "limit": limit
        })
    except Exception as e:
        return jsonify({"error": str(e), "history": []}), 500

# ============================================================================
# MAIN
# ============================================================================
if __name__ == "__main__":
    print("=" * 60)
    print("🚀 Starting Occupancy Detection Server")
    print("=" * 60)
    
    load_model()
    
    print(f"📁 Screenshots will be saved to: {SCREENSHOTS_DIR}")
    print(f"⏱️  Screenshot interval: {SCREENSHOT_INTERVAL} seconds")
    print(f"🌐 Server starting at http://127.0.0.1:5001")
    print("=" * 60)
    
    app.run(debug=True, host='0.0.0.0', port=5001)