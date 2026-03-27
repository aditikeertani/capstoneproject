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

def is_entrance(coord):
    if not coord:
        return False
    t = coord.get("type")
    if t == "entrance":
        return True
    cid = coord.get("id")
    if isinstance(cid, str) and cid.startswith("entrance"):
        return True
    label = coord.get("label")
    if isinstance(label, str) and label.lower().startswith("entrance"):
        return True
    return False

def build_offline_seat_result(coord):
    seat_id = coord.get("id", "unknown")
    return {
        "id": seat_id,
        # Floorplan coordinates
        "x": coord.get("x", 0),
        "y": coord.get("y", 0),
        "width": coord.get("width", 0),
        "height": coord.get("height", 0),
        # Camera coordinates (if available)
        "camera_x": coord.get("camera_x"),
        "camera_y": coord.get("camera_y"),
        "camera_width": coord.get("camera_width"),
        "camera_height": coord.get("camera_height"),
        # Seat info
        "label": coord.get("label", "Unknown"),
        # Offline status
        "status": -1,
        "status_name": "Offline",
        "confidence": 0,
        "is_occupied": False,
    }

def mark_stream_offline(stream_id, active_streams, occupancy_data, coordinates, reason=None):
    stream_info = active_streams.get(stream_id, {})
    current_coords = stream_info.get("coordinates", coordinates) or []
    stream_data = occupancy_data.setdefault(stream_id, {})

    for coord in current_coords:
        if is_entrance(coord):
            continue
        seat_id = coord.get("id", "unknown")
        existing = stream_data.get(seat_id)
        if isinstance(existing, dict):
            existing_status = existing.get("status")
            if existing_status in (0, 1):
                # Keep last known occupancy if the stream drops.
                continue
        stream_data[seat_id] = build_offline_seat_result(coord)

    if reason:
        print(f"Stream {stream_id} offline: {reason}")

def capture_frame_from_stream(stream_url, max_wait_s=10.0, max_packets=200, return_meta=False):
    if stream_url is None:
        meta = {"transport": None, "error": "no_url"}
        return (None, meta) if return_meta else None
    clean_url = str(stream_url).strip().strip('"').strip("'").rstrip("\\")
    fallback_frame = None
    last_frame = None
    start_time = time.time()
    meta = {"transport": None, "error": None}

    def try_capture(transport):
        nonlocal fallback_frame, last_frame, start_time
        try:
            video = av.open(
                clean_url,
                "r",
                options={
                    "rtsp_transport": transport,
                    "stimeout": "10000000",
                    "rw_timeout": "10000000",
                },
            )
        except Exception as e:
            meta["error"] = f"rtsp_open_failed_{transport}: {e}"
            print(f"RTSP open failed for {clean_url} ({transport}): {e}")
            return False

        try:
            packets_processed = 0
            for packet in video.demux():
                packets_processed += 1
                for frame in packet.decode():
                    if type(frame) is not av.video.frame.VideoFrame:
                        continue

                    img = frame.to_ndarray(format="bgr24")
                    if fallback_frame is None:
                        fallback_frame = img
                    last_frame = img

                if packets_processed >= max_packets:
                    break

                if (time.time() - start_time) >= max_wait_s:
                    break
        except Exception as e:
            meta["error"] = f"rtsp_decode_failed_{transport}: {e}"
            print(f"Error capturing frame from {clean_url} ({transport}): {e}")
        finally:
            try:
                video.close()
            except Exception:
                pass
        return last_frame is not None or fallback_frame is not None

    # Try TCP first, then UDP as fallback.
    if try_capture("tcp"):
        meta["transport"] = "tcp"
        meta["error"] = None
    else:
        if try_capture("udp"):
            meta["transport"] = "udp"
            meta["error"] = None

    if meta["transport"] is None and meta["error"] is None:
        meta["error"] = "no_frame"

    result = last_frame if last_frame is not None else fallback_frame
    return (result, meta) if return_meta else result


