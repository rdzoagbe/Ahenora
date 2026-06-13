const fs = require("fs");
const path = require("path");

const file = path.join(process.cwd(), "app", "(tabs)", "calendar.tsx");
let content = fs.readFileSync(file, "utf8");

if (content.includes('testID="calendar-sync-card"')) {
  console.log("Calendar sync card already exists.");
  process.exit(0);
}

const syncCard = `          <GlassCard testID="calendar-sync-card" style={styles.calendarSyncCard}>
            <View style={styles.calendarSyncHeader}>
              <View style={[styles.calendarSyncIcon, { backgroundColor: theme.colors.accentSoft }]}>
                <CalendarDays color={theme.colors.accent} size={22} />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={[styles.calendarSyncTitle, { color: theme.colors.text }]}>Google Calendar</Text>
                <Text style={[styles.calendarSyncText, { color: theme.colors.textMuted }]}>
                  Read-only sync. Imports upcoming events and people, but never edits your Google Calendar.
                </Text>
              </View>
            </View>

            <PressScale
              testID="calendar-sync-card-button"
              onPress={syncCalendar}
              disabled={syncing || (Platform.OS === 'web' && !calendarRequest)}
              style={[
                styles.calendarSyncButton,
                { backgroundColor: theme.colors.primary },
                (syncing || (Platform.OS === 'web' && !calendarRequest)) && { opacity: 0.55 },
              ]}
            >
              {syncing ? (
                <ActivityIndicator color={theme.colors.primaryText} size="small" />
              ) : (
                <RefreshCw color={theme.colors.primaryText} size={18} />
              )}
              <Text style={[styles.calendarSyncButtonText, { color: theme.colors.primaryText }]}>
                {syncing ? 'Syncing Google Calendar' : 'Sync Google Calendar'}
              </Text>
            </PressScale>

            {calendarSyncStatus ? (
              <Text style={[styles.calendarSyncHint, { color: theme.colors.textMuted }]}>{calendarSyncStatus}</Text>
            ) : (
              <Text style={[styles.calendarSyncHint, { color: theme.colors.textMuted }]}>Last sync result will appear here.</Text>
            )}
          </GlassCard>`;

const privacyCardRegex =
  /          <GlassCard style=\{\{ marginBottom: 18 \}\}>\r?\n            <View style=\{styles\.privacyRow\}>\r?\n              <ShieldCheck color=\{theme\.colors\.success\} size=\{20\} \/>\r?\n              <Text style=\{\[styles\.privacyText, \{ color: theme\.colors\.textMuted \}\]\}>Calendar sync is read-only\. Household COO imports reminders and suggests invitees; it does not edit your Google Calendar\.<\/Text>\r?\n            <\/View>\r?\n          <\/GlassCard>/;

if (!privacyCardRegex.test(content)) {
  throw new Error("Could not find old Calendar privacy card to replace.");
}

content = content.replace(privacyCardRegex, syncCard);

if (!content.includes("calendarSyncCard:")) {
  const styleMarker = "  privacyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },";

  const stylesToAdd = `  calendarSyncCard: {
    marginBottom: 14,
  },
  calendarSyncHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  calendarSyncIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarSyncTitle: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 17,
    lineHeight: 22,
  },
  calendarSyncText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  calendarSyncButton: {
    minHeight: 48,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  calendarSyncButtonText: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 14,
  },
  calendarSyncHint: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
    textAlign: 'center',
  },

`;

  if (!content.includes(styleMarker)) {
    throw new Error("Could not find Calendar style marker.");
  }

  content = content.replace(styleMarker, stylesToAdd + styleMarker);
}

content = content.replace(
  "          <View style={{ height: 220 }} />",
  "          <View style={{ height: 80 }} />"
);

fs.writeFileSync(file, content, { encoding: "utf8" });

console.log("Visible Google Calendar sync card restored.");
