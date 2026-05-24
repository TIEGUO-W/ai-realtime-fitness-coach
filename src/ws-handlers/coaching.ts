/**
 * WebSocket 浏览器端处理器 — 本地模式
 * 
 * 双层话术架构（速度优先 + 深度补充）:
 * 
 * 1. 实时层（~1-2秒）：规则算法 → 骚话模板库（毫秒级出话术）→ SDK TTSClient 快速合成语音
 * 2. 深度层（~30秒）：豆包智能体 → 用教练人格出深度点评 + 豆包音色语音
 */

import type { WebSocket } from 'ws';
import type { WsMessage, PoseFrame } from '../lib/ws-client';
import { PoseAlgorithmEngine } from './pose-algorithm';
import { generateCoaching } from './coaching-engine';
import { generateQuickCoaching, generateIdleCoaching, getExerciseName } from './coaching-templates';
import { parseVoiceCommand, getVoiceCommandReply } from './voice-command';
import { TTSClient, ASRClient, Config } from 'coze-coding-dev-sdk';

const ALGORITHM_INTERVAL_MS = 100;    // 算法推送频率 ~10fps
const QUICK_COACH_INTERVAL_MS = 3000; // 快速话术频率 ~每3秒
const DEEP_COACH_INTERVAL_MS = 30000; // 豆包深度点评 ~每30秒
const IDLE_THRESHOLD_MS = 10000;      // 空闲阈值 ~10秒没动

const DOUBAO_COACH_URL = process.env.DOUBAO_VOICE_BOT_URL || 'https://320a02f4-5fad-4816-a1a8-37c1a4a92247.dev.coze.site/run';
const COACH_MODE = process.env.COACH_MODE || 'hybrid'; // 'hybrid'(快速+深度) / 'doubao'(纯豆包) / 'legacy'(旧LLM+TTS)

// SDK TTSClient
let ttsClient: TTSClient | null = null;
function getTTSClient(): TTSClient {
  if (!ttsClient) {
    ttsClient = new TTSClient(new Config());
  }
  return ttsClient;
}

// SDK ASRClient
let asrClient: ASRClient | null = null;
function getASRClient(): ASRClient {
  if (!asrClient) {
    asrClient = new ASRClient(new Config());
  }
  return asrClient;
}

