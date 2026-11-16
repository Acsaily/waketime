import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { isNativePlatform } from '../native/wakeTimer';

export type FeedbackKind = 'tick' | 'detent' | 'lap' | 'merge' | 'split';
export interface FeedbackPrefs {
  hapticsEnabled: boolean;
  soundEnabled: boolean;
}

let audioContext: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    if (!audioContext) audioContext = new Ctor();
    if (audioContext.state === 'suspended') void audioContext.resume();
    return audioContext;
  } catch {
    return null;
  }
}

function tone(context: AudioContext, frequency: number, startMs: number, durationMs: number, gainValue: number, type: OscillatorType = 'sine'): void {
  const start = context.currentTime + startMs / 1000;
  const end = start + durationMs / 1000;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(end + 0.02);
}

function playSound(kind: FeedbackKind): void {
  const context = audio();
  if (!context) return;
  if (kind === 'tick') {
    tone(context, 1180, 0, 22, 0.035, 'triangle');
    return;
  }
  if (kind === 'detent') {
    tone(context, 760, 0, 32, 0.05, 'triangle');
    tone(context, 1320, 10, 24, 0.03, 'sine');
    return;
  }
  if (kind === 'lap') {
    tone(context, 660, 0, 70, 0.055, 'sine');
    tone(context, 990, 55, 110, 0.05, 'sine');
    return;
  }
  if (kind === 'split') {
    tone(context, 880, 0, 45, 0.045, 'triangle');
    tone(context, 1175, 55, 70, 0.04, 'sine');
    return;
  }
  tone(context, 523, 0, 80, 0.045, 'sine');
  tone(context, 784, 70, 90, 0.05, 'sine');
  tone(context, 1046, 150, 140, 0.045, 'sine');
}

function playHaptics(kind: FeedbackKind): void {
  if (!isNativePlatform) return;
  const action = kind === 'tick'
    ? Haptics.selectionChanged()
    : kind === 'detent'
      ? Haptics.impact({ style: ImpactStyle.Light })
      : kind === 'lap'
        ? Haptics.impact({ style: ImpactStyle.Medium })
        : Haptics.notification({ type: NotificationType.Success });
  void action.catch(() => undefined);
}

/** 统一入口：各组件只传当前设置，关掉后不产生任何系统调用。 */
export function feedback(prefs: FeedbackPrefs, kind: FeedbackKind): void {
  if (prefs.hapticsEnabled) playHaptics(kind);
  if (prefs.soundEnabled) playSound(kind);
}
