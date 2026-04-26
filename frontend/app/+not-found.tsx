import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Link, Stack } from 'expo-router';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not Found' }} />

      <View style={styles.container}>
        <Text style={styles.title}>Page not found</Text>
        <Text style={styles.subtitle}>
          The screen you are trying to open does not exist.
        </Text>

        <Link href="/" asChild>
          <Pressable style={styles.button}>
            <Text style={styles.buttonText}>Go back home</Text>
          </Pressable>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: '#aaa',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#fff',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
  },
  buttonText: {
    color: '#111',
    fontWeight: '700',
  },
});