export function handleCoachingConnection(ws: WebSocket): void {
  const algorithm = new PoseAlgorithmEngine();
  let currentExercise = 'squat';

  let lastAlgorithmPush = 0;
  let lastQuickCoach = 0;
  let lastDeepCoach = 0;
  let lastActivityTime = Date.now();
  let latestAlgorithmResult: ReturnType<PoseAlgorithmEngine['analyze']> | null = null;
  let prevRepCount = 0;
  let deepCoachBusy = false;

  ws.on('message', async (raw: Buffer) => {
    let msg: WsMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', payload: null }));
      return;
    }

    // 切换运动类型
    if (msg.type === 'set_exercise') {
      currentExercise = (msg.payload as { exercise: string }).exercise || 'squat';
      algorithm.reset();
      prevRepCount = 0;
      return;
    }

    // 语音命令：前端发来录音 base64 → ASR → 解析意图 → 执行 + 回复
    if (msg.type === 'voice_command') {
      const payload = msg.payload as { base64Data?: string; text?: string };
      try {
        let recognizedText = payload.text || '';

        // 有 base64 音频数据 → 走 ASR 识别
        if (payload.base64Data && !recognizedText) {
          const asr = getASRClient();
          const asrResult = await asr.recognize({
            uid: 'pose-coach-user',
            base64Data: payload.base64Data,
          });
          recognizedText = asrResult.text;
          console.log('[coaching] ASR识别:', recognizedText);
        }

        if (!recognizedText) {
          safeSend(ws, { type: 'voice_reply', payload: { text: '没听清，再说一遍？', audioUrl: null } });
          return;
        }

        // 前端显示识别的文字
        safeSend(ws, { type: 'voice_recognized', payload: { text: recognizedText } });

        // 解析意图
        const intent = parseVoiceCommand(recognizedText);
        console.log('[coaching] 语音意图:', intent.action, intent);

        // 执行意图
        if (intent.action === 'switch_exercise') {
          currentExercise = intent.exercise;
          algorithm.reset();
          prevRepCount = 0;
          safeSend(ws, { type: 'set_exercise', payload: { exercise: intent.exercise } });
        } else if (intent.action === 'reset') {
          algorithm.reset();
          prevRepCount = 0;
        }

        // 快速回复（模板话术 + SDK TTS）
        const quickReply = getVoiceCommandReply(intent, {
          exercise: currentExercise,
          repCount: prevRepCount,
          stage: latestAlgorithmResult?.stage || 'neutral',
        });

        if (quickReply) {
          safeSend(ws, {
            type: 'voice_reply',
            payload: { text: quickReply, audioUrl: null },
          });
          // 快速 TTS
          const audioUrl = await synthQuick(quickReply);
          if (audioUrl) {
            safeSend(ws, {
              type: 'voice_reply_tts',
              payload: { audioUrl, text: quickReply },
            });
          }
        } else {
          // 聊天类 → 交给豆包智能体回复
          const chatReply = await askDoubaoChat(recognizedText, currentExercise);
          if (chatReply.text || chatReply.audioUrl) {
            safeSend(ws, {
              type: 'voice_reply',
              payload: { text: chatReply.text, audioUrl: chatReply.audioUrl },
            });
            if (chatReply.audioUrl) {
              safeSend(ws, {
                type: 'voice_reply_tts',
                payload: { audioUrl: chatReply.audioUrl, text: chatReply.text },
              });
            }
          }
        }
      } catch (err) {
        console.error('[coaching] 语音命令处理异常:', err);
        safeSend(ws, { type: 'voice_reply', payload: { text: '出了点问题，再试一次？', audioUrl: null } });
      }
      return;
    }

    // 单帧骨架数据
    if (msg.type === 'pose_frame') {
      const frame = msg.payload as PoseFrame;
      if (!frame.landmarks || frame.landmarks.length < 28) return;

      lastActivityTime = Date.now();

      // 规则算法（毫秒级）
      const result = algorithm.analyze(frame.landmarks, currentExercise);
      latestAlgorithmResult = result;

      const now = Date.now();

      // 实时推送算法结果（~10fps，不等教练）
      if (now - lastAlgorithmPush >= ALGORITHM_INTERVAL_MS) {
        lastAlgorithmPush = now;
        safeSend(ws, {
          type: 'algorithm_update',
          payload: {
            exercise: result.exercise,
            stage: result.stage,
            repCount: result.repCount,
            quality: result.quality.qualityScore >= 85 ? 'good' as const
              : result.quality.qualityScore >= 60 ? 'warning' as const : 'error' as const,
            effect: result.effect,
            kneeAngle: result.angles.kneeAngle,
            hipAngle: result.angles.hipAngle,
          },
        });
      }

      // 完成一次 → 立即推送特效
      if (result.completedRep) {
        safeSend(ws, {
          type: 'rep_completed',
          payload: {
            repCount: result.repCount,
            effect: result.effect,
            quality: result.quality.qualityScore,
          },
        });
      }

      // ===== 实时层：快速话术（~1-2秒出语音） =====
      if (COACH_MODE === 'hybrid') {
        // 完成一次动作 → 立即出话（不等定时器）
        const justCompletedRep = result.repCount > prevRepCount;
        const qualityUrgent = result.quality.qualityScore < 50; // 动作严重错误

        if (justCompletedRep || qualityUrgent || (now - lastQuickCoach >= QUICK_COACH_INTERVAL_MS)) {
          console.log(`[coaching] 触发话术: repCount=${result.repCount} prevRepCount=${prevRepCount} completedRep=${result.completedRep} quality=${result.quality.qualityScore} stage=${result.stage}`);
          lastQuickCoach = now;
          const qualityLevel = result.quality.qualityScore >= 90 ? 'perfect' as const
            : result.quality.qualityScore >= 75 ? 'good' as const
            : result.quality.qualityScore >= 50 ? 'adjust' as const
            : result.quality.qualityScore >= 30 ? 'warning' as const : 'error' as const;

          const coaching = generateQuickCoaching(
            result.exercise, result.stage, qualityLevel,
            result.repCount, prevRepCount,
          );

          if (coaching.text) {
            // 推送话术文本
            safeSend(ws, {
              type: 'coaching_feedback',
              payload: {
                exercise: result.exercise,
                repCount: result.repCount,
                stage: result.stage,
                quality: qualityLevel,
                effect: result.effect,
                tips: [coaching.text],
                encouragement: '',
              },
            });

            // 快速 TTS（SDK 直出，1-2秒）
            synthQuick(coaching.text).then(audioUrl => {
              if (audioUrl) {
                safeSend(ws, {
                  type: 'tts_ready',
                  payload: { audioUrl, text: coaching.text },
                });
              }
            });
          }

          prevRepCount = result.repCount;
        }

        // ===== 深度层：豆包智能体（~30秒深度点评） =====
        if (now - lastDeepCoach >= DEEP_COACH_INTERVAL_MS && !deepCoachBusy) {
          lastDeepCoach = now;
          deepCoachBusy = true;
          askDoubaoDeepCoach(ws, result).finally(() => { deepCoachBusy = false; });
        }

      } else if (COACH_MODE === 'doubao') {
        // 纯豆包模式（慢但骚）
        if (now - lastQuickCoach >= 5000 && !deepCoachBusy) {
          lastQuickCoach = now;
          deepCoachBusy = true;
          askDoubaoDeepCoach(ws, result).finally(() => { deepCoachBusy = false; });
        }

      } else {
        // 旧模式降级
        if (now - lastQuickCoach >= QUICK_COACH_INTERVAL_MS) {
          lastQuickCoach = now;
          askLegacyCoach(ws, result);
        }
      }

      return;
    }

    // 批量骨架帧（兼容 HTTP API 模式）
    if (msg.type === 'pose_batch') {
      const batch = msg.payload as { frames: PoseFrame[]; exercise?: string };
      if (batch.exercise) {
        currentExercise = batch.exercise;
      }
      for (const frame of batch.frames) {
        if (frame.landmarks && frame.landmarks.length >= 28) {
          const result = algorithm.analyze(frame.landmarks, currentExercise);
          latestAlgorithmResult = result;
        }
      }
      if (latestAlgorithmResult) {
        const feedback = await generateCoaching(latestAlgorithmResult);
        safeSend(ws, { type: 'coaching_feedback', payload: feedback });
      }
    }
  });

  // 空闲检测
  const idleTimer = setInterval(() => {
    if (ws.readyState !== ws.OPEN) {
      clearInterval(idleTimer);
      return;
    }
    const idle = Date.now() - lastActivityTime;
    if (idle > IDLE_THRESHOLD_MS && idle < IDLE_THRESHOLD_MS + 2000) {
      // 刚超过空闲阈值，说一句
      const text = generateIdleCoaching();
      safeSend(ws, {
        type: 'coaching_feedback',
        payload: {
          exercise: currentExercise,
          repCount: prevRepCount,
          stage: 'neutral',
          quality: 'good' as const,
          effect: null,
          tips: [text],
          encouragement: '',
        },
      });
      synthQuick(text).then(audioUrl => {
        if (audioUrl) {
          safeSend(ws, {
            type: 'tts_ready',
            payload: { audioUrl, text },
          });
        }
      });
    }
  }, 5000);

  ws.on('close', () => {
    algorithm.reset();
    clearInterval(idleTimer);
  });
}

