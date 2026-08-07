import React from 'react';
import { Alert, Pressable, ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Download } from 'lucide-react-native';
import { useStore } from '../../src/store';
import { AppText, Button, Card } from '../../src/components/ui';
import { exportAll } from '../../src/storage';

const REST_OPTIONS = [45, 60, 90, 120, 180];

export default function SettingsScreen() {
  const { theme, settings, updateSettings, workouts, exercises } = useStore();
  const insets = useSafeAreaInsets();

  const onExport = async () => {
    try {
      const json = await exportAll();
      await Share.share({ message: json });
    } catch {
      Alert.alert('Export failed', 'Could not share your data right now.');
    }
  };

  return (
    <ScrollView
      contentContainerStyle={{
        padding: 16,
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 24,
        gap: 14,
      }}
    >
      <View>
        <AppText variant="label">Make it yours</AppText>
        <AppText variant="title">Settings</AppText>
      </View>

      <Card style={{ gap: 16 }}>
        <Row label="Weight unit">
          <Segmented
            options={[
              { key: 'kg', label: 'kg' },
              { key: 'lb', label: 'lb' },
            ]}
            value={settings.unit}
            onChange={(v) => updateSettings({ unit: v as 'kg' | 'lb' })}
          />
        </Row>

        <Row label="Appearance">
          <Segmented
            options={[
              { key: 'system', label: 'Auto' },
              { key: 'light', label: 'Light' },
              { key: 'dark', label: 'Dark' },
            ]}
            value={settings.appearance}
            onChange={(v) => updateSettings({ appearance: v as any })}
          />
        </Row>
      </Card>

      <Card style={{ gap: 10 }}>
        <AppText variant="label">Default rest timer</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {REST_OPTIONS.map((sec) => {
            const on = settings.restSeconds === sec;
            return (
              <Pressable
                key={sec}
                onPress={() => updateSettings({ restSeconds: sec })}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  borderRadius: 999,
                  backgroundColor: on ? theme.colors.accent : theme.colors.bgSoft,
                }}
              >
                <AppText
                  style={{
                    color: on ? theme.colors.onAccent : theme.colors.textMuted,
                    fontWeight: '700',
                    fontSize: 13,
                  }}
                >
                  {sec < 60 ? `${sec}s` : `${sec / 60}:${(sec % 60).toString().padStart(2, '0')}`}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card style={{ gap: 12 }}>
        <View>
          <AppText variant="heading" style={{ fontSize: 16 }}>
            Your data
          </AppText>
          <AppText variant="soft" style={{ marginTop: 2 }}>
            {workouts.length} workouts · {exercises.length} exercises, all stored on this device.
          </AppText>
        </View>
        <Button
          title="Export as JSON"
          kind="secondary"
          onPress={onExport}
          icon={<Download color={theme.colors.text} size={16} />}
        />
      </Card>

      <AppText variant="soft" style={{ textAlign: 'center', marginTop: 8, lineHeight: 19 }}>
        Lyfta Personal · a private, offline gym log.{'\n'}Nothing leaves your phone.
      </AppText>
    </ScrollView>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <AppText variant="body" style={{ flex: 1, fontWeight: '600' }}>
        {label}
      </AppText>
      {children}
    </View>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const { theme } = useStore();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: theme.colors.bgSoft,
        borderRadius: 10,
        padding: 3,
      }}
    >
      {options.map((opt) => {
        const on = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(opt.key)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 7,
              borderRadius: 8,
              backgroundColor: on ? theme.colors.card : 'transparent',
            }}
          >
            <AppText
              style={{
                color: on ? theme.colors.text : theme.colors.textSoft,
                fontWeight: '700',
                fontSize: 13,
              }}
            >
              {opt.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
