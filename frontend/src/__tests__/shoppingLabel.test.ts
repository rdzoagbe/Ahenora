import { shoppingLabel } from '../shoppingCategories';

/**
 * A photographed recipe becomes a shopping list, and the list is read in a
 * shop by somebody in a hurry. These check that the structured amounts turn
 * back into the way people actually write things down.
 */
describe('shoppingLabel', () => {
  it('writes a weight the way a list does', () => {
    expect(shoppingLabel({ name: 'Tomatoes', qty: 400, unit: 'g' })).toBe('Tomatoes 400g');
  });

  it('counts whole things rather than weighing them', () => {
    expect(shoppingLabel({ name: 'Eggs', qty: 6, unit: 'piece' })).toBe('Eggs x6');
  });

  it('drops the amount for anything measured by taste', () => {
    // qty 0 with "to taste" means there is no number, not zero of them.
    expect(shoppingLabel({ name: 'Salt', qty: 0, unit: 'to taste' })).toBe('Salt');
  });

  it('survives a recipe that carries no amount at all', () => {
    expect(shoppingLabel({ name: 'Olive oil', qty: null, unit: 'ml' })).toBe('Olive oil');
  });
});