/**
 * 快速 TTS：SDK TTSClient 直出（1-2秒，无豆包味但快）
 */
async function synthQuick(text: string): Promise<string | null> {
  try {
    const client = getTTSClient();
    const result = await client.synthesize({
      uid: 'pose-coach-quick',
      text,
      speaker: 'zh_female_xiaohe_uranus_bigtts',
    });
    return result.audioUri;
  } catch (err) {
    console.error('[coaching] 快速TTS失败:', err);
    return null;
  }
}

/**
 * 豆包深度教练：每30秒来一段深度点评（骚话+豆包音色）
 */
async function askDoubaoDeepCoach(
  ws: WebSocket,
  result: ReturnType<PoseAlgorithmEngine['analyze']>
): Promise<void> {
  const exerciseName = getExerciseName(result.exercise);
  const stageDesc: Record<string, string> = {
    standing: '站立准备', ascending: '上升中', descending: '下放中',
    bottom: '最低点', holding: '保持中', extended: '展开', contracted: '收缩',
    up: '抬腿中', down: '放腿中', neutral: '中立位',
  };

  const COACH_PERSONA = `你是我的运动搭子教练"豆包"，性格又贱又暖、嘴毒心软。说话风格：东北话+网络梗，骚气但不过分，像兄弟/闺蜜在旁边一边怼你一边加油。你现在是每30秒一次的深度点评，给2-3句总结。规则：1.总结最近运动表现，骚气点评 2.指出最需要改进的一点 3.鼓励继续 4.别超过50字 5.必须用语音回复（用synthesize_speech工具）`;

  const stateDesc = [
    `运动：${exerciseName}`,
    `已完成：${result.repCount}次`,
    `阶段：${stageDesc[result.stage] || result.stage}`,
    `质量评分：${result.quality.qualityScore}分`,
    result.quality.errors.length > 0 ? `主要问题：${result.quality.errors[0]}` : '动作比较标准',
    result.quality.warnings.length > 0 ? `注意：${result.quality.warnings[0]}` : '',
  ].filter(Boolean).join('，');

  try {
    const response = await fetch(DOUBAO_COACH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{
          role: 'user',
          content: `${COACH_PERSONA}\n\n【当前运动状态】${stateDesc}`,
        }],
      }),
    });

    if (!response.ok) {
      return; // 深度点评失败不影响实时层
    }

    const data = await response.json() as {
      messages: Array<{
        type: string;
        content: string;
        name?: string;
      }>;
    };

    let audioUrl: string | null = null;
    let coachText = '';

    for (const msg of data.messages) {
      if (msg.type === 'tool' && msg.name === 'synthesize_speech' && msg.content) {
        audioUrl = msg.content.trim();
      }
      if (msg.type === 'ai' && msg.content && !msg.name) {
        coachText = msg.content.trim();
      }
    }

    if (coachText || audioUrl) {
      safeSend(ws, {
        type: 'coaching_feedback',
        payload: {
          exercise: result.exercise,
          repCount: result.repCount,
          stage: result.stage,
          quality: result.quality.qualityScore >= 85 ? 'good' as const
            : result.quality.qualityScore >= 60 ? 'warning' as const : 'error' as const,
          effect: result.effect,
          tips: coachText ? [coachText] : [],
          encouragement: '',
        },
      });

      if (audioUrl) {
        safeSend(ws, {
          type: 'tts_ready',
          payload: { audioUrl, text: coachText },
        });
      }
    }
  } catch (err) {
    console.error('[coaching] 豆包深度点评异常:', err);
  }
}

