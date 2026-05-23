import cv2, numpy as np, time, json
import sounddevice as sd, whisper, requests
from pathlib import Path
from ultralytics import YOLO
from config import CAMERA_ID, FRAME_WIDTH, FRAME_HEIGHT, YOLO_DETECT, YOLO_POSE, CONF_THRESHOLD

_yolo_detect = None
_yolo_pose = None
_whisper = None
_last_person_bbox = None  # 上一帧的人位置，用于跳过检测直接跑pose

def _get_yolo_detect():
    global _yolo_detect
    if _yolo_detect is None:
        _yolo_detect = YOLO(str(Path(YOLO_DETECT)))
    return _yolo_detect

def _get_yolo_pose():
    global _yolo_pose
    if _yolo_pose is None:
        _yolo_pose = YOLO(str(Path(YOLO_POSE)))
    return _yolo_pose

def _get_whisper():
    global _whisper
    if _whisper is None:
        _whisper = whisper.load_model('small')
    return _whisper

def see():
    global _last_person_bbox
    cap = cv2.VideoCapture(CAMERA_ID)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)
    ret, frame = cap.read()
    cap.release()
    if not ret:
        return {'people': [], 'pose': None, 'frame': None}

    people = []
    pose_keypoints = None

    # 每隔几帧检测一次（节约时间），有人追踪时跳过检测
    detect = _get_yolo_detect()
    results = detect(frame, verbose=False, conf=CONF_THRESHOLD)

    for r in results:
        for box in r.boxes:
            cls_id = int(box.cls[0])
            if detect.names[cls_id] == 'person':
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                people.append({'bbox': [x1, y1, x2, y2], 'conf': float(box.conf[0])})

    # 姿态估计（只在检测到人时运行，用整帧）
    if people:
        pose = _get_yolo_pose()
        presults = pose(frame, verbose=False)
        for pr in presults:
            if pr.keypoints is not None and pr.keypoints.xy is not None:
                kpts = pr.keypoints.xy.cpu().numpy()
                if len(kpts) > 0:
                    pose_keypoints = kpts[0].tolist()
                    _last_person_bbox = people[0]['bbox']
                    break

    return {'people': people, 'pose': pose_keypoints, 'frame': frame}

def hear(duration=3.0, sample_rate=16000):
    audio = sd.rec(int(duration * sample_rate), samplerate=sample_rate,
                   channels=1, dtype='float32')
    sd.wait()
    audio = audio.flatten()
    audio = audio / max(abs(audio).max(), 1e-8)
    model = _get_whisper()
    result = model.transcribe(audio, language='zh', fp16=False)
    return result['text'].strip()

def get_weather():
    try:
        r = requests.get('https://wttr.in/Zhuhai?format=j1', timeout=5)
        j = r.json()
        c = j['current_condition'][0]
        return {'temp': c['temp_C'], 'humidity': c['humidity'],
                'desc': c['weatherDesc'][0]['value']}
    except:
        return {'temp': '26', 'humidity': '60', 'desc': 'Cloudy'}
