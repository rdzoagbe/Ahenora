/**
 * Recipe amounts in grams and kilos, written the reader's way.
 *
 * The server now asks for flour, sugar and oil in grams (see
 * tests/test_cakes_are_weighed.py); here, how those amounts read.
 */
import { formatAiQuantity, quantityFor } from '../recipeQuantities';

describe('weights on a recipe', () => {
  it('grams stay grams, rounded like a recipe', () => {
    expect(formatAiQuantity({ name: 'farine', qty: 210, unit: 'g' }, 4, 4, 'fr')).toBe('210 g');
    expect(formatAiQuantity({ name: 'sucre', qty: 200, unit: 'g' }, 6, 4, 'fr')).toBe('300 g');
  });

  it('past a kilo they read in kilos, with a decimal comma in French', () => {
    expect(formatAiQuantity({ name: 'farine', qty: 800, unit: 'g' }, 6, 4, 'fr')).toBe('1,2 kg');
    expect(formatAiQuantity({ name: 'flour', qty: 800, unit: 'g' }, 6, 4, 'en')).toBe('1.2 kg');
    expect(quantityFor('potato', 6, 'fr')).toBe('1,2 kg');
    expect(quantityFor('yam', 4, 'fr')).toBe('1 kg');
  });

  it('litres the same way', () => {
    expect(formatAiQuantity({ name: 'lait', qty: 1.5, unit: 'l' }, 4, 4, 'fr')).toBe('1,5 L');
  });
});
