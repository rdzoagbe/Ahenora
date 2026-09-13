/**
 * The wiring, not just the rule.
 *
 * `shouldAutoApplyUpdate` is pure and thoroughly tested, and all of that would
 * still pass if nothing ever called it, or if PressScale stopped recording
 * presses, or if the reload were never actually requested. Those are the three
 * ways this feature can quietly become decoration, so each gets a test that
 * mounts the real thing.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PressScale } from '../components/PressScale';
import { lastInteractionAt, resetInteraction } from '../interaction';

jest.setTimeout(30000);

const FRAME = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const mockReload = jest.fn().mockResolvedValue(undefined);
let mockPending = false;

jest.mock('expo-updates', () => ({
  get isEnabled() { return true; },
  get updateId() { return 'running-1'; },
  get runtimeVersion() { return '2.0.0'; },
  useUpdates: () => ({
    isUpdatePending: mockPending,
    downloadedUpdate: mockPending ? { updateId: 'staged-1' } : null,
  }),
  reloadAsync: (...args: unknown[]) => mockReload(...args),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-constants', () => ({ expoConfig: { version: '2.0.0' } }));
jest.mock('../api', () => ({ api: { appVersionInfo: () => Promise.resolve(null) } }));
jest.mock('../whatsNew', () => ({ WHATS_NEW: {} }));
jest.mock('../store', () => ({
  useStore: () => ({ t: (k: string) => k, theme: { colors: {} } }),
}));

// Imported after the mocks so the component picks them up.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { UpdateNotice } = require('../components/UpdateNotice');

const mount = () =>
  render(
    <SafeAreaProvider initialMetrics={FRAME}>
      <UpdateNotice />
    </SafeAreaProvider>,
  );

describe('PressScale', () => {
  beforeEach(() => resetInteraction());

  it('records that somebody pressed something', async () => {
    // If it stops doing this, every guard downstream reads "nobody is here"
    // and the app becomes free to relaunch under anyone, any time.
    const view = await render(
      <PressScale testID="btn" onPress={() => undefined}><Text>go</Text></PressScale>,
    );
    expect(lastInteractionAt()).toBe(0);
    fireEvent(view.getByTestId('btn'), 'pressIn');
    expect(lastInteractionAt()).toBeGreaterThan(0);
  });
});

describe('a staged update on a fresh launch', () => {
  beforeEach(() => { resetInteraction(); mockReload.mockClear(); });
  afterEach(() => { mockPending = false; });

  it('is applied without asking', async () => {
    mockPending = true;
    mount();
    await waitFor(() => expect(mockReload).toHaveBeenCalledTimes(1));
  });

  it('is left alone when there is nothing staged', async () => {
    mockPending = false;
    mount();
    // Nothing to apply: a reload here would restart the app for no reason.
    await new Promise((r) => setTimeout(r, 60));
    expect(mockReload).not.toHaveBeenCalled();
  });

  it('is left alone once somebody has pressed something', async () => {
    mockPending = true;
    // The session began a moment ago; the press lands inside it. This is the
    // ordering that a ref inside the component got wrong — see `interaction`.
    resetInteraction(Date.now() - 500);
    const view = await render(
      <PressScale testID="btn" onPress={() => undefined}><Text>go</Text></PressScale>,
    );
    fireEvent(view.getByTestId('btn'), 'pressIn');
    mount();
    await new Promise((r) => setTimeout(r, 60));
    expect(mockReload).not.toHaveBeenCalled();
  });
});
