const fs = require("fs");
const path = require("path");

const file = path.join(process.cwd(), "app", "(tabs)", "feed.tsx");
let content = fs.readFileSync(file, "utf8");

if (content.includes("nextUpPanel")) {
  console.log("B7A already applied: nextUpPanel exists.");
  process.exit(0);
}

content = content.replace(/FileText,\r\r\n/g, "FileText,\r\n");

content = content.replace(
  "scroll: { paddingHorizontal: 24, paddingTop: 10 }",
  "scroll: { paddingHorizontal: 20, paddingTop: 8 }"
);

content = content.replace(
  "name: { fontFamily: 'Inter_800ExtraBold', fontSize: 42, lineHeight: 47, letterSpacing: -1.1 }",
  "name: { fontFamily: 'Inter_800ExtraBold', fontSize: 36, lineHeight: 41, letterSpacing: -0.9 }"
);

content = content.replace(
  "<View style={{ height: 220 }} />",
  "<View style={{ height: 160 }} />"
);

const startNeedle = '<Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{labels.nextUp}</Text>';
const endNeedle = "<Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{t('this_week')}</Text>";

const startTitleIndex = content.indexOf(startNeedle);
if (startTitleIndex < 0) throw new Error("Could not find Next up title.");

const startSection = content.lastIndexOf("          <View style={styles.section}>", startTitleIndex);
if (startSection < 0) throw new Error("Could not find Next up section start.");

const endTitleIndex = content.indexOf(endNeedle, startTitleIndex);
if (endTitleIndex < 0) throw new Error("Could not find This week title.");

const endSection = content.lastIndexOf("          <View style={styles.section}>", endTitleIndex);
if (endSection < 0) throw new Error("Could not find This week section start.");

const newNextUp = `          <View style={[styles.nextUpPanel, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder, shadowColor: theme.colors.shadow }]}>
            <View style={styles.nextUpHeader}>
              <View>
                <Text style={[styles.nextUpEyebrow, { color: theme.colors.textMuted }]}>HOUSEHOLD PRIORITY</Text>
                <Text style={[styles.nextUpHeading, { color: theme.colors.text }]}>{labels.nextUp}</Text>
              </View>
              <View style={[styles.nextUpCountBadge, { backgroundColor: theme.colors.accentSoft }]}>
                <Text style={[styles.nextUpCountText, { color: theme.colors.accent }]}>
                  {uniqueCards([...dashboard.overdue, ...dashboard.todayCards, ...dashboard.nextUp]).length}
                </Text>
              </View>
            </View>

            <View style={styles.nextUpStats}>
              <View style={[styles.nextUpStat, { backgroundColor: theme.colors.bgSoft }]}>
                <Text style={[styles.nextUpStatNumber, { color: dashboard.overdue.length ? '#DC2626' : theme.colors.text }]}>
                  {dashboard.overdue.length}
                </Text>
                <Text style={[styles.nextUpStatLabel, { color: theme.colors.textMuted }]}>Overdue</Text>
              </View>
              <View style={[styles.nextUpStat, { backgroundColor: theme.colors.bgSoft }]}>
                <Text style={[styles.nextUpStatNumber, { color: theme.colors.text }]}>{dashboard.todayCards.length}</Text>
                <Text style={[styles.nextUpStatLabel, { color: theme.colors.textMuted }]}>{labels.today}</Text>
              </View>
              <View style={[styles.nextUpStat, { backgroundColor: theme.colors.bgSoft }]}>
                <Text style={[styles.nextUpStatNumber, { color: theme.colors.text }]}>{dashboard.nextUp.length}</Text>
                <Text style={[styles.nextUpStatLabel, { color: theme.colors.textMuted }]}>24h</Text>
              </View>
            </View>

            {uniqueCards([...dashboard.overdue, ...dashboard.todayCards, ...dashboard.nextUp]).length === 0 ? (
              <View style={styles.nextUpEmpty}>
                <CheckCircle2 color={theme.colors.success} size={22} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.nextUpTaskTitle, { color: theme.colors.text }]}>{labels.nothingUrgent}</Text>
                  <Text style={[styles.nextUpTaskMeta, { color: theme.colors.textMuted }]}>{labels.nothingUrgentSub}</Text>
                </View>
              </View>
            ) : (
              uniqueCards([...dashboard.overdue, ...dashboard.todayCards, ...dashboard.nextUp]).slice(0, 3).map((card) => (
                <PressScale
                  key={\`next-command-\${card.card_id}\`}
                  onPress={() => router.push('/calendar')}
                  style={[styles.nextUpTask, { borderColor: theme.colors.cardBorder }]}
                >
                  <View style={[styles.nextUpTaskIcon, { backgroundColor: card.type === 'TASK' ? theme.colors.bgSoft : theme.colors.accentSoft }]}>
                    {card.type === 'TASK' ? (
                      <CheckCircle2 color={theme.colors.success} size={16} />
                    ) : (
                      <FileText color={theme.colors.accent} size={16} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.nextUpTaskTitle, { color: theme.colors.text }]} numberOfLines={1}>{card.title}</Text>
                    <Text style={[styles.nextUpTaskMeta, { color: theme.colors.textMuted }]} numberOfLines={1}>
                      {formatCardDate(card)} · {card.assignee || t('family')}
                    </Text>
                  </View>
                  <ArrowRight color={theme.colors.textMuted} size={16} />
                </PressScale>
              ))
            )}
          </View>

`;

content = content.slice(0, startSection) + newNextUp + content.slice(endSection);

const styleMarker = "  footerSignal: {";
const stylesToAdd = `  nextUpPanel: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 16,
    marginTop: 18,
    marginBottom: 8,
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  nextUpHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  nextUpEyebrow: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  nextUpHeading: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 22,
    lineHeight: 27,
    letterSpacing: -0.3,
  },
  nextUpCountBadge: {
    minWidth: 38,
    height: 38,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  nextUpCountText: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 16,
  },
  nextUpStats: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  nextUpStat: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  nextUpStatNumber: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 20,
    lineHeight: 24,
  },
  nextUpStatLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  nextUpTask: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    paddingTop: 11,
    paddingBottom: 2,
    marginTop: 8,
  },
  nextUpTaskIcon: {
    width: 34,
    height: 34,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextUpTaskTitle: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 14,
    lineHeight: 19,
  },
  nextUpTaskMeta: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 1,
  },
  nextUpEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 8,
  },

`;

if (!content.includes(styleMarker)) {
  throw new Error("Could not find style insertion marker.");
}

content = content.replace(styleMarker, stylesToAdd + styleMarker);

fs.writeFileSync(file, content, { encoding: "utf8" });
console.log("B7A applied successfully.");
