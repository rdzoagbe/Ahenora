const fs = require("fs");
const path = require("path");

function write(file, content) {
  fs.writeFileSync(file, content, { encoding: "utf8" });
}

/**
 * SETTINGS FIX
 * - Fix corrupted text
 * - Collapse long household sections
 */
const settingsFile = path.join(process.cwd(), "app", "(tabs)", "settings.tsx");
let settings = fs.readFileSync(settingsFile, "utf8");

settings = settings.replace(/Admin \/ Tester[\s\S]*?all features unlocked/g, "Admin / Tester - all features unlocked");
settings = settings.replace(/memberLimit \|\| '[^']*'/g, "memberLimit || 'Unlimited'");
settings = settings.replace(/subscription\?\.limits\?\.ai_scans_per_month \?\? '[^']*'/g, "subscription?.limits?.ai_scans_per_month ?? 'Unlimited'");
settings = settings.replace(/PIN set[^']*tap to change/g, "PIN set - tap to change");
settings = settings.replace(/No PIN[^']*tap to add/g, "No PIN - tap to add");

if (!settings.includes("showHouseholdAdvanced")) {
  settings = settings.replace(
    "  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);",
    "  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);\n  const [showHouseholdAdvanced, setShowHouseholdAdvanced] = useState(false);"
  );
}

const familyStartMarker = '          <SectionTitle icon={<Users color={theme.colors.textMuted} size={18} />} label="Family" color={theme.colors.textMuted} />';
const logoutMarker = '          <PressScale testID="logout"';

if (!settings.includes('testID="settings-household-toggle"')) {
  const start = settings.indexOf(familyStartMarker);
  const end = settings.indexOf(logoutMarker, start);

  if (start < 0 || end < 0) {
    throw new Error("Could not find Settings family/logout markers.");
  }

  const before = settings.slice(0, start);
  const advanced = settings.slice(start, end);
  const after = settings.slice(end);

  const collapsed = `          <SectionTitle icon={<Users color={theme.colors.textMuted} size={18} />} label="Household management" color={theme.colors.textMuted} />
          <GlassCard>
            <PressScale testID="settings-household-toggle" onPress={() => setShowHouseholdAdvanced((value) => !value)} style={styles.navRow}>
              <View style={styles.preferenceTitleRow}>
                <Users color={theme.colors.accent} size={22} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: theme.colors.text }]}>Family, invites, calendar contacts & kid PINs</Text>
                  <Text style={[styles.rowDescription, { color: theme.colors.textMuted }]}>Advanced household setup. Tap to show or hide.</Text>
                </View>
              </View>
              <Text style={[styles.rowValue, { color: theme.colors.textMuted }]}>{showHouseholdAdvanced ? 'Hide' : 'Show'}</Text>
            </PressScale>
          </GlassCard>

          {showHouseholdAdvanced ? (
            <>
${advanced}
            </>
          ) : null}

`;

  settings = before + collapsed + after;
}

settings = settings.replace(
  "scroll: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 122 }",
  "scroll: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 96 }"
);

settings = settings.replace(
  "<View style={{ height: 90 }} />",
  "<View style={{ height: 60 }} />"
);

write(settingsFile, settings);

/**
 * FEED FIX
 * - Reduce long card list
 * - Reduce bottom empty scroll space
 */
const feedFile = path.join(process.cwd(), "app", "(tabs)", "feed.tsx");
let feed = fs.readFileSync(feedFile, "utf8");

feed = feed.replace(/FileText,\r\r\n/g, "FileText,\r\n");
feed = feed.replace(
  "scroll: { paddingHorizontal: 24, paddingTop: 10 }",
  "scroll: { paddingHorizontal: 20, paddingTop: 8 }"
);
feed = feed.replace(
  "name: { fontFamily: 'Inter_800ExtraBold', fontSize: 42, lineHeight: 47, letterSpacing: -1.1 }",
  "name: { fontFamily: 'Inter_800ExtraBold', fontSize: 36, lineHeight: 41, letterSpacing: -0.9 }"
);
feed = feed.replace(/cards\.map\(\(c\) => \(/, "cards.slice(0, 4).map((c) => (");
feed = feed.replace(/<View style=\{\{ height: (220|160) \}\} \/>/, "<View style={{ height: 120 }} />");

write(feedFile, feed);

/**
 * KIDS FIX
 * - Limit visible reward list
 * - Reduce activity count
 */
const kidsFile = path.join(process.cwd(), "app", "(tabs)", "kids.tsx");
let kids = fs.readFileSync(kidsFile, "utf8");

kids = kids.replace(/historyItems\.slice\(0, 4\)/g, "historyItems.slice(0, 3)");
kids = kids.replace(/rewards\.map\(\(reward\) => \{/g, "rewards.slice(0, 4).map((reward) => {");
kids = kids.replace(/<View style=\{\{ height: (220|180|160) \}\} \/>/g, "<View style={{ height: 110 }} />");

write(kidsFile, kids);

console.log("B7A-FIX applied: Settings text fixed, Settings advanced sections collapsed, Feed/Kids long lists reduced.");
