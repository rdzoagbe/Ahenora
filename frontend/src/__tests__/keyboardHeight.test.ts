/**
 * The hook behind "the PIN box hid under the keypad".
 *
 * Roland tapped the PIN field when handing the tablet to a child, and the
 * numeric keypad opened directly on top of it — the field was still there,
 * underneath, invisible. Bottom-anchored sheets do not move out of the
 * keyboard's way on their own.
 *
 * These cover what a test CAN cover: that the hook subscribes to the right
 * events for the platform, reports the height the OS gives it, and lets go
 * when the sheet closes. They do NOT prove the sheet is visible on a real
 * phone — react-native-web has no soft keyboard, so no browser harness can,
 * which is precisely why ten of them missed this. That check needs a device.
 */
const listeners: Record<string, (e: unknown) => void> = {};
const removed: string[] = [];
let platform = 'android';

jest.mock('react-native', () => ({
  get Platform() { return { OS: platform }; },
  Keyboard: {
    addListener: (name: string, fn: (e: unknown) => void) => {
      listeners[name] = fn;
      return { remove: () => removed.push(name) };
    },
  },
}));

import * as React from 'react';
import * as renderer from 'react-test-renderer';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';

function mount() {
  let height = 0;
  const Probe = () => {
    height = useKeyboardHeight();
    return null;
  };
  let tree: renderer.ReactTestRenderer;
  renderer.act(() => { tree = renderer.create(React.createElement(Probe)); });
  return { read: () => height, unmount: () => renderer.act(() => tree.unmount()) };
}

beforeEach(() => {
  for (const k of Object.keys(listeners)) delete listeners[k];
  removed.length = 0;
  platform = 'android';
});

it('reports nothing while the keyboard is down', () => {
  expect(mount().read()).toBe(0);
});

it('reports the height the OS gives it', () => {
  const probe = mount();
  renderer.act(() => listeners['keyboardDidShow']({ endCoordinates: { height: 320 } }));
  expect(probe.read()).toBe(320);
});

it('goes back to nothing when the keyboard closes', () => {
  const probe = mount();
  renderer.act(() => listeners['keyboardDidShow']({ endCoordinates: { height: 320 } }));
  renderer.act(() => listeners['keyboardDidHide']({}));
  expect(probe.read()).toBe(0);
});

it('survives an event with no coordinates rather than crashing the sheet', () => {
  const probe = mount();
  renderer.act(() => listeners['keyboardDidShow']({}));
  expect(probe.read()).toBe(0);
});

it('listens before the keyboard animates on iOS, and after it lands on Android', () => {
  platform = 'ios';
  mount();
  expect(Object.keys(listeners).sort()).toEqual(['keyboardWillHide', 'keyboardWillShow']);

  for (const k of Object.keys(listeners)) delete listeners[k];
  platform = 'android';
  mount();
  expect(Object.keys(listeners).sort()).toEqual(['keyboardDidHide', 'keyboardDidShow']);
});

it('unsubscribes, so a closed sheet stops listening', () => {
  mount().unmount();
  expect(removed.sort()).toEqual(['keyboardDidHide', 'keyboardDidShow']);
});
