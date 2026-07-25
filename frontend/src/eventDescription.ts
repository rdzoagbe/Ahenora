import { Alert, Linking } from 'react-native';

// Shared parsing/opening helpers for imported-calendar event descriptions.
// Extracted from the Calendar tab so the Feed's event sheet can render the
// same structured chips (location / links / people) instead of raw text.

export type TFunc = (key: string) => string;

export async function openExternal(url: string, t: TFunc) {
  // Do NOT pre-check with canOpenURL: on Android 11+ package-visibility rules
  // make it return false for https/geo unless the manifest declares <queries>,
  // which produced false "no app available" alerts. openURL itself needs no
  // visibility — just try it and only alert on a real failure.
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert(t('cal_couldnt_open'), t('cal_no_app_available'));
  }
}

export function cleanText(value?: string | null) {
  return (value || '').replace(/Ãƒâ€šÃ‚Â·/g, '-').replace(/Â/g, '').trim();
}

export function linkLabel(url: string, t: TFunc): string {
  if (/teams\.microsoft|teams\.live/i.test(url)) return t('cal_teams_meeting');
  if (/zoom\.us/i.test(url)) return t('cal_zoom_meeting');
  if (/meet\.google/i.test(url)) return t('cal_google_meet');
  if (/calendar\.google/i.test(url)) return t('cal_view_in_google_calendar');
  if (/webex/i.test(url)) return t('cal_webex_meeting');
  return t('cal_open_link');
}

export function isVideoLink(url: string): boolean {
  return /teams\.microsoft|teams\.live|zoom\.us|meet\.google|webex/i.test(url);
}

export interface DescriptionParts {
  text: string;
  location: string | null;
  people: string | null;
  links: { url: string; label: string; isVideo: boolean }[];
}

export function parseDescription(raw: string | null | undefined, t: TFunc): DescriptionParts {
  if (!raw) return { text: '', location: null, people: null, links: [] };
  const cleaned = cleanText(raw);
  const lines = cleaned.split('\n');
  let location: string | null = null;
  let people: string | null = null;
  const links: DescriptionParts['links'] = [];
  const textLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^Location:\s*/i.test(trimmed)) {
      const loc = trimmed.replace(/^Location:\s*/i, '').trim();
      if (loc && !/^https?:\/\//i.test(loc)) {
        location = loc;
      } else if (loc) {
        links.push({ url: loc, label: linkLabel(loc, t), isVideo: isVideoLink(loc) });
      }
      continue;
    }

    if (/^People:\s*/i.test(trimmed)) {
      people = trimmed.replace(/^People:\s*/i, '').trim();
      continue;
    }

    if (/^(Google Calendar|Outlook):\s*/i.test(trimmed)) {
      const isGoogle = /^Google Calendar:/i.test(trimmed);
      const url = trimmed.replace(/^(Google Calendar|Outlook):\s*/i, '').trim();
      if (url) {
        links.push({
          url,
          label: isGoogle ? t('cal_view_in_google_calendar') : linkLabel(url, t),
          isVideo: false,
        });
      }
      continue;
    }

    const urlMatch = trimmed.match(/https?:\/\/[^\s]+/g);
    if (urlMatch) {
      for (const url of urlMatch) {
        links.push({ url, label: linkLabel(url, t), isVideo: isVideoLink(url) });
      }
      const remaining = trimmed.replace(/https?:\/\/[^\s]+/g, '').trim();
      if (remaining) textLines.push(remaining);
      continue;
    }

    textLines.push(trimmed);
  }

  return { text: textLines.join('\n').trim(), location, people, links };
}
