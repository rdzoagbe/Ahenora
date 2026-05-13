const fs = require("fs");
const path = require("path");

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(process.cwd(), relativePath), content, { encoding: "utf8" });
}

/**
 * FEED
 * - DONE cards are removed immediately from local Feed.
 * - This Week renders only OPEN cards.
 */
let feed = read("app/(tabs)/feed.tsx");

if (!feed.includes("showAllFeedCards")) {
  feed = feed.replace(
    "  const [voiceDraft, setVoiceDraft] = useState<VoiceDraft | null>(null);",
    "  const [voiceDraft, setVoiceDraft] = useState<VoiceDraft | null>(null);\n  const [showAllFeedCards, setShowAllFeedCards] = useState(false);"
  );
}

feed = feed.replace(
  /setCards\(\(prev\) => prev\.map\(\(c\) => \(c\.card_id === card\.card_id \? \{ \.\.\.c, status: next(?:, completed_at: [^}]+)? \} : c\)\)\);/,
  `setCards((prev) =>
      next === 'DONE'
        ? prev.filter((c) => c.card_id !== card.card_id)
        : prev.map((c) => (c.card_id === card.card_id ? { ...c, status: next, completed_at: null } : c))
    );`
);

feed = feed.replace(/cards\.length === 0 && !loading/g, "activeCards.length === 0 && !loading");
feed = feed.replace(/cards\.slice\(0, 4\)\.map\(\(c\) => \(/g, "(showAllFeedCards ? activeCards : activeCards.slice(0, 3)).map((c) => (");
feed = feed.replace(/cards\.slice\(0, 3\)\.map\(\(c\) => \(/g, "(showAllFeedCards ? activeCards : activeCards.slice(0, 3)).map((c) => (");
feed = feed.replace(/\(showAllFeedCards \? cards : cards\.slice\(0, 3\)\)\.map\(\(c\) => \(/g, "(showAllFeedCards ? activeCards : activeCards.slice(0, 3)).map((c) => (");
feed = feed.replace(/\(showAllFeedCards \? cards : cards\.slice\(0, 4\)\)\.map\(\(c\) => \(/g, "(showAllFeedCards ? activeCards : activeCards.slice(0, 3)).map((c) => (");

if (!feed.includes('testID="feed-show-all-cards"')) {
  const footerMarker = "          <View style={styles.footerSignal}>";
  const toggle = `          {activeCards.length > 3 ? (
            <PressScale
              testID="feed-show-all-cards"
              onPress={() => setShowAllFeedCards((value) => !value)}
              style={[styles.compactToggle, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}
            >
              <Text style={[styles.compactToggleText, { color: theme.colors.text }]}>
                {showAllFeedCards ? 'Show fewer cards' : \`View all \${activeCards.length} cards\`}
              </Text>
            </PressScale>
          ) : null}

`;
  feed = feed.replace(footerMarker, toggle + footerMarker);
}

if (!feed.includes("compactToggle:")) {
  const styleMarker = "  footerSignal: {";
  const styles = `  compactToggle: {
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  compactToggleText: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 13,
  },

`;
  feed = feed.replace(styleMarker, styles + styleMarker);
}

feed = feed.replace(/cards\.length > 3/g, "activeCards.length > 3");
feed = feed.replace(/<View style=\{\{ height: (220|160|120|105|90) \}\} \/>/g, "<View style={{ height: 80 }} />");

write("app/(tabs)/feed.tsx", feed);

/**
 * SETTINGS
 * - Add completed history.
 * - Collapse Notifications by default to reduce scrolling.
 * - Reload on focus.
 */
let settings = read("app/(tabs)/settings.tsx");

settings = settings.replace(
  "import { useRouter } from 'expo-router';",
  "import { useFocusEffect, useRouter } from 'expo-router';"
);

settings = settings.replace(
  "import { api, CalendarContact, Entitlements, FamilyInvite, FamilyMember, NotificationSettings } from '../../src/api';",
  "import { api, CalendarContact, Card, Entitlements, FamilyInvite, FamilyMember, NotificationSettings } from '../../src/api';"
);

if (!settings.includes("completedCards")) {
  settings = settings.replace(
    "  const [showHouseholdAdvanced, setShowHouseholdAdvanced] = useState(false);",
    "  const [showHouseholdAdvanced, setShowHouseholdAdvanced] = useState(false);\n  const [completedCards, setCompletedCards] = useState<Card[]>([]);\n  const [showCompletedHistory, setShowCompletedHistory] = useState(false);\n  const [showNotifications, setShowNotifications] = useState(false);"
  );
}

if (!settings.includes("completedRows")) {
  settings = settings.replace(
    "      const [memberRows, inviteRows, contactRows, notificationRows, entitlementRows] = await Promise.all([",
    "      const [memberRows, inviteRows, contactRows, notificationRows, entitlementRows, completedRows] = await Promise.all(["
  );

  settings = settings.replace(
    "        api.getEntitlements().catch(() => null),\n      ]);",
    `        api.getEntitlements().catch(() => null),
        api.listCards('DONE')
          .then(async (rows) => {
            const directDone = rows.filter((card) => card.status === 'DONE');
            if (directDone.length > 0) return directDone;
            const allCards = await api.listCards().catch(() => [] as Card[]);
            return allCards.filter((card) => card.status === 'DONE');
          })
          .catch(async () => {
            const allCards = await api.listCards().catch(() => [] as Card[]);
            return allCards.filter((card) => card.status === 'DONE');
          }),
      ]);`
  );

  settings = settings.replace(
    "      setEntitlements(entitlementRows);",
    "      setEntitlements(entitlementRows);\n      setCompletedCards(completedRows);"
  );
}

if (!settings.includes("useFocusEffect(")) {
  settings = settings.replace(
    "  useEffect(() => { load(); }, [load]);",
    "  useEffect(() => { load(); }, [load]);\n  useFocusEffect(useCallback(() => { load(); }, [load]));"
  );
}

const notificationsMarker = '          <SectionTitle icon={<Bell color={theme.colors.textMuted} size={18} />} label="Notifications" color={theme.colors.textMuted} />';
const preferencesMarker = '          <SectionTitle icon={<Globe color={theme.colors.textMuted} size={18} />} label="Preferences" color={theme.colors.textMuted} />';

if (!settings.includes('testID="settings-completed-history-toggle"')) {
  const historySection = `          <SectionTitle icon={<FileText color={theme.colors.textMuted} size={18} />} label="History" color={theme.colors.textMuted} />
          <GlassCard>
            <PressScale testID="settings-completed-history-toggle" onPress={() => setShowCompletedHistory((value) => !value)} style={styles.navRow}>
              <View style={styles.preferenceTitleRow}>
                <FileText color={theme.colors.accent} size={22} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: theme.colors.text }]}>Completed history</Text>
                  <Text style={[styles.rowDescription, { color: theme.colors.textMuted }]}>
                    {completedCards.length} completed card{completedCards.length === 1 ? '' : 's'}
                  </Text>
                </View>
              </View>
              <Text style={[styles.rowValue, { color: theme.colors.textMuted }]}>{showCompletedHistory ? 'Hide' : 'Show'}</Text>
            </PressScale>

            {showCompletedHistory ? (
              <View>
                <Divider />
                {completedCards.length === 0 ? (
                  <EmptyText text="No completed cards yet." />
                ) : (
                  completedCards.slice(0, 8).map((card, index) => (
                    <View key={card.card_id}>
                      {index > 0 ? <Divider /> : null}
                      <View style={styles.memberRow}>
                        <View style={[styles.memberAvatar, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                          <Text style={[styles.memberInitial, { color: theme.colors.text }]}>{card.type === 'TASK' ? 'T' : card.type === 'RSVP' ? 'R' : 'S'}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.memberName, { color: theme.colors.text }]} numberOfLines={1}>{card.title}</Text>
                          <Text style={[styles.memberRole, { color: theme.colors.textMuted }]} numberOfLines={1}>
                            Done · {card.assignee || 'Family'} · {card.completed_at ? new Date(card.completed_at).toLocaleDateString() : new Date(card.created_at).toLocaleDateString()}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ))
                )}
              </View>
            ) : null}
          </GlassCard>

`;
  settings = settings.replace(notificationsMarker, historySection + notificationsMarker);
}

if (!settings.includes('testID="settings-notifications-toggle"')) {
  const start = settings.indexOf(notificationsMarker);
  const end = settings.indexOf(preferencesMarker, start);

  if (start >= 0 && end > start) {
    const oldNotifications = settings.slice(start, end);
    const collapsedNotifications = `          <SectionTitle icon={<Bell color={theme.colors.textMuted} size={18} />} label="Notifications" color={theme.colors.textMuted} />
          <GlassCard>
            <PressScale testID="settings-notifications-toggle" onPress={() => setShowNotifications((value) => !value)} style={styles.navRow}>
              <View style={styles.preferenceTitleRow}>
                <Bell color={theme.colors.accent} size={22} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: theme.colors.text }]}>Notification controls</Text>
                  <Text style={[styles.rowDescription, { color: theme.colors.textMuted }]}>Reminder alerts and new-card alerts. Tap to show or hide.</Text>
                </View>
              </View>
              <Text style={[styles.rowValue, { color: theme.colors.textMuted }]}>{showNotifications ? 'Hide' : 'Show'}</Text>
            </PressScale>
          </GlassCard>

          {showNotifications ? (
            <>
${oldNotifications}
            </>
          ) : null}

`;
    settings = settings.slice(0, start) + collapsedNotifications + settings.slice(end);
  }
}

write("app/(tabs)/settings.tsx", settings);

/**
 * KIDS
 * - Collapse long Recent Activity and Reward Shop by default.
 */
let kids = read("app/(tabs)/kids.tsx");

if (!kids.includes("showKidsActivity")) {
  kids = kids.replace(
    "  const [selectedChild, setSelectedChild] = useState<string | null>(null);",
    "  const [selectedChild, setSelectedChild] = useState<string | null>(null);\n  const [showKidsActivity, setShowKidsActivity] = useState(false);\n  const [showRewardShop, setShowRewardShop] = useState(false);"
  );
}

const historyStartMarker = "              <GlassCard style={styles.historyCard}>";
const rewardStartMarker = "              <View style={[styles.rewardShopShell";

if (!kids.includes('testID="kids-activity-toggle"')) {
  const historyStart = kids.indexOf(historyStartMarker);
  const rewardStart = kids.indexOf(rewardStartMarker, historyStart);

  if (historyStart >= 0 && rewardStart > historyStart) {
    const historyBlock = kids.slice(historyStart, rewardStart);
    const compactHistory = `              <PressScale
                testID="kids-activity-toggle"
                onPress={() => setShowKidsActivity((value) => !value)}
                style={[styles.kidsCompactToggle, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}
              >
                <View style={styles.sectionRowInline}>
                  <History color={theme.colors.textMuted} size={16} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.kidsCompactToggleTitle, { color: theme.colors.text }]}>Recent activity</Text>
                    <Text style={[styles.kidsCompactToggleSub, { color: theme.colors.textMuted }]}>{recentActivityCount} activity item{recentActivityCount === 1 ? '' : 's'}</Text>
                  </View>
                  <Text style={[styles.kidsCompactToggleValue, { color: theme.colors.textMuted }]}>{showKidsActivity ? 'Hide' : 'Show'}</Text>
                </View>
              </PressScale>

              {showKidsActivity ? (
                <>
${historyBlock}
                </>
              ) : null}

`;
    kids = kids.slice(0, historyStart) + compactHistory + kids.slice(rewardStart);
  }
}

if (!kids.includes('testID="kids-reward-shop-toggle"')) {
  const rewardStart = kids.indexOf(rewardStartMarker);
  const rewardEnd = kids.indexOf("              <View style={{ height:", rewardStart);

  if (rewardStart >= 0 && rewardEnd > rewardStart) {
    const rewardBlock = kids.slice(rewardStart, rewardEnd);
    const compactReward = `              <PressScale
                testID="kids-reward-shop-toggle"
                onPress={() => setShowRewardShop((value) => !value)}
                style={[styles.kidsCompactToggle, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}
              >
                <View style={styles.sectionRowInline}>
                  <Gift color={theme.colors.accent} size={16} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.kidsCompactToggleTitle, { color: theme.colors.text }]}>Reward Shop</Text>
                    <Text style={[styles.kidsCompactToggleSub, { color: theme.colors.textMuted }]}>{affordableRewards}/{totalRewards} ready · tap to browse rewards</Text>
                  </View>
                  <Text style={[styles.kidsCompactToggleValue, { color: theme.colors.textMuted }]}>{showRewardShop ? 'Hide' : 'Show'}</Text>
                </View>
              </PressScale>

              {showRewardShop ? (
                <>
${rewardBlock}
                </>
              ) : null}

`;
    kids = kids.slice(0, rewardStart) + compactReward + kids.slice(rewardEnd);
  }
}

kids = kids.replace(/historyItems\.slice\(0, 3\)/g, "historyItems.slice(0, 2)");
kids = kids.replace(/rewards\.slice\(0, 4\)/g, "rewards.slice(0, 2)");
kids = kids.replace(/<View style=\{\{ height: (220|180|160|150|140|120|100) \}\} \/>/g, "<View style={{ height: 80 }} />");

if (!kids.includes("kidsCompactToggle:")) {
  const styleMarker = "  titleRow: {";
  const styles = `  kidsCompactToggle: {
    borderWidth: 1,
    borderRadius: 22,
    paddingVertical: 15,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  kidsCompactToggleTitle: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 15,
    lineHeight: 20,
  },
  kidsCompactToggleSub: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  kidsCompactToggleValue: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

`;
  kids = kids.replace(styleMarker, styles + styleMarker);
}

write("app/(tabs)/kids.tsx", kids);

console.log("B7D applied: DONE removal fixed, Settings history added, long Settings/Kids sections collapsed.");
