from flask_pymongo import PyMongo
from pymongo.errors import AutoReconnect, ConnectionFailure, ServerSelectionTimeoutError
from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import sys
import threading
import time
import cv2
import base64
import numpy as np
from datetime import datetime, timedelta
from collections import defaultdict
import uuid
import math
import torch
import numpy as np
from torchvision.transforms import ToTensor, Resize, Compose
from model import Classifier  
from pathlib import Path
from torchvision import transforms
from werkzeug.security import generate_password_hash, check_password_hash
import jwt
import re
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
MONGO_SERVER_SELECTION_TIMEOUT_MS = 2000
MONGO_CONNECT_TIMEOUT_MS = 2000
MONGO_FAILFAST_EXCEPTIONS = (
    AutoReconnect,
    ConnectionFailure,
    ServerSelectionTimeoutError,
)

def disable_mongo(reason):
    global MONGO_AVAILABLE, mongo
    if MONGO_AVAILABLE or mongo is not None:
        print(f"MongoDB disabled (fail-fast): {reason}. Falling back to memory.")
    MONGO_AVAILABLE = False
    mongo = None

def init_mongo(flask_app):
    try:
        mongo_client = PyMongo(
            flask_app,
            serverSelectionTimeoutMS=MONGO_SERVER_SELECTION_TIMEOUT_MS,
            connectTimeoutMS=MONGO_CONNECT_TIMEOUT_MS,
        )
        # Force a quick server selection to fail fast if MongoDB is offline.
        mongo_client.cx.admin.command("ping")
        return mongo_client, True
    except MONGO_FAILFAST_EXCEPTIONS as e:
        print(f"MongoDB not available (fail-fast): {e}. Running without database.")
    except Exception as e:
        print(f"MongoDB initialization failed: {e}. Running without database.")
    return None, False

mongo, MONGO_AVAILABLE = init_mongo(app)

# Auth configuration
JWT_ISSUER = "occupancy-app"
JWT_EXPIRES_MINUTES = int(os.environ.get("JWT_EXPIRES_MINUTES", "10080"))  # 7 days default

def get_jwt_secret():
    secret = os.environ.get("JWT_SECRET")
    if not secret:
        secret = "dev-secret-change"
        print("⚠️ JWT_SECRET not set. Using a dev-only default secret.")
    return secret

def create_jwt(user_id, email, name=None):
    now = datetime.utcnow()
    payload = {
        "sub": str(user_id),
        "email": email,
        "name": name or "",
        "iss": JWT_ISSUER,
        "iat": now,
        "exp": now + timedelta(minutes=JWT_EXPIRES_MINUTES),
    }
    token = jwt.encode(payload, get_jwt_secret(), algorithm="HS256")
    if isinstance(token, bytes):
        token = token.decode("utf-8")
    return token

def decode_jwt(token):
    return jwt.decode(
        token,
        get_jwt_secret(),
        algorithms=["HS256"],
        issuer=JWT_ISSUER,
    )

def normalize_email(value):
    return (value or "").strip().lower()

def is_valid_email(value):
    if not value:
        return False
    return re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", value) is not None

def require_auth():
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None, jsonify({"error": "Missing token"}), 401
    token = auth_header.split(" ", 1)[1].strip()
    try:
        payload = decode_jwt(token)
        return payload, None, None
    except jwt.ExpiredSignatureError:
        return None, jsonify({"error": "Token expired"}), 401
    except jwt.InvalidTokenError:
        return None, jsonify({"error": "Invalid token"}), 401

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