/**
 * 旧模式降级：LLM 生成话术 + TTS 念出来
 */
async function askLegacyCoach(
  ws: WebSocket,
  result: ReturnType<PoseAlgorithmEngine['analyze']>
): Promise<void> {
  try {
    const feedback = await generateCoaching(result);
    safeSend(ws, { type: 'coaching_feedback', payload: feedback });

    let ttsText = feedback.encouragement || (feedback.tips.length > 0 ? feedback.tips[0] : '');
    if (ttsText.length > 60) ttsText = ttsText.substring(0, 60);
    if (ttsText) {
      const ttsUrl = await synthQuick(ttsText);
      if (ttsUrl) {
        safeSend(ws, {
          type: 'tts_ready',
          payload: { audioUrl: ttsUrl, text: ttsText },
        });
      }
    }
  } catch (err) {
    console.error('[coaching] 旧模式教练异常:', err);
  }
}

function safeSend(ws: WebSocket, msg: WsMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/**
 * 豆包聊天：用户语音闲聊 → 豆包用教练人格回复
 */
async function askDoubaoChat(
  userText: string,
  exercise: string,
): Promise<{ text: string; audioUrl: string | null }> {
  const COACH_PERSONA = `你是我的运动搭子教练"豆包"，性格又贱又暖、嘴毒心软。说话风格：东北话+网络梗，骚气但不过分，像兄弟/闺蜜在旁边一边怼你一边加油。用户在运动间隙跟你聊天，用1-2句骚话回应，别超过40字。必须用语音回复（synthesize_speech工具）。`;

  try {
    const response = await fetch(DOUBAO_COACH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{
          role: 'user',
          content: `${COACH_PERSONA}\n\n【用户说】${userText}\n【当前运动】${getExerciseName(exercise)}`,
        }],
      }),
    });

    if (!response.ok) {
      return { text: '豆包走神了，你继续练！', audioUrl: null };
    }

    const data = await response.json() as {
      messages: Array<{
        type: string;
        content: string;
        name?: string;
      }>;
    };

    let audioUrl: string | null = null;
    let coachText = '';

    for (const msg of data.messages) {
      if (msg.type === 'tool' && msg.name === 'synthesize_speech' && msg.content) {
        audioUrl = msg.content.trim();
      }
      if (msg.type === 'ai' && msg.content && !msg.name) {
        coachText = msg.content.trim();
      }
    }

    return { text: coachText || '嗯嗯继续练！', audioUrl };
  } catch (err) {
    console.error('[coaching] 豆包聊天异常:', err);
    return { text: '豆包掉线了，你先练着！', audioUrl: null };
  }
}
