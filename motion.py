import math, time, numpy as np
from collections import deque
from config import SQUAT_DOWN_ANGLE, SQUAT_BOTTOM_ANGLE, SQUAT_UP_ANGLE, MOCK_HR

# YOLO11-pose 17 keypoint indices
KP = {0:'nose',1:'left_eye',2:'right_eye',3:'left_ear',4:'right_ear',
      5:'left_shoulder',6:'right_shoulder',7:'left_elbow',8:'right_elbow',
      9:'left_wrist',10:'right_wrist',11:'left_hip',12:'right_hip',
      13:'left_knee',14:'right_knee',15:'left_ankle',16:'right_ankle'}

def calculate_angle(a, b, c):
    ba = np.array(b) - np.array(a)
    bc = np.array(b) - np.array(c)
    cos = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-8)
    return np.degrees(np.arccos(np.clip(cos, -1.0, 1.0)))

def extract_features(keypoints):
    if keypoints is None or len(keypoints) < 17:
        return None
    k = {KP[i]: keypoints[i] for i in range(17)}
    left_knee = calculate_angle(k['left_hip'], k['left_knee'], k['left_ankle'])
    right_knee = calculate_angle(k['right_hip'], k['right_knee'], k['right_ankle'])
    knee_angle = (left_knee + right_knee) / 2
    left_hip = calculate_angle(k['left_shoulder'], k['left_hip'], k['left_knee'])
    right_hip = calculate_angle(k['right_shoulder'], k['right_hip'], k['right_knee'])
    hip_angle = (left_hip + right_hip) / 2
    symmetry = 1.0 - abs(left_knee - right_knee) / max(left_knee + right_knee, 1)
    return {'knee_angle': round(knee_angle,1), 'hip_angle': round(hip_angle,1),
            'symmetry': round(symmetry,2), 'left_knee': round(left_knee,1),
            'right_knee': round(right_knee,1)}

class SquatTracker:
    STATES = ['STAND', 'DOWN', 'BOTTOM', 'UP']

    def __init__(self):
        self.state = 'STAND'
        self.count = 0
        self.rom_history = deque(maxlen=10)
        self.tempo_history = deque(maxlen=10)
        self.last_transition = time.time()
        self.form_issues = []
        self.depth_scores = deque(maxlen=10)

    def update(self, features):
        if features is None:
            return self._output()
        knee = features['knee_angle']
        now = time.time()
        dt = now - self.last_transition

        if self.state == 'STAND':
            if knee < SQUAT_DOWN_ANGLE:
                self.state = 'DOWN'
                self.last_transition = now
                self.tempo_history.append(dt)
        elif self.state == 'DOWN':
            if knee < SQUAT_BOTTOM_ANGLE:
                self.state = 'BOTTOM'
                self.rom_history.append(knee)
                self.last_transition = now
            elif knee > SQUAT_UP_ANGLE:
                self.state = 'STAND'
        elif self.state == 'BOTTOM':
            if knee > SQUAT_DOWN_ANGLE:
                self.state = 'UP'
                self.last_transition = now
        elif self.state == 'UP':
            if knee > SQUAT_UP_ANGLE:
                self.state = 'STAND'
                self.count += 1
                self.last_transition = now

        issues = []
        if knee < 60: issues.append('depth_too_low')
        elif knee > 100 and self.state in ('DOWN','BOTTOM'): issues.append('not_deep_enough')
        if features['symmetry'] < 0.7: issues.append('asymmetric')
        self.form_issues = issues

        if issues: self.depth_scores.append(0.5)
        else: self.depth_scores.append(0.9)

        return self._output()

    def _output(self):
        avg_depth = np.mean(list(self.depth_scores)) if self.depth_scores else 0.5
        avg_tempo = np.mean(list(self.tempo_history)) if self.tempo_history else 0
        fatigue = max(0, min(1, (self.count/50)*0.4 + (0.5-avg_depth)*0.4 + (min(avg_tempo,3)/3)*0.2))

        return {
            'exercise': 'squat', 'state': self.state, 'count': self.count,
            'depth_score': round(avg_depth, 2),
            'fatigue_score': round(fatigue, 2),
            'issues': self.form_issues,
            'heart_rate': MOCK_HR + int(self.count * 1.5),
        }

tracker = SquatTracker()
