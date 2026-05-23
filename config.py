import os

# DeepSeek
LLM_CONFIG = {
    'base_url': 'https://api.deepseek.com',
    'api_key': os.getenv('DEEPSEEK_API_KEY', 'your-key'),
    'model': 'deepseek-chat',
}

# Camera
CAMERA_ID = 0
FRAME_WIDTH, FRAME_HEIGHT = 640, 480  # faster

# YOLO
YOLO_DETECT = 'yolo11n.pt'
YOLO_POSE = 'yolo11n-pose.pt'
CONF_THRESHOLD = 0.3  # lower = more detections

# Squat thresholds (relaxed for Pi5 speed)
SQUAT_DOWN_ANGLE = 130   # knee < this → DOWN
SQUAT_BOTTOM_ANGLE = 90  # knee < this → BOTTOM
SQUAT_UP_ANGLE = 150     # knee > this → UP

# Safety
MAX_HEART_RATE = 190
FATIGUE_THRESHOLD = 0.85

# TTS
DOUBAO_TTS_CONFIG = {
    'api_key': os.getenv('DOUBAO_API_KEY', ''),
    'voice': 'zh_female_qingxin',
}

# Mock
MOCK_HR = 120
