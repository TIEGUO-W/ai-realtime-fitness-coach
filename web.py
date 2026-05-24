import gradio as gr
import cv2, numpy as np, time, threading
from perception import see, get_weather
from motion import tracker, extract_features
from agent import coach
from tts import say

STATE_LOCK = threading.Lock()
STATE = {
    'frame': np.zeros((480, 640, 3), dtype=np.uint8),
    'pose': None,
    'motion': {'exercise': 'squat', 'state': 'STAND', 'count': 0,
               'depth_score': 0, 'fatigue_score': 0, 'issues': [], 'heart_rate': 0},
    'weather': get_weather(),
    'coach_text': '',
    'history': [],
    'last_coach_time': 0,
    'last_weather': time.time(),
}
running = True


def draw_skeleton(frame, keypoints):
    if keypoints is None:
        return frame
    kp = [(int(p[0]), int(p[1])) for p in keypoints]
    for x, y in kp:
        cv2.circle(frame, (x, y), 4, (0, 255, 255), -1)
    SKELETON = [(5, 6), (5, 7), (7, 9), (6, 8), (8, 10), (5, 11), (6, 12), (11, 12),
                (11, 13), (13, 15), (12, 14), (14, 16)]
    for a, b in SKELETON:
        if a < len(kp) and b < len(kp):
            cv2.line(frame, kp[a], kp[b], (0, 255, 0), 2)
    return frame


def draw_hud(frame, motion_data, weather_data, coach_text):
    h, w = frame.shape[:2]
    data = [
        f'Squats: {motion_data.get("count", 0)}',
        f'Depth: {motion_data.get("depth_score", 0):.0%}',
        f'HR: {motion_data.get("heart_rate", "?")}bpm',
        f'Fatigue: {motion_data.get("fatigue_score", 0):.0%}',
        f'T:{weather_data.get("temp", "?")}C H:{weather_data.get("humidity", "?")}%',
    ]
    for i, d in enumerate(data):
        cv2.putText(frame, d, (15, 35 + i * 35), cv2.FONT_HERSHEY_SIMPLEX,
                    0.7, (255, 255, 255), 2)
    if coach_text:
        cv2.rectangle(frame, (0, h - 50), (w, h), (0, 0, 0), -1)
        cv2.putText(frame, coach_text[:40], (15, h - 15), cv2.FONT_HERSHEY_SIMPLEX,
                    0.8, (0, 255, 255), 2)
    state_colors = {'STAND': (0, 255, 0), 'DOWN': (255, 255, 0),
                    'BOTTOM': (0, 255, 255), 'UP': (255, 165, 0)}
    color = state_colors.get(motion_data.get('state', 'STAND'), (255, 255, 255))
    cv2.circle(frame, (w - 40, 40), 20, color, -1)
    return frame


def update_state_loop():
    global running
    while running:
        perception = see()
        frame = perception['frame'] if perception['frame'] is not None else np.zeros((480, 640, 3), dtype=np.uint8)
        features = extract_features(perception['pose'])
        motion_data = tracker.update(features)
        now = time.time()

        with STATE_LOCK:
            STATE['frame'] = frame
            STATE['pose'] = perception['pose']
            STATE['motion'] = motion_data

        if now - STATE['last_weather'] > 60:
            weather = get_weather()
            with STATE_LOCK:
                STATE['weather'] = weather
                STATE['last_weather'] = now
        else:
            weather = STATE['weather']

        if motion_data['state'] == 'STAND' and motion_data['count'] > 0 and now - STATE['last_coach_time'] > 3:
            coach_text = coach(motion_data, weather, STATE['history'])
            with STATE_LOCK:
                STATE['coach_text'] = coach_text
                STATE['history'].append({'role': 'assistant', 'content': coach_text})
                STATE['last_coach_time'] = now
            threading.Thread(target=say, args=(coach_text,), daemon=True).start()

        time.sleep(0.03)


def process_frame():
    with STATE_LOCK:
        frame = STATE['frame'].copy()
        pose = STATE['pose']
        motion_data = dict(STATE['motion'])
        weather_data = dict(STATE['weather'])
        coach_text = STATE['coach_text']

    frame = draw_skeleton(frame, pose)
    frame = draw_hud(frame, motion_data, weather_data, coach_text)
    return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)


def chat_respond(message, chat_history):
    with STATE_LOCK:
        motion_data = dict(STATE['motion'])
        weather_data = dict(STATE['weather'])
        STATE['history'].append({'role': 'user', 'content': message})

    resp = coach(motion_data, weather_data, STATE['history'], user_text=message)

    with STATE_LOCK:
        STATE['history'].append({'role': 'assistant', 'content': resp})

    chat_history.append((message, resp))
    return '', chat_history


with gr.Blocks(title='AI Fitness Coach', theme=gr.themes.Soft()) as demo:
    gr.Markdown('# AI Multimodal Fitness Coach')
    with gr.Row():
        with gr.Column(scale=2):
            video = gr.Image(label='Live Feed')
        with gr.Column(scale=1):
            chatbot = gr.Chatbot(label='AI Coach', scale=1)
            msg = gr.Textbox(label='Chat', placeholder='Type a message...')
            btn = gr.Button('Send')
            btn.click(chat_respond, [msg, chatbot], [msg, chatbot])

    def refresh_video():
        return process_frame()

    demo.load(refresh_video, None, video, every=0.1)


if __name__ == '__main__':
    threading.Thread(target=update_state_loop, daemon=True).start()
    demo.launch(server_name='0.0.0.0', server_port=7860)
