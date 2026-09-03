/**
 * The microphone, loaded at runtime rather than imported.
 *
 * expo-audio is a NATIVE module: it exists only in a binary that was compiled
 * with it. A plain `import` would run at module scope and take down any build
 * that predates it — and there is one of those in App Review right now. Rather
 * than bump runtimeVersion (which would strand that build: every future update
 * would target the new runtime and skip it), the module is required lazily and
 * the app asks a question it can actually answer — "can this device record?" —
 * instead of assuming.
 *
 * So one JS bundle serves both fleets. A binary with the module records; one
 * without shows the same "coming soon" panel it shows today. When every
 * platform has shipped a build that includes it, this file keeps working
 * unchanged; the guard simply stops ever being false.
 */

type PermissionResponse = { granted: boolean; canAskAgain?: boolean };

interface Recorder {
  uri: string | null;
  isRecording: boolean;
  prepareToRecordAsync(options?: object): Promise<void>;
  record(): void;
  stop(): Promise<void>;
}

interface AudioModuleShape {
  AudioRecorder: new (options: object) => Recorder;
  requestRecordingPermissionsAsync(): Promise<PermissionResponse>;
  getRecordingPermissionsAsync(): Promise<PermissionResponse>;
  setAudioModeAsync(mode: object): Promise<void>;
}

let cached: { AudioModule: AudioModuleShape; presets: any } | null | undefined;

/** null when this binary has no microphone module. Resolved once, then cached. */
function load() {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const mod = require('expo-audio');
    // The class-based recorder, NOT useAudioRecorder: a hook cannot be called
    // conditionally, and whether the module exists is exactly a condition.
    if (!mod?.AudioModule?.AudioRecorder) {
      cached = null;
    } else {
      cached = { AudioModule: mod.AudioModule as AudioModuleShape, presets: mod.RecordingPresets };
    }
  } catch {
    cached = null;
  }
  return cached;
}

/** Whether this build can record at all. False on an older binary. */
export function canRecord(): boolean {
  return load() !== null;
}

export type RecordFailure =
  | 'unsupported'   // the binary has no microphone module
  | 'denied'        // the person said no, or the OS refuses
  | 'too_short'     // released the button almost immediately
  | 'failed';       // anything the platform threw

export class VoiceRecording {
  private recorder: Recorder | null = null;

  /** Asks for the microphone. Separate from start() so the UI can explain first. */
  async ensurePermission(): Promise<'ok' | RecordFailure> {
    const m = load();
    if (!m) return 'unsupported';
    try {
      const existing = await m.AudioModule.getRecordingPermissionsAsync();
      if (existing.granted) return 'ok';
      const asked = await m.AudioModule.requestRecordingPermissionsAsync();
      return asked.granted ? 'ok' : 'denied';
    } catch {
      return 'failed';
    }
  }

  async start(): Promise<'ok' | RecordFailure> {
    const m = load();
    if (!m) return 'unsupported';
    try {
      // allowsRecording has to be on for iOS to route input to the mic at all;
      // it is set here rather than at app start so the app does not claim the
      // audio session for a feature most sessions never touch.
      await m.AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      const preset = m.presets?.HIGH_QUALITY ?? {};
      this.recorder = new m.AudioModule.AudioRecorder(preset);
      await this.recorder.prepareToRecordAsync();
      this.recorder.record();
      return 'ok';
    } catch {
      this.recorder = null;
      return 'failed';
    }
  }

  /** Stops and hands back the file URI, or null if nothing usable was captured. */
  async stop(): Promise<string | null> {
    const rec = this.recorder;
    this.recorder = null;
    if (!rec) return null;
    try {
      await rec.stop();
      return rec.uri ?? null;
    } catch {
      return null;
    } finally {
      const m = load();
      // Hand the audio session back, or on iOS the next sound the app plays
      // comes out of the earpiece instead of the speaker.
      try { await m?.AudioModule.setAudioModeAsync({ allowsRecording: false }); } catch { /* not fatal */ }
    }
  }

  /** Abandons the take without producing a file. */
  async cancel(): Promise<void> {
    await this.stop();
  }
}

/**
 * The recording as the upload wants it. Native gives a file:// URI, and the
 * API client already knows both shapes — this only has to say which one.
 */
export async function fileForUpload(uri: string): Promise<any> {
  // `document` rather than Platform.OS, so this module pulls in no React Native
  // at all — which is what lets the guard below be unit-tested for real instead
  // of asserted about.
  if (typeof document !== 'undefined') {
    const blob = await (await fetch(uri)).blob();
    return blob;
  }
  const lower = uri.toLowerCase();
  const type = lower.endsWith('.3gp') ? 'audio/3gpp'
    : lower.endsWith('.wav') ? 'audio/wav'
    : lower.endsWith('.webm') ? 'audio/webm'
    : 'audio/m4a';
  return { uri, name: uri.split('/').pop() || 'voice.m4a', type };
}
