import { redirectSystemPath } from '../../app/+native-intent';

// From 1.2.1 an invitation link (https://ahenora.com/join/?invite=…) opens the
// app. The app has no /join screen, so the link is turned into the welcome
// screen carrying the invitation. Everything else must pass through untouched.
describe('an invitation link opening the app', () => {
  it('lands on the welcome screen with the invitation, in every language', () => {
    for (const prefix of ['', '/fr', '/es', '/de']) {
      expect(redirectSystemPath({ path: `https://ahenora.com${prefix}/join/?invite=2B8o_x-9`, initial: true }))
        .toBe('/?invite=2B8o_x-9');
      expect(redirectSystemPath({ path: `${prefix}/join/?invite=abc12345`, initial: false }))
        .toBe('/?invite=abc12345');
    }
  });

  it('still opens the app when the invitation is missing from the link', () => {
    expect(redirectSystemPath({ path: 'https://ahenora.com/join/', initial: true })).toBe('/');
  });

  it('leaves every other link alone, sign-in redirects above all', () => {
    for (const path of [
      'householdcoo://oauthredirect?code=xyz',
      '/oauthredirect',
      '/feed',
      '/joint-account',
      'https://ahenora.com/app/?invite=abc12345',
      '',
    ]) {
      expect(redirectSystemPath({ path, initial: true })).toBe(path);
    }
  });
});
