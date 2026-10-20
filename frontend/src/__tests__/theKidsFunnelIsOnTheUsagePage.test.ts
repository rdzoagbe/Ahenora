/**
 * The kids' wedge can be read on the Usage page.
 *
 * Ahenora is sold on chores the kids want to finish. The store listings, the
 * setup step and the trial thank-you all lead with the children; this pins
 * the read-out that says whether that works, so it cannot quietly drop off the
 * page while the pitch stays.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const METRICS = readFileSync(join(ROOT, 'app', 'metrics.tsx'), 'utf8');
const API = readFileSync(join(ROOT, 'src', 'api.ts'), 'utf8');
const SERVER = readFileSync(join(ROOT, '..', 'backend', 'server.py'), 'utf8');

describe("the kids' funnel", () => {
  it('is served to admins only, from the households created in the window', () => {
    const start = SERVER.indexOf('@app.get("/api/metrics/kids_funnel")');
    expect(start).toBeGreaterThan(0);
    const body = SERVER.slice(start, SERVER.indexOf('@app.get("/api/metrics/retention")'));
    expect(body).toContain('if not is_admin_user(user):');
    expect(body).toContain('"role": {"$regex": "^(child|teen)$", "$options": "i"}');
    for (const key of ['new_households', 'with_children', 'first_star', 'chore_done',
                       'week_two_eligible', 'week_two_active', 'paying']) {
      expect([key, body.includes(`"${key}": len(`)]).toEqual([key, true]);
    }
  });

  it('is fetched and shown on the Usage page, each line a share of the one above', () => {
    expect(API).toContain("request<KidsFunnel>(`/metrics/kids_funnel?days=${days}`)");
    expect(METRICS).toContain('api.getKidsFunnel(30).then(setKids)');
    expect(METRICS).toContain('testID="kids-funnel"');
    const section = METRICS.slice(METRICS.indexOf('testID="kids-funnel"'));
    expect(section).toContain("['Named a child', kids.with_children, kids.new_households]");
    expect(section).toContain("['Gave a first star', kids.first_star, kids.with_children]");
    expect(section).toContain("['A child finished a chore', kids.chore_done, kids.first_star]");
    expect(section).toContain('kids.week_two_active, kids.week_two_eligible]');
    expect(section).toContain("['Paying', kids.paying, kids.week_two_active]");
  });

  it('keeps every field the page reads in the API type', () => {
    const type = API.slice(API.indexOf('export interface KidsFunnel'), API.indexOf('}', API.indexOf('export interface KidsFunnel')));
    for (const key of ['new_households', 'with_children', 'first_star', 'chore_done',
                       'week_two_eligible', 'week_two_active', 'paying']) {
      expect([key, type.includes(`${key}: number;`)]).toEqual([key, true]);
    }
  });
});
