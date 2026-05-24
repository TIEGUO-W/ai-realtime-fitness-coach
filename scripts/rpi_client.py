#!/usr/bin/env python3
"""
树莓派摄像头客户端 — AI 实时运动教练

仅负责采集摄像头画面并发送到云端，不运行任何推理模型。

安装依赖:
    pip install opencv-python websockets

使用方法:
    python rpi_client.py ws://你的服务器域名/ws/camera

示例:
    python rpi_client.py wss://abc123.coze.site/ws/camera
    python rpi_client.py ws://192.168.1.100:5000/ws/camera
"""

import asyncio
import sys
import time
import cv2
import websockets

# ─── 配置 ──────────────────────────────────────
FPS = 10                # 目标帧率
JPEG_QUALITY = 60       # JPEG 压缩质量 (0-100)
FRAME_WIDTH = 640       # 画面宽度
FRAME_HEIGHT = 480      # 画面高度
MAX_RECONNECT = 999     # 最大重连次数
RECONNECT_DELAY = 3     # 重连间隔(秒)


async def stream_camera(server_url: str):
    """采集摄像头画面并通过 WebSocket 发送到云端"""

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("[ERROR] 无法打开摄像头，请检查:")
        print("  1. 摄像头是否已连接")
        print("  2. 是否有其他程序占用摄像头")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)
    cap.set(cv2.CAP_PROP_FPS, FPS)

    actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"[INFO] 摄像头已打开: {actual_w}x{actual_h}")

    reconnect_count = 0
    interval = 1.0 / FPS

    while reconnect_count < MAX_RECONNECT:
        try:
            print(f"[INFO] 正在连接服务器: {server_url}")
            async with websockets.connect(
                server_url,
                max_size=2**22,       # 4MB 最大消息大小
                ping_interval=20,
                ping_timeout=10,
            ) as ws:
                print("[INFO] 已连接! 开始传输画面...")
                reconnect_count = 0
                frame_count = 0
                fps_start = time.time()

                while True:
                    ret, frame = cap.read()
                    if not ret:
                        print("[WARN] 帧采集失败，跳过")
                        await asyncio.sleep(0.1)
                        continue

                    # 编码为 JPEG
                    encode_params = [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY]
                    _, buffer = cv2.imencode('.jpg', frame, encode_params)
                    jpeg_bytes = buffer.tobytes()

                    # 发送二进制帧
                    await ws.send(jpeg_bytes)

                    # FPS 统计
                    frame_count += 1
                    elapsed = time.time() - fps_start
                    if elapsed >= 5.0:
                        fps = frame_count / elapsed
                        size_kb = len(jpeg_bytes) / 1024
                        print(f"[STAT] {fps:.1f} FPS | 帧大小: {size_kb:.1f}KB | 总带宽: {fps * size_kb:.0f}KB/s")
                        frame_count = 0
                        fps_start = time.time()

                    # 控制帧率
                    await asyncio.sleep(interval)

        except websockets.exceptions.ConnectionClosed as e:
            print(f"[WARN] 连接断开 (code={e.code}): {e.reason}")
        except ConnectionRefusedError:
            print("[WARN] 服务器拒绝连接，可能未启动")
        except Exception as e:
            print(f"[ERROR] 连接异常: {e}")

        reconnect_count += 1
        print(f"[INFO] {RECONNECT_DELAY}秒后重连... (第{reconnect_count}次)")
        await asyncio.sleep(RECONNECT_DELAY)

    cap.release()
    print("[INFO] 已退出")


def main():
    if len(sys.argv) < 2:
        print("用法: python rpi_client.py <服务器WebSocket地址>")
        print("")
        print("示例:")
        print("  python rpi_client.py wss://abc123.coze.site/ws/camera")
        print("  python rpi_client.py ws://192.168.1.100:5000/ws/camera")
        sys.exit(1)

    server_url = sys.argv[1]

    if not server_url.startswith("ws://") and not server_url.startswith("wss://"):
        print("[ERROR] 地址必须以 ws:// 或 wss:// 开头")
        sys.exit(1)

    print("=" * 50)
    print("  树莓派摄像头客户端 — AI 实时运动教练")
    print("=" * 50)
    print(f"  服务器: {server_url}")
    print(f"  分辨率: {FRAME_WIDTH}x{FRAME_HEIGHT}")
    print(f"  帧率:   {FPS} FPS")
    print(f"  质量:   {JPEG_QUALITY}%")
    print("=" * 50)

    asyncio.run(stream_camera(server_url))


if __name__ == "__main__":
    main()
