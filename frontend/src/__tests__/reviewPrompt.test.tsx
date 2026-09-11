/**
 * The rating sheet must be asked for once, and then never again.
 *
 * Reported from a real phone: every time she ticked a task off, "a survey"
 * appeared. That survey is the OS review sheet — asked on a win, which is the
 * right moment, and then asked again on the next win, and the next.
 *
 * The one-time flag was written AFTER the request. So any request that threw —
 * and the Play in-app review flow can reject for its own reasons — left the
 * flag unwritten and the counter already past the threshold, which means every
 * subsequent completed task asked again. The code read as "ask once"; what it
 * did was "ask once if nothing goes wrong, and forever if anything does".
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

// The real module is reached through a dynamic import, which jest cannot
// intercept — which is exactly why recordWin takes an injectable provider.
// Without that seam none of the decision below could be tested at all, and
// that is how "ask once" shipped asking on every tick.
const mockRequestReview = jest.fn();
const mockHasAction = jest.fn();
const fakeStoreReview = async () => ({
  requestReview: mockRequestReview,
  hasAction: mockHasAction,
});

const store = new Map<string, string>();
const asMock = AsyncStorage as unknown as { getItem: jest.Mock; setItem: jest.Mock };

import { recordWin, resetReviewPromptForTests } from '../reviewPrompt';

/** A new app session: storage persists, the in-memory guard does not. */
const newSession = () => { resetReviewPromptForTests(); };

/** Tick off `n` tasks, as a parent would over a few days. */
const completeTasks = async (n: number) => {
  for (let i = 0; i < n; i += 1) await recordWin(fakeStoreReview);
};

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
  resetReviewPromptForTests();
  asMock.getItem.mockImplementation(async (k: string) => store.get(k) ?? null);
  asMock.setItem.mockImplementation(async (k: string, v: string) => { store.set(k, v); });
  mockHasAction.mockResolvedValue(true);
  mockRequestReview.mockResolvedValue(undefined);
});

describe('asking for a review', () => {
  it('says nothing until the app has actually helped a few times', async () => {
    await completeTasks(4);
    expect(mockRequestReview).not.toHaveBeenCalled();
  });

  it('asks once the wins add up', async () => {
    await completeTasks(5);
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
  });

  it('does not ask again on the next task', async () => {
    await completeTasks(12);
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
  });

  it('does not ask again in a later session', async () => {
    await completeTasks(5);
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
    // App reopened; storage persists.
    newSession();
    await completeTasks(5);
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
  });

  // --- the bug ---------------------------------------------------------

  it('does not ask every single time when the sheet fails', async () => {
    // The report. The flag was written after the request, so a request that
    // rejected left it unwritten — and the win count was already past the
    // threshold, so every completed task asked again.
    mockRequestReview.mockRejectedValue(new Error('play services said no'));
    await completeTasks(10);
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
  });

  it('does not ask every time when the flag itself cannot be stored', async () => {
    // The flag is a write, and a write can fail. The win counter keeps working
    // — so without an in-memory guard the count stays past the threshold and
    // every tick asks again, which is the reported symptom by another route.
    asMock.setItem.mockImplementation(async (k: string, v: string) => {
      if (k === 'coo_review_asked_at') throw new Error('storage full');
      store.set(k, v);
    });
    await completeTasks(10);
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
  });

  it('keeps its one chance when the OS says it will not show a sheet', async () => {
    // hasAction false means nothing would appear. Burning the one-time flag
    // there would mean never asking a parent who would have said yes.
    mockHasAction.mockResolvedValue(false);
    await completeTasks(6);
    expect(mockRequestReview).not.toHaveBeenCalled();

    mockHasAction.mockResolvedValue(true);
    newSession();
    await completeTasks(1);
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
  });

  it('never lets a completed task throw at the caller', async () => {
    // It is called from the tick handler. A rating prompt must never be able
    // to break ticking a task off.
    asMock.getItem.mockRejectedValue(new Error('storage broken'));
    await expect(recordWin(fakeStoreReview)).resolves.toBeUndefined();
  });
});