# Floorplan helpers
def load_floorplan_asset(floorplan_id):
    """Load floorplan image and metadata from MongoDB or disk."""
    floorplan_base64 = None
    floorplan_width = 0
    floorplan_height = 0
    floorplan_seats = None

    if not floorplan_id:
        return floorplan_base64, floorplan_width, floorplan_height, floorplan_seats

    # Try MongoDB first
    if MONGO_AVAILABLE and mongo:
        try:
            fp_doc = mongo.db.floorplans.find_one({"_id": floorplan_id})
            if fp_doc:
                floorplan_base64 = fp_doc.get("image_data")
                floorplan_width = fp_doc.get("image_width", 0)
                floorplan_height = fp_doc.get("image_height", 0)
                floorplan_seats = fp_doc.get("seats")
        except MONGO_FAILFAST_EXCEPTIONS as e:
            disable_mongo(e)
        except Exception as e:
            print(f"Failed to load floorplan from MongoDB: {e}")

    # Fallback: load from disk if not found in MongoDB
    if not floorplan_base64:
        floorplan_dir = os.path.join(BACKEND_DIR, 'floorplans')
        try:
            if os.path.isdir(floorplan_dir):
                candidates = [
                    fname for fname in os.listdir(floorplan_dir)
                    if fname.startswith(f"floorplan_{floorplan_id}_")
                ]
                if candidates:
                    candidates.sort(
                        key=lambda fname: os.path.getmtime(os.path.join(floorplan_dir, fname)),
                        reverse=True
                    )
                    fpath = os.path.join(floorplan_dir, candidates[0])
                    with open(fpath, 'rb') as f:
                        floorplan_base64 = base64.b64encode(f.read()).decode('utf-8')
                    fp_img = cv2.imread(fpath)
                    if fp_img is not None:
                        floorplan_height, floorplan_width = fp_img.shape[:2]
        except Exception as e:
            print(f"Failed to load floorplan from disk: {e}")

    return floorplan_base64, floorplan_width, floorplan_height, floorplan_seats

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

