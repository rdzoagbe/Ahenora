import { BookOpen, Receipt, Scale, Shield, Stethoscope } from 'lucide-react-native';

import { UI, UIColors } from './components/Kit';

/**
 * The drawers a photographed document can go in.
 *
 * These used to exist twice — as a sentence inside a prompt on the server and
 * as a list in the vault screen — so adding one in either place left the two
 * quietly disagreeing. This is the app's copy; the authority is
 * VAULT_CATEGORIES in backend/ai_safety.py, and the two must be changed
 * together.
 *
 * Bills is the newest, and the reason the router is worth having: a gas bill
 * used to be filed under School, because School was one of only four options
 * the model was offered.
 */
export const DOCUMENT_CATEGORIES = [
  'Medical',
  'School',
  'Insurance',
  'Legal',
  'Bills',
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

/** Icon and colour pair per drawer. Fills and ink stay in their own roles. */
export const CATEGORY_STYLE: Record<
  DocumentCategory,
  { icon: any; tone: (ui: UIColors) => string; soft: (ui: UIColors) => string }
> = {
  Medical: { icon: Stethoscope, tone: (ui) => ui.orangeText, soft: (ui) => ui.orangeSoft },
  School: { icon: BookOpen, tone: (ui) => ui.lavenderText, soft: (ui) => ui.lavender },
  Insurance: { icon: Shield, tone: (ui) => ui.mintText, soft: (ui) => ui.mint },
  Legal: { icon: Scale, tone: (ui) => ui.goldText, soft: (ui) => ui.gold },
  Bills: { icon: Receipt, tone: (ui) => ui.blueText, soft: (ui) => ui.blue },
};

export function isDocumentCategory(value: unknown): value is DocumentCategory {
  return typeof value === 'string' && (DOCUMENT_CATEGORIES as readonly string[]).includes(value);
}

/**
 * The label to show for a stored category.
 *
 * Documents filed before a category existed — or by a hand-typed one — still
 * have to render, so an unknown value is shown as itself rather than being
 * silently relabelled as something the family never chose.
 */
export function categoryStyle(key: string) {
  return isDocumentCategory(key) ? CATEGORY_STYLE[key] : CATEGORY_STYLE.Medical;
}

/** Static fallback for places that render outside a theme context. */
export const CATEGORY_STATIC = DOCUMENT_CATEGORIES.map((key) => ({
  key,
  icon: CATEGORY_STYLE[key].icon,
  tone: CATEGORY_STYLE[key].tone(UI),
  soft: CATEGORY_STYLE[key].soft(UI),
}));
