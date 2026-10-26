import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ChevronRight, CookingPot } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';
import type { MealPlan } from '../api';
import { localizedMealTitle, SuggestLang } from '../mealSuggestions';

/**
 * What the family is eating tonight, under the day's list.
 *
 * "What's for dinner?" is asked in every home every afternoon, and the answer
 * lived three taps into the Kitchen. Renders nothing when no meal is planned
 * for today — an empty card asking you to plan one would be a nag on Home.
 */
export function DinnerTonight({ meal, onOpen }: { meal: MealPlan | null; onOpen: () => void }) {
  const ui = useUI();
  const { t, lang } = useStore();
  const styles = useMemo(() => createStyles(ui), [ui]);
  if (!meal) return null;

  // The Kitchen's own rule: a library dish is re-titled in the current
  // language; a dish the family typed, or rewrote, keeps their words.
  const suggestLang: SuggestLang = (['en', 'es', 'fr', 'de'].includes(lang) ? lang : 'en') as SuggestLang;
  const hasOwnRecipe = !!meal.ai_recipe && Object.keys(meal.ai_recipe).length > 0;
  const title = hasOwnRecipe ? meal.title : localizedMealTitle(meal.recipe_id, meal.title, suggestLang);

  return (
    <PressScale
      testID="home-dinner-tonight"
      accessibilityRole="button"
      accessibilityLabel={`${t('home_dinner_tonight')}: ${title}`}
      onPress={onOpen}
      style={styles.card}
    >
      <View style={styles.tile}>
        <CookingPot color={ui.goldText} size={22} />
      </View>
      <View style={styles.body}>
        <Text style={styles.eyebrow}>{t('home_dinner_tonight')}</Text>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
      </View>
      <ChevronRight color={ui.goldText} size={18} />
    </PressScale>
  );
}

function createStyles(ui: UIColors) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 14, paddingVertical: 12, borderRadius: 20,
      backgroundColor: ui.gold, marginTop: 14, marginBottom: 14,
    },
    tile: { width: 40, height: 40, borderRadius: 12, backgroundColor: ui.card, alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1, minWidth: 0 },
    eyebrow: { color: ui.goldText, fontFamily: 'Figtree_800ExtraBold', fontSize: 13 },
    title: { color: ui.text, fontFamily: 'Figtree_800ExtraBold', fontSize: 16, lineHeight: 21 },
  });
}
