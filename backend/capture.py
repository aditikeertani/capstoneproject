"""
Screenshot Capture Module

This module handles:
1. Capturing frames from video streams
2. Saving screenshots to disk
3. Background stream processing with occupancy detection
"""

import os
import time
import cv2
from datetime import datetime

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


def save_screenshot(frame, stream_id, screenshots_dir):
    """Save a frame as a screenshot."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    screenshot_path = os.path.join(screenshots_dir, f"{stream_id}_{timestamp}.jpg")
    cv2.imwrite(screenshot_path, frame)
    print(f"Screenshot saved: {screenshot_path}")
    return screenshot_path


def process_stream(stream_id, stream_url, active_streams, occupancy_data, 
                   coordinates, screenshots_dir, screenshot_interval,
                   predict_fn, mongo=None, mongo_available=False):
    """Background thread: capture frames and run detection periodically."""
    print(f"Starting stream processing for {stream_id}: {stream_url}")
    
    while stream_id in active_streams and active_streams[stream_id].get('active', False):
        try:
            frame = capture_frame_from_stream(stream_url)
            
            if frame is not None:
                # Save screenshot
                screenshot_path = save_screenshot(frame, stream_id, screenshots_dir)
                # Run prediction
                prediction = predict_fn(frame)
                # Get frame dimensions
                height, width = frame.shape[:2]
                # Update occupancy data
                seats_data = []
                for coord in coordinates:
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
                    occupancy_data[stream_id][coord["id"]] = seat_result
                    seats_data.append(seat_result)
                # Store in MongoDB if available
                if mongo_available and mongo:
                    try:
                        occupancy_doc = {
                            "stream_id": stream_id,
                            "timestamp": datetime.now().isoformat(),
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
                        print(f"Failed to store occupancy in MongoDB: {e}")
                print(f"Occupancy updated for {stream_id}: {prediction['class_name']}")
            else:
                print(f"No frame captured for {stream_id}")
        except Exception as e:
            print(f"Error processing stream {stream_id}: {e}")
        time.sleep(screenshot_interval)
    print(f"Stream processing stopped for {stream_id}")
