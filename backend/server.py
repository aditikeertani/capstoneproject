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
import torch
import numpy as np
from torchvision.transforms import ToTensor, Resize, Compose
from model import Classifier  
from pathlib import Path
from torchvision import transforms
# Import capture module
from capture import capture_frame_from_stream, save_screenshot, process_stream
import av
av.logging.set_level(av.logging.ERROR)
# Add od-model to path for importing the model
OD_MODEL_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../od-model'))
sys.path.insert(0, OD_MODEL_PATH)

app = Flask(__name__)
# Only allow your specific React dev server to talk to the backend
CORS(app, resources={r"/*": {"origins": "*"}})
app.config["MONGO_URI"] = "mongodb://localhost:27017/myDatabase"
try:
    mongo = PyMongo(app)
    MONGO_AVAILABLE = True
except Exception as e:
    print(f"MongoDB not available: {e}. Running without database.")
    mongo = None
    MONGO_AVAILABLE = False

# Configuration
SCREENSHOT_INTERVAL = 30  # seconds between screenshots
NUM_CLASSES = 2  # model has 2 output neurons
IMG_SIZE = 224
# 2-class status: model output maps directly to these
CLASS_NAMES = ["Unoccupied", "Occupied"]

# Model paths - will check in order
BACKEND_DIR = os.path.dirname(__file__)
MODELS_DIR = os.path.join(BACKEND_DIR, 'models')
os.makedirs(MODELS_DIR, exist_ok=True)

MODEL_PATHS = [
    os.path.join(MODELS_DIR, 'ModelBest.pth'),
    os.path.join(OD_MODEL_PATH, 'ModelBest.pth')
]

# Directory for saving screenshots
SCREENSHOTS_DIR = os.path.join(BACKEND_DIR, 'screenshots')
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

# Global State   
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

# Model loading
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
                    temp_model = Classifier(num_classes=2).to(device)
                    temp_model.load_state_dict(torch.load(model_path, map_location=device))
                    model = temp_model
                    model_loaded_path = model_path
                    model.eval()
                    
                    print(f"Model loaded from: {model_path}")
                    return True
                except Exception as e:
                    print(f"Failed to load weights from {model_path}: {e}")
                    continue
        
        
        print(f"No model weights found")
        print(f"Place model file (.pth) in: {MODELS_DIR}")
        model = None
        return False
        
    except ImportError:
        print(f"PyTorch not available - cannot run predictions")
        model = None
        device = None
        return False
    except Exception as e:
        print(f"Error during model setup: {e}")
        model = None
        return False


