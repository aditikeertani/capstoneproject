from flask_pymongo import PyMongo
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # allows React (localhost:3000) to talk to Flask

@app.route("/")
def health_check():
    return jsonify({
        "status": "running",
        "message": "Flask server is running successfully"
    })

@app.route("/upload-floorplan", methods=["POST"])
def upload_floorplan():
    if "floorplan" not in request.files:
        return jsonify({"error": "No floorplan uploaded"}), 400

    file = request.files["floorplan"]
    return jsonify({
        "message": "Floorplan received",
        "filename": file.filename
    })

@app.route("/assign-stream", methods=["POST"])
def assign_stream():
    data = request.json
    return jsonify({
        "message": "Stream assigned",
        "data": data
    })

if __name__ == "__main__":
    print("🚀 Starting Flask server at http://127.0.0.1:5000")
    app.run(debug=True)
