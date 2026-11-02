/**
 * Small touches of life.
 *
 * Roland, 2026-11-02, from the plan of 2026-10-31 ("gentle movement when a
 * child earns stars or a task is ticked off"): "Ok go for 2". This pins that:
 *
 *  - the movement is React Native's own Animated on the native driver, so it
 *    ships over the air and costs the JavaScript thread nothing;
 *  - every piece stands still for a person who asked their phone for less
 *    motion;
 *  - the haptic tap can never break what it celebrates, is skipped on the web,
 *    and uses a native module the store builds already carry;
 *  - where it shows: the star count on a child's page, the tick of a task just
 *    completed on Home, and the "Now" line.
 */
import fs from 'fs';
import path from 'path';

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const motion = read('src', 'components', 'Motion.tsx');
const feed = read('app', '(tabs)', 'feed.tsx');
const kid = read('src', 'components', 'KidPageTop.tsx');

describe('the movement', () => {
  it("is React Native's own Animated, on the native driver, and adds no package", () => {
    expect(motion).toMatch(/from 'react-native';/);
    expect(motion).not.toMatch(/react-native-reanimated|from 'moti'|lottie/);
    const drivers = motion.match(/useNativeDriver: (true|false)/g) || [];
    expect(drivers.length).toBeGreaterThan(0);
    drivers.forEach((d) => expect(d).toBe('useNativeDriver: true'));
  });

  it('stands still when the phone asks for less motion, in every piece', () => {
    ['PulseDot', 'PopIn', 'Bump', 'StarBurst'].forEach((name) => {
      const body = motion.slice(motion.indexOf(`export function ${name}`));
      const end = body.indexOf('\nexport function', 10);
      const fn = end > 0 ? body.slice(0, end) : body;
      expect(fn).toMatch(/const reduced = useReducedMotion\(\);/);
      expect(fn).toMatch(/reduced/);
    });
    const hook = read('src', 'hooks', 'useReducedMotion.ts');
    expect(hook).toMatch(/AccessibilityInfo\.isReduceMotionEnabled\(\)/);
    expect(hook).toMatch(/addEventListener\('reduceMotionChanged'/);
  });
});

describe('the haptic tap', () => {
  const tap = motion.slice(motion.indexOf('export function successTap'));

  it('is skipped on the web and can never throw into what it celebrates', () => {
    expect(tap).toMatch(/if \(Platform\.OS === 'web'\) return;/);
    expect(tap).toMatch(/try \{/);
    expect(tap).toMatch(/\.catch\(\(\) => \{\}\)/);
  });

  it('uses a native module the store builds already carry', () => {
    const modules = JSON.parse(read('native-modules.json'));
    expect(JSON.stringify(modules)).toContain('"expo-haptics"');
  });
});

describe('where it shows', () => {
  it("bumps a child's stars and floats \"+n ★\" the moment a parent gives them or ticks a job", () => {
    expect(kid).toMatch(/<Bump trigger=\{burst\?\.key\}>/);
    expect(kid).toMatch(/<View style=\{styles\.burstAnchor\}>\s*<StarBurst burst=\{burst\} color=\{ink\} \/>/);
    expect(kid).toMatch(/onPress=\{\(\) => \{ celebrate\(j\.star_reward\); onDoJob\(j\); \}\}/);
    expect(kid).toMatch(/onPress=\{\(\) => give\(1, t\('hub_well_done'\)\)\}/);
  });

  it('pops the tick of a task just completed on Home, once', () => {
    expect(feed).toMatch(/setJustDone\(card\.card_id\);\s*successTap\(\);/);
    expect(feed).toMatch(/justDone=\{row\.done && row\.card\.card_id === justDone\}/);
    expect(feed).toMatch(/<PopIn active=\{justDone\}/);
  });

  it('lets the "Now" line breathe', () => {
    expect(feed).toMatch(/<PulseDot color=\{ui\.orange\} testID="home-now-dot" \/>/);
  });
});