def predict_occupancy(image):
    """Run occupancy prediction on an image."""
    global model, device
    
    if model is None:
        return {
            "class_index": -1,
            "class_name": "Error",
            "confidence": 0,
            "is_occupied": False,
            "error": "Model not loaded. Place model file in backend/models/"
        }
    
    try:
        import torch
        from torchvision import transforms
        from torchvision.transforms import ToTensor, Resize, Compose
        
        preprocess = Compose([
            ToTensor(),
            Resize((IMG_SIZE, IMG_SIZE)),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
            ])
        
        img_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        img_tensor = preprocess(img_rgb).unsqueeze(0).to(device)
        
        with torch.no_grad():
            outputs = model(img_tensor)
            probs = torch.nn.functional.softmax(outputs, dim=1)
            confidence, predicted_idx = torch.max(probs, 1)
        
        class_idx = predicted_idx.item()
        conf = confidence.item()
        result_text = CLASS_NAMES[class_idx]
        
        # Log ALL class probabilities for debugging
        all_probs = probs[0].cpu().numpy()
        prob_str = " | ".join(
            f"{CLASS_NAMES[i]}: {all_probs[i]*100:.1f}%"
            for i in range(len(CLASS_NAMES))
        )
        print(f"  📊 Model probabilities: {prob_str}")

        # =======================================================
        # 🛠️ NEW: DEBUG IMAGE SAVING (Matches your predict.py)
        # =======================================================
        try:
            # 1. Create a debug folder inside backend
            debug_dir = os.path.join(BACKEND_DIR, 'debug_crops')
            os.makedirs(debug_dir, exist_ok=True)
            
            # 2. Copy the image so we don't mess up the original memory
            debug_img = image.copy()
            
            # 3. Format the label exactly like predict.py
            if conf < 0.75:
                label = f"UnSure {result_text}: {conf*100:.1f}"
                color = (0, 165, 255) # Orange for unsure
            else:
                label = f"{result_text}: {conf*100:.1f}%"
                color = (0, 255, 0) if class_idx == 0 else (0, 0, 255) # Green=Empty, Red=Occupied
            
            # 4. Add text to the image. (Font scale auto-adjusts based on crop size)
            h, w = debug_img.shape[:2]
            font_scale = max(0.5, w / 400.0) 
            thickness = max(1, int(font_scale * 2))
            
            cv2.putText(debug_img, label, (10, max(30, int(h*0.1))), 
                        cv2.FONT_HERSHEY_SIMPLEX, font_scale, color, thickness)
            
            # 5. Save it!
            timestamp = datetime.now().strftime("%H%M%S")
            save_path = os.path.join(debug_dir, f"crop_{timestamp}_{result_text}.jpg")
            cv2.imwrite(save_path, debug_img)
            
            print(f"  📸 Saved debug crop to: {save_path}")
            
        except Exception as draw_error:
            print(f"  ⚠️ Could not save debug image: {draw_error}")
        # =======================================================
        
        return {
            "class_index": class_idx,
            "class_name": result_text,
            "confidence": round(conf, 4),
            "is_occupied": class_idx == 1,
            "is_mock": False,
            "all_probabilities": {
                CLASS_NAMES[i]: round(float(all_probs[i]), 4)
                for i in range(len(CLASS_NAMES))
            }
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
    
# REST API Endpoints

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
            print(f"Floorplan {floorplan_id} stored in MongoDB")
            
        except Exception as e:
            print(f"Failed to store floorplan in MongoDB: {e}")
    
    return jsonify({
        "message": "Floorplan received and saved",
        "floorplan_id": floorplan_id,
        "filename": filename,
        "filepath": filepath,
        "stored_in_db": MONGO_AVAILABLE
    })

@app.route("/submit-floorplan", methods=["POST"])
def submit_floorplan():
    """Submit a floorplan with seats and associate with a stream."""
    import json
    
    if "floorplan" not in request.files:
        return jsonify({"error": "No floorplan image uploaded"}), 400
    
    file = request.files["floorplan"]
    seats_json = request.form.get("seats", "[]")
    stream_url = request.form.get("stream_url", "")
    stream_name = request.form.get("stream_name", "")
    image_width = int(request.form.get("image_width", 0))
    image_height = int(request.form.get("image_height", 0))
    
    if not stream_url:
        return jsonify({"error": "Stream URL is required"}), 400
    
    try:
        seats = json.loads(seats_json)
    except:
        return jsonify({"error": "Invalid seats data"}), 400
    
    # Save floorplan image
    floorplan_dir = os.path.join(BACKEND_DIR, 'floorplans')
    os.makedirs(floorplan_dir, exist_ok=True)
    
    floorplan_id = str(uuid.uuid4())[:8]
    stream_id = str(uuid.uuid4())[:8]
    filename = f"floorplan_{floorplan_id}_{file.filename}"
    filepath = os.path.join(floorplan_dir, filename)
    file.save(filepath)
    
    # Create stream info with custom seat coordinates
    stream_info = {
        "id": stream_id,
        "url": stream_url,
        "name": stream_name or f"Stream {len(active_streams) + 1}",
        "active": True,
        "created_at": datetime.now().isoformat(),
        "floorplan_id": floorplan_id,
        "coordinates": seats
    }
    
    active_streams[stream_id] = stream_info
    
    # Store in MongoDB if available
    if MONGO_AVAILABLE and mongo:
        try:
            with open(filepath, 'rb') as f:
                file_content = f.read()
            
            # Store floorplan with seats
            floorplan_doc = {
                "_id": floorplan_id,
                "filename": file.filename,
                "stored_filename": filename,
                "filepath": filepath,
                "content_type": file.content_type,
                "size_bytes": len(file_content),
                "image_data": base64.b64encode(file_content).decode('utf-8'),
                "image_width": image_width,
                "image_height": image_height,
                "uploaded_at": datetime.now().isoformat(),
                "stream_id": stream_id,
                "stream_url": stream_url,
                "stream_name": stream_name,
                "seats": seats
            }
            mongo.db.floorplans.insert_one(floorplan_doc)
            
            # Store stream config
            stream_doc = {**stream_info, "_id": stream_id}
            mongo.db.streams.update_one(
                {"_id": stream_id},
                {"$set": stream_doc},
                upsert=True
            )
            
            print(f"Floorplan {floorplan_id} with {len(seats)} seats stored in MongoDB")
            print(f"Stream {stream_id} created and associated")
            
        except Exception as e:
            print(f"Failed to store in MongoDB: {e}")
    
    # Start background processing thread for this stream
    thread = threading.Thread(
        target=process_stream,
        args=(stream_id, stream_url, active_streams, occupancy_data,
              seats, SCREENSHOTS_DIR, SCREENSHOT_INTERVAL,
              predict_occupancy, mongo, MONGO_AVAILABLE),
        daemon=True
    )
    thread.start()
    stream_threads[stream_id] = thread
    
    return jsonify({
        "message": "Floorplan and stream configuration saved",
        "floorplan_id": floorplan_id,
        "stream_id": stream_id,
        "stream_name": stream_name,
        "stream_url": stream_url,
        "seats_count": len(seats),
        "stored_in_db": MONGO_AVAILABLE
    }), 201


@app.route('/streams/<stream_id>/seat-mappings', methods=['POST'])
@app.route('/streams/<stream_id>/seat-mappings', methods=['POST'])
def save_seat_mappings(stream_id):
    try:
        data = request.json
        
        # 1. Safely extract mappings whether api.js wrapped them or not
        mappings = data.get('mappings') if 'mappings' in data else data
        
        # 2. Update local memory so the app keeps working
        if stream_id in active_streams:
            active_streams[stream_id]['seat_mappings'] = mappings
            
            # 3. THE FIX: Inject the camera coords directly into the seats list
            # This is exactly where your background worker is looking!
            for seat in active_streams[stream_id].get('coordinates', []):
                seat_id = seat.get('id')
                if seat_id in mappings and mappings[seat_id] is not None:
                    # Save both naming conventions just to be perfectly safe!
                    seat['camera_x'] = mappings[seat_id]['x']
                    seat['camera_y'] = mappings[seat_id]['y']
                    
                    seat['camera_w'] = mappings[seat_id]['width']
                    seat['camera_h'] = mappings[seat_id]['height']
                    
                    seat['camera_width'] = mappings[seat_id]['width']
                    seat['camera_height'] = mappings[seat_id]['height']
                    
                    print(f"✅ SUCCESSFULLY LINKED CAMERA BOX TO: {seat['label']}")
                    
        # 4. Attempt MongoDB save only if available
        if mongo:
            try:
                mongo.db.streams.update_one(
                    {'_id': stream_id}, # Fixed to '_id' to match your stream creation
                    {'$set': {
                        'seat_mappings': mappings, 
                        'coordinates': active_streams[stream_id].get('coordinates', [])
                    }},
                    upsert=True
                )
            except Exception as e:
                print(f"MongoDB save failed, but memory updated: {e}")

        return jsonify({
            "status": "success", 
            "message": "Mappings saved locally",
            "updated_seats": active_streams[stream_id].get('coordinates', [])
        })
    except Exception as e:
        print(f"Critical Error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

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
        args=(stream_id, stream_url, active_streams, occupancy_data,
              DUMMY_COORDINATES, SCREENSHOTS_DIR, SCREENSHOT_INTERVAL,
              predict_occupancy, mongo, MONGO_AVAILABLE),
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
    screenshot_path = save_screenshot(frame, stream_id, SCREENSHOTS_DIR)
    
    # Run prediction
    prediction = predict_occupancy(frame)
    
    # Get frame dimensions
    height, width = frame.shape[:2]
    
    # Build results with coordinates
    results = []
    for coord in DUMMY_COORDINATES:
        seat_result = {
            "id": coord["id"],
            "x": coord["x"],
            "y": coord["y"],
            "width": width,
            "height": height,
            "label": coord["label"],
            "status": prediction["class_index"],
            "confidence": prediction["confidence"]
        }
        results.append(seat_result)
        occupancy_data[stream_id][coord["id"]] = seat_result
    
    return jsonify({
        "stream_id": stream_id,
        "timestamp": datetime.now().isoformat(),
        "screenshot_path": screenshot_path,
        "seats": results
    })

@app.route("/streams/<stream_id>/frame", methods=["GET"])
def get_stream_frame(stream_id):
    """Get a single frame from a stream as base64 for display."""
    if stream_id not in active_streams:
        return jsonify({"error": "Stream not found"}), 404
    
    stream_url = active_streams[stream_id]["url"]
    try:
        frame = capture_frame_from_stream(stream_url)
    except Exception as e:
        return jsonify({"error": f"Failed to capture frame: {e}"}), 500
    
    if frame is None:
        return jsonify({"error": "Failed to capture frame (no data)"}), 500
    
    # Convert frame to JPEG base64
    _, buffer = cv2.imencode('.jpg', frame)
    frame_base64 = base64.b64encode(buffer).decode('utf-8')
    
    # Get stream info including seats
    stream_info = active_streams[stream_id]
    
    return jsonify({
        "stream_id": stream_id,
        "stream_name": stream_info.get("name", ""),
        "stream_url": stream_url,
        "frame": frame_base64,
        "width": frame.shape[1],
        "height": frame.shape[0],
        "seats": stream_info.get("coordinates", []),
        "timestamp": datetime.now().isoformat()
    })

@app.route("/frame-from-url", methods=["POST"])
def get_frame_from_url():
    """Get a single frame from any stream URL as base64."""
    data = request.get_json()
    stream_url = data.get("url", "")
    
    if not stream_url:
        return jsonify({"error": "Stream URL is required"}), 400
    
    frame = capture_frame_from_stream(stream_url)
    
    if frame is None:
        return jsonify({"error": "Failed to capture frame from URL"}), 500
    
    # Convert frame to JPEG base64
    _, buffer = cv2.imencode('.jpg', frame)
    frame_base64 = base64.b64encode(buffer).decode('utf-8')
    
    return jsonify({
        "frame": frame_base64,
        "width": frame.shape[1],
        "height": frame.shape[0],
        "timestamp": datetime.now().isoformat()
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

@app.route("/streams/<stream_id>/latest", methods=["GET"])
def get_stream_latest(stream_id):
    """Get the latest occupancy snapshot for a stream (used by heatmap)."""
    if stream_id not in active_streams:
        return jsonify({"error": "Stream not found"}), 404

    stream_info = active_streams[stream_id]
    seats_dict = occupancy_data.get(stream_id, {})

    # Normalize occupancy data into a dict by seat id
    if isinstance(seats_dict, dict):
        occupancy_by_id = seats_dict
    else:
        occupancy_by_id = {
            s.get("id"): s
            for s in seats_dict
            if isinstance(s, dict) and s.get("id") is not None
        }

    # Always build the seat list from coordinates so entrances stay visible
    seats_list = []
    coords = stream_info.get("coordinates", DUMMY_COORDINATES)
    for coord in coords:
        seat_id = coord.get("id")
        occ = occupancy_by_id.get(seat_id, {})

        def pick(primary, fallback):
            return primary if primary is not None else fallback

        seats_list.append({
            "id": seat_id,
            "x": coord.get("x", 0),
            "y": coord.get("y", 0),
            "width": coord.get("width", 0),
            "height": coord.get("height", 0),
            "label": coord.get("label", ""),
            "type": coord.get("type"),
            "camera_x": pick(coord.get("camera_x"), occ.get("camera_x")),
            "camera_y": pick(coord.get("camera_y"), occ.get("camera_y")),
            "camera_width": pick(coord.get("camera_width"), occ.get("camera_width")),
            "camera_height": pick(coord.get("camera_height"), occ.get("camera_height")),
            "status": occ.get("status", 0),
            "status_name": occ.get("status_name", ""),
            "confidence": occ.get("confidence", 0),
        })

    # Try to capture a live frame for the heatmap background
    frame_base64 = None
    frame_width = 640
    frame_height = 480
    try:
        stream_url = stream_info["url"]
        frame = capture_frame_from_stream(stream_url)
        if frame is not None:
            _, buffer = cv2.imencode('.jpg', frame)
            frame_base64 = base64.b64encode(buffer).decode('utf-8')
            frame_height, frame_width = frame.shape[:2]
    except Exception as e:
        print(f"Frame capture failed for heatmap: {e}")

    # Retrieve the floorplan image for this stream
    floorplan_base64 = None
    floorplan_width = 0
    floorplan_height = 0
    floorplan_id = stream_info.get("floorplan_id")
    if floorplan_id:
        # Try MongoDB first
        if MONGO_AVAILABLE and mongo:
            try:
                fp_doc = mongo.db.floorplans.find_one({"_id": floorplan_id})
                if fp_doc:
                    floorplan_base64 = fp_doc.get("image_data")
                    floorplan_width = fp_doc.get("image_width", 0)
                    floorplan_height = fp_doc.get("image_height", 0)
            except Exception as e:
                print(f"Failed to load floorplan from MongoDB: {e}")

        # Fallback: load from disk if not found in MongoDB
        if not floorplan_base64:
            floorplan_dir = os.path.join(BACKEND_DIR, 'floorplans')
            try:
                for fname in os.listdir(floorplan_dir):
                    if fname.startswith(f"floorplan_{floorplan_id}_"):
                        fpath = os.path.join(floorplan_dir, fname)
                        with open(fpath, 'rb') as f:
                            floorplan_base64 = base64.b64encode(f.read()).decode('utf-8')
                        # Determine image dimensions from the file
                        fp_img = cv2.imread(fpath)
                        if fp_img is not None:
                            floorplan_height, floorplan_width = fp_img.shape[:2]
                        break
            except Exception as e:
                print(f"Failed to load floorplan from disk: {e}")

    return jsonify({
        "stream_id": stream_id,
        "stream_name": stream_info.get("name", ""),
        "timestamp": datetime.now().isoformat(),
        "seats": seats_list,
        "frame": frame_base64,
        "frame_width": frame_width,
        "frame_height": frame_height,
        "floorplan": floorplan_base64,
        "floorplan_width": floorplan_width,
        "floorplan_height": floorplan_height,
    })

# Removed /occupancy/history endpoint - occupancy history is not stored in DB

if __name__ == "__main__":
    print("=" * 60)
    print("Starting Occupancy Detection Server")
    print("=" * 60)
    
    load_model()
    
    print(f"Screenshots will be saved to: {SCREENSHOTS_DIR}")
    print(f"Screenshot interval: {SCREENSHOT_INTERVAL} seconds")
    print(f"Server starting at http://127.0.0.1:5001")
    print("=" * 60)
    
    app.run(debug=True, host='0.0.0.0', port=5001)
