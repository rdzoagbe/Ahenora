/**
 * When the co-parent balance belongs on the home screen.
 *
 * The number itself was built long ago and lived at the bottom of the spending
 * view, inside the Kitchen tab, under two months of charts — four taps and a
 * scroll from the one thing two separated parents most want from the app. The
 * card puts it on the Feed. The rule below is what keeps it from also putting
 * "square with nobody · 0 shared costs" on every other family's home screen.
 */
import { shouldShowBalance } from '../coParentBalance';

describe('shouldShowBalance', () => {
  it('shows a real balance in either direction', () => {
    expect(shouldShowBalance({ enabled: true, balance: 62.5, shared_count: 4 })).toBe(true);
    expect(shouldShowBalance({ enabled: true, balance: -62.5, shared_count: 4 })).toBe(true);
  });

  it('shows a settled balance, because "you are square" is worth knowing', () => {
    expect(shouldShowBalance({ enabled: true, balance: 0, shared_count: 9 })).toBe(true);
  });

  it('stays hidden for a household that has never split anything', () => {
    expect(shouldShowBalance({ enabled: true, balance: 0, shared_count: 0 })).toBe(false);
    expect(shouldShowBalance({ enabled: true, balance: 0 })).toBe(false);
  });

  it('stays hidden when the household is not two parents', () => {
    // The server decides this: a solo parent, or three adults, has no balance
    // defined between them.
    expect(shouldShowBalance({ enabled: false, balance: 0 })).toBe(false);
    expect(shouldShowBalance({ enabled: false, balance: 40, shared_count: 3 })).toBe(false);
  });

  it('stays hidden when the call failed or the server is older', () => {
    expect(shouldShowBalance(null)).toBe(false);
    expect(shouldShowBalance(undefined)).toBe(false);
  });
});