def save_screenshot(frame, stream_id, screenshots_dir):
    """Save a frame as a screenshot."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    screenshot_path = os.path.join(screenshots_dir, f"{stream_id}_{timestamp}.png")
    cv2.imwrite(screenshot_path, frame)
    print(f"Screenshot saved: {screenshot_path}")
    return screenshot_path


def _prepare_png_for_model(frame):
    """Encode to PNG and decode back to mimic PNG input for the model."""
    try:
        ok, buffer = cv2.imencode(".png", frame)
        if not ok:
            return frame
        decoded = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
        return decoded if decoded is not None else frame
    except Exception:
        return frame


def process_stream(stream_id, stream_url, active_streams, occupancy_data,
                   coordinates, screenshots_dir, screenshot_interval,
                   predict_fn, stabilize_fn=None, mongo=None, mongo_available=False,
                   latest_frames=None, stream_status=None):
    """Background thread: capture frames and run detection periodically."""
    print(f"Starting stream processing for {stream_id}: {stream_url}")
    
    while stream_id in active_streams and active_streams[stream_id].get('active', False):
        try:
            stream_info = active_streams.get(stream_id, {})
            current_url = stream_info.get("url") or stream_url
            frame, meta = capture_frame_from_stream(current_url, return_meta=True)
            now_ts = time.time()
            used_cache = False
            allow_cache_fallback = str(os.environ.get("ALLOW_CACHE_FALLBACK", "0")).lower() in ("1", "true", "yes")
            if allow_cache_fallback and frame is None and latest_frames is not None:
                cached = latest_frames.get(stream_id)
                if isinstance(cached, dict):
                    cached_frame = cached.get("frame")
                    if cached_frame is not None:
                        frame = cached_frame
                        used_cache = True
                        if meta is None:
                            meta = {}
                        meta.setdefault("error", "cache_fallback")
                        meta.setdefault("transport", "cache")

            if frame is None:
                if stream_status is not None:
                    status = stream_status.setdefault(stream_id, {})
                    status["status"] = "offline"
                    status["last_attempt_ts"] = now_ts
                    status["last_error"] = meta.get("error") or "no_frame"
                    status["last_transport"] = meta.get("transport")
                mark_stream_offline(
                    stream_id,
                    active_streams,
                    occupancy_data,
                    coordinates,
                    reason=meta.get("error") or "no_frame",
                )
            else:
                if stream_status is not None:
                    status = stream_status.setdefault(stream_id, {})
                    status["status"] = "stale" if used_cache else "online"
                    status["last_frame_ts"] = now_ts
                    status["last_attempt_ts"] = now_ts
                    status["last_error"] = meta.get("error") if used_cache and isinstance(meta, dict) else None
                    status["last_transport"] = meta.get("transport") if isinstance(meta, dict) else None
                # Save screenshot
                screenshot_path = save_screenshot(frame, stream_id, screenshots_dir)
                
                # Get frame dimensions
                frame_height, frame_width = frame.shape[:2]

                # Cache latest frame for fast UI access (Feed Selection)
                if latest_frames is not None:
                    try:
                        latest_frames[stream_id] = {
                            "frame": frame,
                            "width": frame_width,
                            "height": frame_height,
                            "timestamp": time.time(),
                        }
                    except Exception as cache_err:
                        print(f"Failed to cache latest frame for {stream_id}: {cache_err}")
                
                # Get latest coordinates from active_streams (may have been updated with camera coords)
                current_coords = active_streams[stream_id].get('coordinates', coordinates)
                
                # Update occupancy data for each seat
                seats_data = []
                for coord in current_coords:
                    if is_entrance(coord):
                        continue
                    seat_id = coord.get("id", "unknown")
                    
                    # Check if seat has camera coordinates (mappings from Feed Selection)
                    camera_x = coord.get("camera_x")
                    camera_y = coord.get("camera_y")
                    camera_width = coord.get("camera_width")
                    camera_height = coord.get("camera_height")
                    
                    print(f"  🔍 Seat {coord.get('label', seat_id)}: camera_x={camera_x}, camera_y={camera_y}, camera_w={camera_width}, camera_h={camera_height}")
                    
                    # If camera coordinates exist, crop that region for prediction
                    has_camera_coords = all(
                        v is not None and v > 0 for v in [camera_x, camera_y, camera_width, camera_height]
                    )

                    if has_camera_coords:
                        # Ensure coordinates are within frame bounds
                        x1 = max(0, int(camera_x))
                        y1 = max(0, int(camera_y))
                        x2 = min(frame_width, int(camera_x + camera_width))
                        y2 = min(frame_height, int(camera_y + camera_height))
                        
                        print(f"  ✅ Cropping [{y1}:{y2}, {x1}:{x2}] from {frame_width}x{frame_height} frame")
                        
                        # Crop the region
                        cropped_frame = frame[y1:y2, x1:x2]
                        
                        if cropped_frame.size > 0:
                            # Run prediction on cropped region
                            prediction = predict_fn(_prepare_png_for_model(cropped_frame))
                            print(f"Predicted seat {coord.get('label', seat_id)}: {prediction['class_name']} (camera region)")
                        else:
                            # Fallback to full frame if crop fails
                            prediction = predict_fn(_prepare_png_for_model(frame))
                            print(f"Predicted seat {coord.get('label', seat_id)}: {prediction['class_name']} (full frame - crop failed)")
                    else:
                        # No camera coordinates: skip prediction for this seat in this stream
                        if seat_id in occupancy_data.get(stream_id, {}):
                            occupancy_data[stream_id].pop(seat_id, None)
                        print(f"  ❌ No camera coords → skipping prediction for {coord.get('label', seat_id)}")
                        continue
                    
                    raw_status = prediction.get("class_index", -1)
                    raw_confidence = prediction.get("confidence", 0)
                    if stabilize_fn:
                        stable = stabilize_fn(stream_id, seat_id, raw_status, raw_confidence)
                        status = stable.get("status", raw_status)
                        status_name = stable.get("status_name", prediction.get("class_name", "Offline"))
                        confidence = stable.get("confidence", raw_confidence)
                        is_occupied = stable.get("is_occupied", bool(prediction.get("is_occupied", False)))
                    else:
                        status = raw_status
                        status_name = prediction.get("class_name", "Offline")
                        confidence = raw_confidence
                        is_occupied = bool(prediction.get("is_occupied", False))

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
                        "status": status,
                        "status_name": status_name,
                        "confidence": confidence,
                        "is_occupied": is_occupied,
                    }
                    if seat_result["status"] == -1:
                        seat_result["confidence"] = 0
                        seat_result["is_occupied"] = False
                    occupancy_data[stream_id][seat_id] = seat_result
                    seats_data.append(seat_result)
                
                # Occupancy data is kept in-memory only (not persisted to MongoDB)
                # This avoids storing large amounts of historical data
                
                print(f"Occupancy updated for {stream_id}: {len(seats_data)} seats processed")
        except Exception as e:
            print(f"Error processing stream {stream_id}: {e}")
            mark_stream_offline(
                stream_id,
                active_streams,
                occupancy_data,
                coordinates,
                reason=f"error: {e}",
            )
        
        time.sleep(screenshot_interval)
    
    print(f"Stream processing stopped for {stream_id}")

