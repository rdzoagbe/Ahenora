/**
 * The boundary, proved by throwing at it.
 *
 * There is a sibling file that checks WHERE this component sits and what it is
 * allowed to import. Those are structural facts and worth pinning. But they are
 * the same kind of check that let a crash ship green: the guard around the
 * voice recorder had a passing test too, written against a mock that threw a
 * JavaScript error — which is not what a missing native module does.
 *
 * So this one renders a component that throws and looks at what the person
 * would actually see.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

import { RootErrorBoundary } from '../components/RootErrorBoundary';

function Boom({ explode }: { explode: boolean }): React.ReactElement {
  if (explode) throw new Error('render blew up');
  return <Text>the app</Text>;
}

describe('RootErrorBoundary', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    // React logs the caught error itself. That is expected here and would
    // otherwise bury a real failure in noise.
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => consoleError.mockRestore());

  it('shows the app when nothing is wrong', async () => {
    const view = await render(
      <RootErrorBoundary>
        <Boom explode={false} />
      </RootErrorBoundary>,
    );
    expect(view.getByText('the app')).toBeTruthy();
    expect(view.queryByTestId('root-error')).toBeNull();
  });

  it('catches a throw instead of taking the app down', async () => {
    const view = await render(
      <RootErrorBoundary>
        <Boom explode />
      </RootErrorBoundary>,
    );
    // The point of the whole exercise: something is on screen.
    expect(view.getByTestId('root-error')).toBeTruthy();
  });

  it('says something a person can read, not a stack trace', async () => {
    const view = await render(
      <RootErrorBoundary>
        <Boom explode />
      </RootErrorBoundary>,
    );
    // The device language in a test environment is English; the point is that
    // a translated string was resolved rather than a key printed raw.
    expect(view.getByText('Something went wrong')).toBeTruthy();
    expect(view.queryByText('err_something_wrong')).toBeNull();
  });

  it('offers a way back, and the way back works', async () => {
    // A boundary with no reset is a boundary that turns one bad render into a
    // dead screen until the app is force-closed.
    const view = await render(
      <RootErrorBoundary>
        <Boom explode />
      </RootErrorBoundary>,
    );
    expect(view.getByTestId('root-error')).toBeTruthy();

    // Whatever was wrong is no longer wrong — an update arrived, a network came
    // back — and the retry has to actually let the app render again.
    await view.rerender(
      <RootErrorBoundary>
        <Boom explode={false} />
      </RootErrorBoundary>,
    );
    await fireEvent.press(view.getByTestId('root-error-retry'));
    expect(view.getByText('the app')).toBeTruthy();
  });

  it('survives the failure it was built for: a module that is not there', async () => {
    // The actual shape of yesterday's crash. `require` of a native module
    // missing from the binary — not a tidy Error thrown on purpose.
    function MissingNativeModule(): React.ReactElement {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('a-module-this-binary-does-not-have');
      return <Text>unreachable</Text>;
    }
    const view = await render(
      <RootErrorBoundary>
        <MissingNativeModule />
      </RootErrorBoundary>,
    );
    expect(view.getByTestId('root-error')).toBeTruthy();
  });
});
