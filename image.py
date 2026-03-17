import cv2
import numpy as np

# 1. Create a blank white canvas (800x600)
image = np.ones((600, 800, 3), dtype=np.uint8) * 255

# 2. Draw some "Rectangular Tables" (Solid Black)
cv2.rectangle(image, (100, 100), (250, 200), (0, 0, 0), -1) # Table 1
cv2.rectangle(image, (500, 100), (650, 200), (0, 0, 0), -1) # Table 2
cv2.rectangle(image, (100, 350), (250, 450), (0, 0, 0), -1) # Table 3

# 3. Draw some "Round Tables" (Solid Black)
cv2.circle(image, (575, 400), 50, (0, 0, 0), -1) # Table 4
cv2.circle(image, (375, 275), 60, (0, 0, 0), -1) # Table 5 (Center)

# 4. Save the perfect test image
cv2.imwrite("perfect_test_floorplan.png", image)
print("✅ Saved 'perfect_test_floorplan.png' to your folder!")