/**
 * The Kitchen opens on the meals.
 *
 * Roland, 2026-10-30: yes to the Kitchen opening on Meals rather than the
 * shopping list. Every door that is about the LIST now asks for it by name,
 * so "open the shopping list" on Home, a shopping push and a shopping search
 * hit still land on the list, and the Kitchen's own tabs still work. This
 * pins:
 *
 *  - the screen's own default is the meals, and a ?view=shop asks for the
 *    list until a tab is picked;
 *  - the three doors that want the list say so;
 *  - a dinner door lands on the meals without asking.
 */
import fs from 'fs';
import path from 'path';

import { targetForNotification } from '../notificationRouting';

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const kitchen = read('app', '(tabs)', 'kitchen.tsx');
const feed = read('app', '(tabs)', 'feed.tsx');
const search = read('app', '(tabs)', 'search.tsx');

describe('the Kitchen opens on the meals', () => {
  it('by default, and on the list only when a door asks for it', () => {
    expect(kitchen).toContain("const [chosenView, setView] = useState<KitchenView>('meal');");
    expect(kitchen).toContain("const view: KitchenView = askedView === 'shop' || askedView === 'spend' ? askedView : chosenView;");
    expect(kitchen).not.toContain("useState<KitchenView>('shop')");
  });

  it('forgets the asked-for view once a tab is picked', () => {
    expect(kitchen).toContain('if (askedView) router.setParams({ view: undefined });');
  });

  it('is asked for the list by the doors that are about the list', () => {
    expect(feed).toContain("onOpenShopping={() => router.navigate({ pathname: '/(tabs)/kitchen', params: { view: 'shop' } } as never)}");
    expect(search).toContain("shopping: { pathname: '/(tabs)/kitchen', params: { view: 'shop' } },");
    expect(targetForNotification({ type: 'shopping_added', family_id: 'f' })).toEqual({ pathname: '/(tabs)/kitchen', params: { view: 'shop' } });
    expect(targetForNotification({ type: 'shopping_done', family_id: 'f' })).toEqual({ pathname: '/(tabs)/kitchen', params: { view: 'shop' } });
  });

  it('is not asked for anything by a dinner door', () => {
    expect(feed).toContain("<DinnerTonight meal={tonight} onOpen={() => router.navigate('/(tabs)/kitchen' as never)} />");
    expect(search).toContain("meal: '/(tabs)/kitchen',");
    expect(targetForNotification({ type: 'dinner_reminder', family_id: 'f' })).toEqual({ pathname: '/(tabs)/kitchen' });
  });
});
