/**
 * What a component test needs standing up before it can mount anything.
 *
 * Kept as small as possible. Every mock here is a place where the test stops
 * agreeing with the app, so each one has to earn its line — these are the
 * native modules that have no JavaScript behaviour to exercise, not things
 * being stubbed to make a test pass.
 */
// (Matchers are built into @testing-library/react-native v14 — the separate
// extend-expect entry point no longer exists.)

// A blur is a visual effect with nothing to assert. Rendering its children is
// the whole of what a test cares about.
jest.mock('expo-blur', () => {
  const { View } = require('react-native');
  return { BlurView: View };
});

// Fonts never finish loading in a test environment, and a component that waits
// for them renders nothing at all.
jest.mock('@expo-google-fonts/inter', () => ({ useFonts: () => [true, null] }));
jest.mock('@expo-google-fonts/playfair-display', () => ({ useFonts: () => [true, null] }));

// Silence the animation frame warnings React Native emits under fake timers;
// they say nothing about the component under test.
jest.spyOn(console, 'warn').mockImplementation((...args) => {
  const first = String(args[0] ?? '');
  if (first.includes('useNativeDriver') || first.includes('AnimatedComponent')) return;
  // Anything else still surfaces — a warning we did not expect is a finding.
  process.stderr.write(args.join(' ') + '\n');
});