@app.route("/auth/register", methods=["POST"])
def register_account():
    if not MONGO_AVAILABLE or not mongo:
        return jsonify({"error": "MongoDB not available"}), 503

    data = request.get_json(silent=True) or {}
    email = normalize_email(data.get("email"))
    password = data.get("password") or ""
    name = (data.get("name") or "").strip()

    if not is_valid_email(email):
        return jsonify({"error": "Valid email is required"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    try:
        existing = mongo.db.users.find_one({"email": email})
        if existing:
            return jsonify({"error": "Email already registered"}), 409

        password_hash = generate_password_hash(password)
        user_doc = {
            "email": email,
            "password_hash": password_hash,
            "name": name,
            "created_at": datetime.utcnow().isoformat(),
        }
        result = mongo.db.users.insert_one(user_doc)
        user_id = str(result.inserted_id)
        token = create_jwt(user_id, email, name)

        return jsonify({
            "token": token,
            "user": {"id": user_id, "email": email, "name": name},
        })
    except MONGO_FAILFAST_EXCEPTIONS as e:
        disable_mongo(e)
        return jsonify({"error": "MongoDB not available"}), 503
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/auth/login", methods=["POST"])
def login_account():
    if not MONGO_AVAILABLE or not mongo:
        return jsonify({"error": "MongoDB not available"}), 503

    data = request.get_json(silent=True) or {}
    email = normalize_email(data.get("email"))
    password = data.get("password") or ""

    if not is_valid_email(email) or not password:
        return jsonify({"error": "Email and password are required"}), 400

    try:
        user = mongo.db.users.find_one({"email": email})
        if not user or not check_password_hash(user.get("password_hash", ""), password):
            return jsonify({"error": "Invalid email or password"}), 401

        user_id = str(user.get("_id"))
        name = user.get("name", "")
        token = create_jwt(user_id, email, name)

        return jsonify({
            "token": token,
            "user": {"id": user_id, "email": email, "name": name},
        })
    except MONGO_FAILFAST_EXCEPTIONS as e:
        disable_mongo(e)
        return jsonify({"error": "MongoDB not available"}), 503
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/auth/me", methods=["GET"])
def auth_me():
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return jsonify({"error": "Missing token"}), 401
    token = auth_header.split(" ", 1)[1].strip()
    try:
        payload = decode_jwt(token)
        return jsonify({"user": payload})
    except jwt.ExpiredSignatureError:
        return jsonify({"error": "Token expired"}), 401
    except jwt.InvalidTokenError:
        return jsonify({"error": "Invalid token"}), 401

@app.route("/upload-floorplan", methods=["POST"])
def upload_floorplan():
    """Upload a floorplan image and store in MongoDB."""
    user, resp, status = require_auth()
    if resp:
        return resp, status
    user_id = user.get("sub")

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
                "coordinates": [],  # Will be populated when user maps seats
                "created_by": user_id,
            }
            
            mongo.db.floorplans.insert_one(floorplan_doc)
            print(f"Floorplan {floorplan_id} stored in MongoDB")
            
        except MONGO_FAILFAST_EXCEPTIONS as e:
            disable_mongo(e)
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

    user, resp, status = require_auth()
    if resp:
        return resp, status
    user_id = user.get("sub")
    
    if "floorplan" not in request.files:
        return jsonify({"error": "No floorplan image uploaded"}), 400
    
    file = request.files["floorplan"]
    seats_json = request.form.get("seats", "[]")
    stream_url = request.form.get("stream_url", "")
    stream_name = request.form.get("stream_name", "")
    floor_name = request.form.get("floor_name", "")
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
    
    provided_floorplan_id = request.form.get("floorplan_id")
    if provided_floorplan_id:
        provided_floorplan_id = str(provided_floorplan_id).strip()
    floorplan_id = provided_floorplan_id or str(uuid.uuid4())[:8]
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
        "coordinates": seats,
        "floor_name": floor_name
    }
    
    active_streams[stream_id] = stream_info
    
    # Store in MongoDB if available
    if MONGO_AVAILABLE and mongo:
        try:
            if provided_floorplan_id:
                existing = mongo.db.floorplans.find_one({"_id": floorplan_id})
                if existing and existing.get("created_by") and existing.get("created_by") != user_id:
                    return jsonify({"error": "Not authorized for this floorplan"}), 403

            with open(filepath, 'rb') as f:
                file_content = f.read()
            
            # Store floorplan with seats (upsert by floorplan_id)
            floorplan_update = {
                "filename": file.filename,
                "stored_filename": filename,
                "filepath": filepath,
                "content_type": file.content_type,
                "size_bytes": len(file_content),
                "image_data": base64.b64encode(file_content).decode('utf-8'),
                "image_width": image_width,
                "image_height": image_height,
                "uploaded_at": datetime.now().isoformat(),
                "created_by": user_id,
                # Keep last stream details for backward compatibility
                "stream_id": stream_id,
                "stream_url": stream_url,
                "stream_name": stream_name,
                "floor_name": floor_name,
                "seats": seats
            }
            mongo.db.floorplans.update_one(
                {"_id": floorplan_id},
                {
                    "$set": floorplan_update,
                    "$addToSet": {"stream_ids": stream_id}
                },
                upsert=True
            )
            
            # Store stream config
            stream_doc = {**stream_info, "_id": stream_id, "created_by": user_id}
            mongo.db.streams.update_one(
                {"_id": stream_id},
                {"$set": stream_doc},
                upsert=True
            )
            
            print(f"Floorplan {floorplan_id} with {len(seats)} seats stored in MongoDB")
            print(f"Stream {stream_id} created and associated")
            
        except MONGO_FAILFAST_EXCEPTIONS as e:
            disable_mongo(e)
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
    user, resp, status = require_auth()
    if resp:
        return resp, status
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
            except MONGO_FAILFAST_EXCEPTIONS as e:
                disable_mongo(e)
            except Exception as e:
                print(f"MongoDB save failed, but memory updated: {e}")

        mappings_count = 0
        if isinstance(mappings, dict):
            mappings_count = sum(1 for value in mappings.values() if value)
        elif isinstance(mappings, list):
            mappings_count = sum(1 for value in mappings if value)

        return jsonify({
            "status": "success", 
            "message": "Mappings saved locally",
            "updated_seats": active_streams[stream_id].get('coordinates', []),
            "mappings_count": mappings_count,
        })
    except Exception as e:
        print(f"Critical Error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/floorplans", methods=["GET"])
def get_floorplans():
    """Get all uploaded floorplans."""
    user, resp, status = require_auth()
    if resp:
        return resp, status
    user_id = user.get("sub")

    if not MONGO_AVAILABLE or not mongo:
        return jsonify({"error": "MongoDB not available", "floorplans": []}), 200
    
    try:
        floorplans = list(
            mongo.db.floorplans.find(
                {"created_by": user_id},
                {"image_data": 0}
            )
        )  # Exclude image data for list
        # Convert ObjectId to string if needed
        for fp in floorplans:
            fp["id"] = str(fp.pop("_id"))
        return jsonify({"floorplans": floorplans, "count": len(floorplans)})
    except MONGO_FAILFAST_EXCEPTIONS as e:
        disable_mongo(e)
        return jsonify({"error": "MongoDB not available", "floorplans": []}), 200
    except Exception as e:
        return jsonify({"error": str(e), "floorplans": []}), 500

