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
import av
from datetime import datetime

def capture_frame_from_stream(stream_url):
    frame_img = None
    video = av.open(stream_url, 'r')
    for packet in video.demux():
        print(f"Demuxing packet {packet}")
        for frame in packet.decode():
            print(f"Decoding frame {frame}")
            if type(frame) is av.video.frame.VideoFrame:
                if frame.key_frame:
                    frame_img = frame.to_ndarray()
                    # Close Connection to RTSP Source
                    break
        if frame_img is not None:
            break

    if not video or frame_img is None:
        return None
    return frame_img
    #except Exception as e:
    #    print(f"Error capturing frame: {e}")
    #    return None


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
                
                # Get frame dimensions
                frame_height, frame_width = frame.shape[:2]
                
                # Get latest coordinates from active_streams (may have been updated with camera coords)
                current_coords = active_streams[stream_id].get('coordinates', coordinates)
                
                # Update occupancy data for each seat
                seats_data = []
                for coord in current_coords:
                    seat_id = coord.get("id", "unknown")
                    
                    # Check if seat has camera coordinates (mappings from Feed Selection)
                    camera_x = coord.get("camera_x")
                    camera_y = coord.get("camera_y")
                    camera_width = coord.get("camera_width")
                    camera_height = coord.get("camera_height")
                    
                    # If camera coordinates exist, crop that region for prediction
                    if all(v is not None and v > 0 for v in [camera_x, camera_y, camera_width, camera_height]):
                        # Ensure coordinates are within frame bounds
                        x1 = max(0, int(camera_x))
                        y1 = max(0, int(camera_y))
                        x2 = min(frame_width, int(camera_x + camera_width))
                        y2 = min(frame_height, int(camera_y + camera_height))
                        
                        # Crop the region
                        cropped_frame = frame[y1:y2, x1:x2]
                        
                        if cropped_frame.size > 0:
                            # Run prediction on cropped region
                            prediction = predict_fn(cropped_frame)
                            print(f"Predicted seat {coord.get('label', seat_id)}: {prediction['class_name']} (camera region)")
                        else:
                            # Fallback to full frame if crop fails
                            prediction = predict_fn(frame)
                            print(f"Predicted seat {coord.get('label', seat_id)}: {prediction['class_name']} (full frame - crop failed)")
                    else:
                        # No camera coordinates, use full frame prediction
                        prediction = predict_fn(frame)
                        print(f"Predicted seat {coord.get('label', seat_id)}: {prediction['class_name']} (full frame - no mapping)")
                    
                    # Build seat result with all coordinates
                    seat_result = {
                        "id": seat_id,
                        # Floorplan coordinates
                        "x": coord.get("x", 0),
                        "y": coord.get("y", 0),
                        "width": coord.get("width", 0),
                        "height": coord.get("height", 0),
                        # Camera coordinates
                        "camera_x": camera_x,
                        "camera_y": camera_y,
                        "camera_width": camera_width,
                        "camera_height": camera_height,
                        # Seat info
                        "label": coord.get("label", "Unknown"),
                        # Prediction result
                        "status": prediction["class_index"],
                        "status_name": prediction["class_name"],
                        "confidence": prediction["confidence"]
                    }
                    occupancy_data[stream_id][seat_id] = seat_result
                    seats_data.append(seat_result)
                
                # Occupancy data is kept in-memory only (not persisted to MongoDB)
                # This avoids storing large amounts of historical data
                
                print(f"Occupancy updated for {stream_id}: {len(seats_data)} seats processed")
            else:
                print(f"No frame captured for {stream_id}")
        except Exception as e:
            print(f"Error processing stream {stream_id}: {e}")
        
        time.sleep(screenshot_interval)
    
    print(f"Stream processing stopped for {stream_id}")

