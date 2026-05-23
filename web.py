import gradio as gr
import cv2, numpy as np, time, threading
from perception import see, get_weather
from motion import tracker, extract_features
from agent import coach
from tts import say

last_coach_text = ''
last_coach_time = 0
weather = get_weather()
last_weather = time.time()
history = []
running = True

def draw_skeleton(frame, keypoints):
    if keypoints is None: return frame
    kp = [(int(p[0]), int(p[1])) for p in keypoints]
    for x, y in kp:
        cv2.circle(frame, (x, y), 4, (0, 255, 255), -1)
    SKELETON = [(5,6),(5,7),(7,9),(6,8),(8,10),(5,11),(6,12),(11,12),
                (11,13),(13,15),(12,14),(14,16)]
    for a, b in SKELETON:
        if a < len(kp) and b < len(kp):
            cv2.line(frame, kp[a], kp[b], (0, 255, 0), 2)
    return frame

def draw_hud(frame, motion_data, weather_data, coach_text):
    h, w = frame.shape[:2]
    data = [
        f'Squats: {motion_data["count"]}',
        f'Depth: {motion_data.get("depth_score",0):.0%}',
        f'HR: {motion_data.get("heart_rate","?")}bpm',
        f'Fatigue: {motion_data.get("fatigue_score",0):.0%}',
        f'T:{weather_data.get("temp","?")}C H:{weather_data.get("humidity","?")}%',
    ]
    for i, d in enumerate(data):
        cv2.putText(frame, d, (15, 35 + i*35), cv2.FONT_HERSHEY_SIMPLEX,
                    0.7, (255, 255, 255), 2)
    if coach_text:
        cv2.rectangle(frame, (0, h-50), (w, h), (0, 0, 0), -1)
        cv2.putText(frame, coach_text[:40], (15, h-15), cv2.FONT_HERSHEY_SIMPLEX,
                    0.8, (0, 255, 255), 2)
    state_colors = {'STAND':(0,255,0), 'DOWN':(255,255,0),
                    'BOTTOM':(0,255,255), 'UP':(255,165,0)}
    color = state_colors.get(motion_data.get('state','STAND'),(255,255,255))
    cv2.circle(frame, (w-40, 40), 20, color, -1)
    return frame

def process_frame():
    global last_coach_text, last_coach_time, weather, last_weather, history
    perception = see()
    frame = perception['frame']
    if frame is None:
        frame = np.zeros((480, 640, 3), dtype=np.uint8)

    features = extract_features(perception['pose'])
    motion_data = tracker.update(features)

    if time.time() - last_weather > 60:
        weather = get_weather()
        last_weather = time.time()

    now = time.time()
    if motion_data['state'] == 'STAND' and motion_data['count'] > 0 and now - last_coach_time > 3:
        last_coach_text = coach(motion_data, weather, history)
        last_coach_time = now
        history.append({'role': 'assistant', 'content': last_coach_text})
        threading.Thread(target=say, args=(last_coach_text,), daemon=True).start()

    frame = draw_skeleton(frame, perception['pose'])
    frame = draw_hud(frame, motion_data, weather, last_coach_text)
    return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

def stream_video():
    while running:
        try:
            yield process_frame()
        except:
            yield np.zeros((480, 640, 3), dtype=np.uint8)
        time.sleep(0.05)

def chat_respond(message, chat_history):
    resp = coach({'count': tracker.count, 'state': 'chat', 'heart_rate': 100,
                  'depth_score': 0.8, 'fatigue_score': 0.2, 'issues': []}, weather)
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
    demo.launch(server_name='0.0.0.0', server_port=7860)