@app.route("/floorplans/<floorplan_id>", methods=["GET"])
def get_floorplan(floorplan_id):
    """Get a specific floorplan by ID."""
    user, resp, status = require_auth()
    if resp:
        return resp, status
    user_id = user.get("sub")

    if not MONGO_AVAILABLE or not mongo:
        return jsonify({"error": "MongoDB not available"}), 503
    
    try:
        floorplan = mongo.db.floorplans.find_one({"_id": floorplan_id, "created_by": user_id})
        if not floorplan:
            return jsonify({"error": "Floorplan not found"}), 404
        floorplan["id"] = str(floorplan.pop("_id"))
        return jsonify(floorplan)
    except MONGO_FAILFAST_EXCEPTIONS as e:
        disable_mongo(e)
        return jsonify({"error": "MongoDB not available"}), 503
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
        except MONGO_FAILFAST_EXCEPTIONS as e:
            disable_mongo(e)
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

@app.route("/api/auto-generate-floorplan", methods=["POST"])
def auto_generate_floorplan():
    """Auto-detect table/seat shapes from an uploaded seating chart image."""
    file = request.files.get("floorplan") or request.files.get("image") or request.files.get("file")
    if not file:
        return jsonify({"error": "No floorplan image uploaded"}), 400

    file_bytes = file.read()
    if not file_bytes:
        return jsonify({"error": "Uploaded file is empty"}), 400

    np_img = np.frombuffer(file_bytes, np.uint8)
    img = cv2.imdecode(np_img, cv2.IMREAD_COLOR)
    if img is None:
        return jsonify({"error": "Failed to decode image"}), 400

    tracking_mode = request.form.get("trackingMode", "tables").strip().lower()
    if tracking_mode not in ["tables", "seats"]:
        tracking_mode = "tables"

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    if tracking_mode == "tables":
        _, thresh = cv2.threshold(
            blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
        )
        contours, _ = cv2.findContours(
            thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        min_area = 1000
        max_area = 200000
    else:
        edges = cv2.Canny(blurred, 50, 150)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        edges = cv2.dilate(edges, kernel, iterations=1)
        contours, _ = cv2.findContours(
            edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE
        )
        min_area = 100
        max_area = 900

    shapes = []
    timestamp = int(time.time() * 1000)

    for contour in contours:
        area = cv2.contourArea(contour)
        if area < min_area or area > max_area:
            continue

        x, y, w, h = cv2.boundingRect(contour)

        shape_type = "rect"
        if tracking_mode == "tables":
            aspect_ratio = w / float(h) if h else 0
            perimeter = cv2.arcLength(contour, True)
            approx = (
                cv2.approxPolyDP(contour, 0.02 * perimeter, True)
                if perimeter > 0
                else []
            )
            if 0.85 <= aspect_ratio <= 1.15 and perimeter > 0:
                circularity = (4 * math.pi * area) / (perimeter * perimeter)
                if circularity >= 0.7 or len(approx) > 6:
                    shape_type = "circle"

        shapes.append({
            "id": f"shape_{timestamp}",
            "type": shape_type,
            "x": int(x),
            "y": int(y),
            "width": int(w),
            "height": int(h),
            "label": "Table" if tracking_mode == "tables" else "Seat"
        })

    # Sort and relabel for stable ordering
    shapes.sort(key=lambda s: (s["y"], s["x"]))
    label_prefix = "Table" if tracking_mode == "tables" else "Seat"
    for idx, shape in enumerate(shapes, start=1):
        shape["label"] = f"{label_prefix} {idx}"
        shape["id"] = f"shape_{timestamp}_{idx}"

    return jsonify(shapes)

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

        status = occ.get("status")
        if status is None:
            status = occ.get("class_index", 0)
        try:
            status = int(status)
        except Exception:
            status = 0

        confidence = occ.get("confidence", 0)
        if status == -1:
            confidence = 0

        status_name = occ.get("status_name")
        if not status_name:
            if status == 1:
                status_name = "Occupied"
            elif status == 0:
                status_name = "Unoccupied"
            elif status == -1:
                status_name = "Offline"
            else:
                status_name = ""

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
            "status": status,
            "status_name": status_name,
            "confidence": confidence,
            "is_occupied": status == 1,
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
    floorplan_id = stream_info.get("floorplan_id")
    floorplan_base64, floorplan_width, floorplan_height, _ = load_floorplan_asset(floorplan_id)

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

@app.route("/floorplans/<floorplan_id>/latest", methods=["GET"])
def get_floorplan_latest(floorplan_id):
    """Get the latest aggregated occupancy snapshot for a floorplan."""
    user, resp, status = require_auth()
    if resp:
        return resp, status
    user_id = user.get("sub")

    if not MONGO_AVAILABLE or not mongo:
        return jsonify({"error": "MongoDB not available"}), 503

    try:
        floorplan_doc = mongo.db.floorplans.find_one(
            {"_id": floorplan_id, "created_by": user_id},
            {"image_data": 0}
        )
        if not floorplan_doc:
            return jsonify({"error": "Floorplan not found"}), 404
    except MONGO_FAILFAST_EXCEPTIONS as e:
        disable_mongo(e)
        return jsonify({"error": "MongoDB not available"}), 503
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # Collect streams tied to this floorplan
    streams_for_floor = [
        s for s in active_streams.values()
        if s.get("floorplan_id") == floorplan_id
    ]
    stream_ids = [s.get("id") for s in streams_for_floor if s.get("id")]

    # Base seat list
    base_seats = None
    if streams_for_floor:
        base_seats = streams_for_floor[0].get("coordinates", None)
    if base_seats is None:
        _, _, _, stored_seats = load_floorplan_asset(floorplan_id)
        base_seats = stored_seats if stored_seats is not None else DUMMY_COORDINATES

    # Aggregate occupancy using occupied-favored rule
    aggregated = {}
    for seat in base_seats:
        seat_id = seat.get("id")
        if seat_id is None:
            continue

        saw_occupied = False
        saw_unoccupied = False
        saw_offline = False
        agg_confidence = 0
        for stream_id in stream_ids:
            occ = occupancy_data.get(stream_id, {}).get(seat_id)
            if not occ:
                continue
            occ_status = occ.get("status")
            if occ_status is None:
                occ_status = occ.get("class_index")
            try:
                occ_status = int(occ_status)
            except Exception:
                continue

            if occ_status == 1:
                saw_occupied = True
            elif occ_status == 0:
                saw_unoccupied = True
            elif occ_status == -1:
                saw_offline = True
            occ_conf = occ.get("confidence")
            try:
                if occ_conf is not None:
                    agg_confidence = max(agg_confidence, float(occ_conf))
            except Exception:
                pass

        if saw_occupied:
            agg_status = 1
        elif saw_unoccupied:
            agg_status = 0
        elif saw_offline:
            agg_status = -1
        else:
            agg_status = 0

        if agg_status == -1:
            agg_confidence = 0

        if agg_status == 1:
            status_name = "Occupied"
        elif agg_status == 0:
            status_name = "Unoccupied"
        else:
            status_name = "Offline"

        aggregated[seat_id] = {
            "status": agg_status,
            "status_name": status_name,
            "confidence": agg_confidence,
            "is_occupied": agg_status == 1,
        }

    seats_list = []
    for seat in base_seats:
        seat_id = seat.get("id")
        agg = aggregated.get(seat_id, {})
        seats_list.append({
            "id": seat_id,
            "x": seat.get("x", 0),
            "y": seat.get("y", 0),
            "width": seat.get("width", 0),
            "height": seat.get("height", 0),
            "label": seat.get("label", ""),
            "type": seat.get("type"),
            "status": agg.get("status", 0),
            "status_name": agg.get("status_name", ""),
            "confidence": agg.get("confidence", 0),
            "is_occupied": agg.get("is_occupied", agg.get("status", 0) == 1),
        })

    floorplan_base64, floorplan_width, floorplan_height, _ = load_floorplan_asset(floorplan_id)

    return jsonify({
        "floorplan_id": floorplan_id,
        "stream_ids": stream_ids,
        "timestamp": datetime.now().isoformat(),
        "seats": seats_list,
        "floorplan": floorplan_base64,
        "floorplan_width": floorplan_width,
        "floorplan_height": floorplan_height,
        # Do not return a camera frame for aggregated views
        "frame": None,
        "frame_width": 0,
        "frame_height": 0,
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
