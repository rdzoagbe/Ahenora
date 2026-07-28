import { categoriseShoppingItem } from '../shoppingCategories';

describe('categoriseShoppingItem', () => {
  it('sorts a real family list into aisles', () => {
    // Every one of these previously stored "Other", because the app never
    // sent a category at all.
    const expected: [string, string][] = [
      ['Sweet potato', 'Produce'],
      ["Yam's", 'Produce'],
      ['Porc ribs', 'Meat'],
      ['Corn flour', 'Pantry'],
      ['Okro', 'Produce'],
      ['Bell peppers', 'Produce'],
      ['Garden eggs', 'Produce'],
      ['Tomatoes', 'Produce'],
      ['Rice', 'Pantry'],
      ['Chicken thighs', 'Meat'],
      ['Maïs', 'Pantry'],
      ['Beef', 'Meat'],
    ];
    for (const [name, aisle] of expected) {
      expect([name, categoriseShoppingItem(name)]).toEqual([name, aisle]);
    }
  });

  it('reads the four app languages', () => {
    expect(categoriseShoppingItem('Poulet')).toBe('Meat');
    expect(categoriseShoppingItem('Pommes de terre')).toBe('Produce');
    expect(categoriseShoppingItem('Leche')).toBe('Dairy');
    expect(categoriseShoppingItem('Zwiebeln')).toBe('Produce');
    expect(categoriseShoppingItem('Papier toilette')).toBe('Household');
  });

  it('lets the more specific term win', () => {
    // "corn flour" over "flour", "chocolate" over "milk".
    expect(categoriseShoppingItem('Corn flour')).toBe('Pantry');
    expect(categoriseShoppingItem('Flour')).toBe('Bakery');
    expect(categoriseShoppingItem('Chocolate milk')).toBe('Snacks');
    expect(categoriseShoppingItem('Milk')).toBe('Dairy');
  });

  it('does not read garden eggs as eggs, or sweet potato as potato', () => {
    expect(categoriseShoppingItem('Garden eggs')).toBe('Produce');
    expect(categoriseShoppingItem('Eggs')).toBe('Dairy');
  });

  it('handles the non-food half of a family list', () => {
    expect(categoriseShoppingItem('Nappies')).toBe('Baby');
    expect(categoriseShoppingItem('Washing up liquid')).toBe('Household');
    expect(categoriseShoppingItem('Paracetamol')).toBe('Health');
    expect(categoriseShoppingItem('Notebook')).toBe('School');
    expect(categoriseShoppingItem('Orange juice')).toBe('Drinks');
  });

  it('says nothing rather than guessing wrong', () => {
    // A wrong aisle sends someone to the wrong end of the shop.
    expect(categoriseShoppingItem('Birthday present for Ama')).toBeNull();
    expect(categoriseShoppingItem('')).toBeNull();
    expect(categoriseShoppingItem('   ')).toBeNull();
  });
});
