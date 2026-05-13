const fs = require("fs");
const path = require("path");

const file = path.join(process.cwd(), "app", "(tabs)", "calendar.tsx");
let content = fs.readFileSync(file, "utf8");

// Ensure Platform import
content = content.replace(
  "import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';",
  "import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';"
);

// Ensure GoogleSignin import
if (!content.includes("@react-native-google-signin/google-signin")) {
  content = content.replace(
    "import * as WebBrowser from 'expo-web-browser';",
    "import * as WebBrowser from 'expo-web-browser';\nimport { GoogleSignin } from '@react-native-google-signin/google-signin';"
  );
}

// Ensure sync status state exists
if (!content.includes("calendarSyncStatus")) {
  content = content.replace(
    "  const [syncResult, setSyncResult] = useState<CalendarImportResult | null>(null);",
    "  const [syncResult, setSyncResult] = useState<CalendarImportResult | null>(null);\n  const [calendarSyncStatus, setCalendarSyncStatus] = useState<string | null>(null);"
  );
}

// Remove temporary visible test code, any formatting
content = content.replace(/^\s*console\.log\('B7G_VISIBLE_SYNC_TEST button reached'\);\r?\n/gm, "");
content = content.replace(/^\s*Alert\.alert\('Calendar sync test', 'Sync button reached the function\.'\);\r?\n/gm, "");

// Replace the whole syncCalendar function cleanly
const syncStart = content.indexOf("  const syncCalendar = async () => {");
const shiftStart = content.indexOf("  const shiftMonth = (amount: number) => {", syncStart);

if (syncStart < 0 || shiftStart < 0) {
  throw new Error("Could not find syncCalendar block.");
}

const newSyncCalendar = `  const syncCalendar = async () => {
    console.log('B7G_DEBUG syncCalendar pressed', {
      platform: Platform.OS,
      hasWebClientId: Boolean(webClientId),
      hasAndroidClientId: Boolean(androidClientId),
      hasCalendarRequest: Boolean(calendarRequest),
    });

    setSyncResult(null);

    if (Platform.OS !== 'web') {
      if (!webClientId) {
        Alert.alert('Google Calendar not configured', 'Missing Google web client ID.');
        setCalendarSyncStatus('Google web client ID is missing.');
        return;
      }

      try {
        setSyncing(true);
        setCalendarSyncStatus('Opening native Google Calendar permission...');
        console.log('B7G_DEBUG native Google calendar start');

        GoogleSignin.configure({
          webClientId,
          scopes: ['profile', 'email', GOOGLE_CALENDAR_SCOPE],
          offlineAccess: false,
        });

        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

        const googleSigninAny = GoogleSignin as any;

        if (typeof googleSigninAny.addScopes === 'function') {
          console.log('B7G_DEBUG requesting calendar scope with addScopes');
          await googleSigninAny.addScopes({ scopes: [GOOGLE_CALENDAR_SCOPE] });
        } else {
          console.log('B7G_DEBUG requesting calendar scope with signIn');
          await GoogleSignin.signIn();
        }

        const tokens = await GoogleSignin.getTokens();

        console.log('B7G_DEBUG native Google tokens', {
          hasAccessToken: Boolean(tokens.accessToken),
          hasIdToken: Boolean(tokens.idToken),
        });

        if (!tokens.accessToken) {
          setCalendarSyncStatus('Google connected, but no Calendar access token was returned.');
          Alert.alert('Calendar sync failed', 'Google connected, but no Calendar access token was returned.');
          return;
        }

        setCalendarSyncStatus('Importing Google Calendar events...');
        console.log('B7G_DEBUG importing calendar with token');

        const result = await api.importGoogleCalendar(tokens.accessToken, 30);

        console.log('B7G_DEBUG calendar import result', result);

        setSyncResult(result);
        await load();

        setCalendarSyncStatus(\`\${result.imported} events imported. \${result.contacts_found} people found.\`);
        Alert.alert('Calendar synced', \`\${result.imported} events imported. \${result.contacts_found} people found.\`);
      } catch (e: any) {
        console.log('native google calendar sync failed', e);
        const message = e?.message || e?.code || 'Native Google Calendar permission failed.';
        setCalendarSyncStatus(\`Calendar sync failed: \${message}\`);
        Alert.alert('Calendar sync failed', message);
      } finally {
        setSyncing(false);
      }

      return;
    }

    if (!webClientId || !androidClientId) {
      Alert.alert('Google Calendar not configured', 'Missing Google OAuth client IDs.');
      setCalendarSyncStatus('Google OAuth client IDs are missing.');
      return;
    }

    if (!calendarRequest) {
      Alert.alert('Google Calendar not ready', 'Please try again in a moment.');
      setCalendarSyncStatus('Google Calendar connection is preparing. Try again in a few seconds.');
      return;
    }

    try {
      setCalendarSyncStatus('Opening Google Calendar connection...');
      handledCalendarResponseRef.current = false;

      const result = await promptCalendarAsync();

      console.log('B7G_DEBUG web AuthSession result', result);

      const accessToken =
        result?.authentication?.accessToken ||
        result?.params?.access_token ||
        result?.params?.accessToken;

      if (!accessToken) {
        console.log('calendar auth returned no access token', result);
        setCalendarSyncStatus('Google connected, but no calendar access token was returned.');
        Alert.alert('Calendar sync failed', 'Google connected, but no calendar access token was returned.');
        return;
      }

      setSyncing(true);
      setCalendarSyncStatus('Importing Google Calendar events...');

      const importResult = await api.importGoogleCalendar(accessToken, 30);
      setSyncResult(importResult);
      await load();

      setCalendarSyncStatus(\`\${importResult.imported} events imported. \${importResult.contacts_found} people found.\`);
      Alert.alert('Calendar synced', \`\${importResult.imported} events imported. \${importResult.contacts_found} people found.\`);
    } catch (e: any) {
      console.log('calendar sync failed', e);
      const message = e?.message || 'Please try again.';
      setCalendarSyncStatus(\`Calendar sync failed: \${message}\`);
      Alert.alert('Calendar sync failed', message);
    } finally {
      setSyncing(false);
    }
  };

`;

content = content.slice(0, syncStart) + newSyncCalendar + content.slice(shiftStart);

// Android button must not depend on AuthSession calendarRequest
content = content.replaceAll(
  "disabled={syncing || !calendarRequest}",
  "disabled={syncing || (Platform.OS === 'web' && !calendarRequest)}"
);

content = content.replaceAll(
  "(syncing || !calendarRequest) && { opacity: 0.55 }",
  "(syncing || (Platform.OS === 'web' && !calendarRequest)) && { opacity: 0.55 }"
);

// Show sync status inside card if possible
content = content.replace(
  "{!calendarRequest ? (\n              <Text style={[styles.calendarSyncHint, { color: theme.colors.textMuted }]}>Google sign-in is preparing. Try again in a few seconds.</Text>\n            ) : null}",
  "{calendarSyncStatus ? (\n              <Text style={[styles.calendarSyncHint, { color: theme.colors.textMuted }]}>{calendarSyncStatus}</Text>\n            ) : !calendarRequest ? (\n              <Text style={[styles.calendarSyncHint, { color: theme.colors.textMuted }]}>Google sign-in is preparing. Try again in a few seconds.</Text>\n            ) : null}"
);

fs.writeFileSync(file, content, { encoding: "utf8" });

console.log("Clean Calendar sync replacement applied.");
