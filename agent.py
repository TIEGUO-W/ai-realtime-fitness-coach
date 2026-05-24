import re


def coach(motion_data, weather=None, history=None, user_text=None):
    weather = weather or {}
    if user_text:
        return _chat_reply(user_text, motion_data, weather)
    return _exercise_feedback(motion_data, weather)


def _chat_reply(message, motion_data, weather):
    text = message.strip().lower()
    if '天气' in text or '温度' in text or '湿度' in text:
        return f"当前环境：{weather.get('temp','?')}°C，湿度 {weather.get('humidity','?')}%。"
    if any(word in text for word in ['休息', '累', '疲劳']):
        return _fatigue_advice(motion_data)
    if any(word in text for word in ['深蹲', '运动', '训练']):
        return _exercise_feedback(motion_data, weather)
    if any(word in text for word in ['你好', '嗨', 'hello']):
        return "你好，我已经在看着你，随时可以给你实时运动反馈。"
    if re.search(r'多少|几|计数|次数', text):
        return f"你当前已经完成 {motion_data.get('count', 0)} 个深蹲。"
    return "我已经收到了你的问题，继续运动时我会给你精准反馈。"


def _exercise_feedback(motion_data, weather):
    count = motion_data.get('count', 0)
    issues = motion_data.get('issues', [])
    fatigue = motion_data.get('fatigue_score', 0)

    if count == 0:
        return "我还没检测到有效深蹲，请站到摄像头前，保持姿势自然。"
    if issues:
        tips = []
        if 'depth_too_low' in issues:
            tips.append('下蹲深度不足，请再往下压一点。')
        if 'not_deep_enough' in issues:
            tips.append('你的姿势可以更低一些，注意膝盖不要超过脚尖。')
        if 'asymmetric' in issues:
            tips.append('左右动作为了保持对称，注意腰胯平稳。')
        return ' '.join(tips)
    if fatigue > 0.7:
        return '你已经做到很不错了，建议适当休息一下再继续。'
    return f'当前深蹲次数 {count}，动作稳定，继续保持标准节奏。'


def _fatigue_advice(motion_data):
    fatigue = motion_data.get('fatigue_score', 0)
    if fatigue > 0.7:
        return '你现在有点疲劳，建议暂停 20-30 秒，做几次深呼吸。'
    return '你状态很好，可以继续，但不要太快，保持标准动作。'
