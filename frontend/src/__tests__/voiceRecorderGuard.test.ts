/**
 * The guard is the whole reason runtimeVersion did not have to move, and the
 * reason the binary currently in App Review can still take an update. If
 * requiring expo-audio ever throws on a build without it, the app must show a
 * panel — not a red screen.
 */
jest.mock('expo-audio', () => { throw new Error('native module not in this binary'); }, { virtual: true });

describe('a binary without the microphone module', () => {
  it('reports that it cannot record, instead of throwing', () => {
    const { canRecord } = require('../voiceRecorder');
    expect(canRecord()).toBe(false);
  });

  it('refuses to start rather than crashing', async () => {
    const { VoiceRecording } = require('../voiceRecorder');
    const rec = new VoiceRecording();
    await expect(rec.ensurePermission()).resolves.toBe('unsupported');
    await expect(rec.start()).resolves.toBe('unsupported');
    await expect(rec.stop()).resolves.toBeNull();
  });
});
