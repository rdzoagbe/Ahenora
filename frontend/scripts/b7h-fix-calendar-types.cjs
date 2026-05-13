const fs = require("fs");
const path = require("path");

const file = path.join(process.cwd(), "app", "(tabs)", "calendar.tsx");
let content = fs.readFileSync(file, "utf8");

// Fix AuthSessionResult typing by casting prompt result to any.
content = content.replace(
  "      const result = await promptCalendarAsync();",
  "      const result = (await promptCalendarAsync()) as any;"
);

// Make calendarSyncStatus visibly used in the Google Calendar sync card.
if (
  content.includes('testID="calendar-sync-card-button"') &&
  !content.includes("{calendarSyncStatus ? (")
) {
  const buttonClose = `            </PressScale>

            {!calendarRequest ? (`;

  const replacement = `            </PressScale>

            {calendarSyncStatus ? (
              <Text style={[styles.calendarSyncHint, { color: theme.colors.textMuted }]}>{calendarSyncStatus}</Text>
            ) : !calendarRequest ? (`;

  if (content.includes(buttonClose)) {
    content = content.replace(buttonClose, replacement);
  }
}

// If the previous replacement created an old closing condition, normalize it.
content = content.replace(
  "            ) : null}",
  "            ) : null}"
);

fs.writeFileSync(file, content, { encoding: "utf8" });

console.log("Calendar AuthSession typing fixed.");
