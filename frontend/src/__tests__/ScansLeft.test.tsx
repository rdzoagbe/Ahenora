/**
 * The countdown, rendered rather than described.
 *
 * There is a sibling test that greps this component's source for `left >
 * WARN_AT` and `limit >= 1000`. That check would pass if the thresholds were
 * inverted, or if the component returned null in every case — it only proves
 * the numbers are mentioned. This one mounts it and reads what a parent sees.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

import { ScansLeft } from '../components/ScansLeft';

// jest only lets a mock factory close over names beginning with `mock`.
const mockTheme = {
  colors: {
    accentSoft: '#FDEDE2', accentInk: '#B8410A', cardBorder: '#EAE0D5',
    danger: '#C81E1E', text: '#1A1614', textMuted: '#6B625C',
  },
};

let mockSubscription: any = null;

jest.mock('../store', () => ({
  useStore: () => ({
    subscription: mockSubscription,
    theme: mockTheme,
    t: (key: string, vars?: Record<string, number>) =>
      (vars && 'n' in vars ? `${key}:${vars.n}` : key),
  }),
}));

const withPlan = (used: number, limit: number) => {
  mockSubscription = { ai_scans_used: used, limits: { ai_scans_per_month: limit } };
};

describe('ScansLeft', () => {
  afterEach(() => { mockSubscription = null; });

  it('says nothing while there is plenty left', async () => {
    // A counter on every scan turns a generous allowance into something to
    // ration, which is the opposite of the point.
    withPlan(2, 10);
    const view = await render(<ScansLeft />);
    expect(view.queryByTestId('scans-left')).toBeNull();
  });

  it('speaks up as it runs low, with the number remaining', async () => {
    withPlan(7, 10);
    const view = await render(<ScansLeft />);
    expect(view.getByTestId('scans-left')).toBeTruthy();
    expect(view.getByText('scans_left:3')).toBeTruthy();
  });

  it('says something different when there are none', async () => {
    // "0 scans left" and "no scans left" are not the same sentence, and the
    // second is the one that has to explain itself.
    withPlan(10, 10);
    const view = await render(<ScansLeft />);
    expect(view.getByText('scans_none_left')).toBeTruthy();
  });

  it('never counts down a ceiling nobody can reach', async () => {
    // Paid plans carry a guard against a runaway loop, not a budget. Counting
    // down from it would be theatre — and would make a household believe there
    // is a limit worth worrying about.
    withPlan(99998, 100000);
    const view = await render(<ScansLeft />);
    expect(view.queryByTestId('scans-left')).toBeNull();
  });

  it('renders nothing at all before the plan is known', async () => {
    // The subscription loads after the first paint. A warning that flashes on
    // every cold start is worse than no warning.
    mockSubscription = null;
    const view = await render(<ScansLeft />);
    expect(view.queryByTestId('scans-left')).toBeNull();
  });
});
