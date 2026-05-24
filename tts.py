import asyncio, os, subprocess, tempfile

async def speak_edge(text: str) -> str:
    import edge_tts
    tts = edge_tts.Communicate(text, 'zh-CN-XiaoxiaoNeural')
    fd, path = tempfile.mkstemp(suffix='.mp3')
    os.close(fd)
    await tts.save(path)
    return path

def play_audio(path: str):
    subprocess.run(['cvlc', '--play-and-exit', '-q', path],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

async def doubao_tts(text: str, api_key: str = '') -> str:
    return await speak_edge(text)

def say(text: str):
    path = asyncio.run(doubao_tts(text))
    play_audio(path)
    os.unlink(path)
