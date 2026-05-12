interface Props {
  onManual: () => void;
  onCamera: () => void;
  onVoice: () => void;
}

/**
 * The Feed screen now exposes Voice, Scan, Manual, and Brief through the
 * Quick actions section, so this duplicate bottom overlay is intentionally
 * disabled to keep the tab/navigation area clean.
 */
export function FloatingActionBar(_props: Props) {
  return null;
}
