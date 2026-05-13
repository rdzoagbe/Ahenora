const fs = require("fs");
const path = require("path");

const file = path.join(process.cwd(), "app", "(tabs)", "calendar.tsx");
let content = fs.readFileSync(file, "utf8");

if (!content.includes("syncCalendarWithNativeGoogle")) {
  throw new Error("Native sync function is missing. Apply the B7G native Google Calendar sync patch first.");
}

// Android should not require calendarRequest because native GoogleSignin handles Android.
content = content.replaceAll(
  "disabled={syncing || !calendarRequest}",
  "disabled={syncing || (Platform.OS === 'web' && !calendarRequest)}"
);

content = content.replaceAll(
  "(syncing || !calendarRequest) && { opacity: 0.55 }",
  "(syncing || (Platform.OS === 'web' && !calendarRequest)) && { opacity: 0.55 }"
);

// Add debug logs to syncCalendar.
if (!content.includes("B7G_DEBUG syncCalendar pressed")) {
  content = content.replace(
    "  const syncCalendar = async () => {",
    `  const syncCalendar = async () => {
    console.log('B7G_DEBUG syncCalendar pressed', {
      platform: Platform.OS,
      hasWebClientId: Boolean(webClientId),
      hasAndroidClientId: Boolean(androidClientId),
      hasCalendarRequest: Boolean(calendarRequest),
    });`
  );
}

// Add debug logs to native Google flow.
if (!content.includes("B7G_DEBUG native Google calendar start")) {
  content = content.replace(
    "    try {\n      setCalendarSyncStatus('Opening native Google Calendar permission...');",
    "    try {\n      console.log('B7G_DEBUG native Google calendar start');\n      setCalendarSyncStatus('Opening native Google Calendar permission...');"
  );
}

if (!content.includes("B7G_DEBUG native Google tokens")) {
  content = content.replace(
    "      const tokens = await GoogleSignin.getTokens();",
    "      const tokens = await GoogleSignin.getTokens();\n      console.log('B7G_DEBUG native Google tokens', { hasAccessToken: Boolean(tokens.accessToken), hasIdToken: Boolean(tokens.idToken) });"
  );
}

if (!content.includes("B7G_DEBUG importing calendar with token")) {
  content = content.replace(
    "    setCalendarSyncStatus('Importing Google Calendar events...');",
    "    console.log('B7G_DEBUG importing calendar with token');\n    setCalendarSyncStatus('Importing Google Calendar events...');"
  );
}

fs.writeFileSync(file, content, { encoding: "utf8" });

console.log("B7G-FIX applied: Android sync button unlocked and debug logs added.");
