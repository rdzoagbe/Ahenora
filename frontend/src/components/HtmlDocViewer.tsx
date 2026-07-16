import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

/**
 * Renders backend-converted document HTML (Word/Excel) in a WebView so the
 * content is readable in-app — no external app needed. Not pixel-perfect for
 * complex layouts; it shows the text and tables.
 */
export function HtmlDocViewer({ html }: { html: string }) {
  const doc = useMemo(
    () => `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=4">
<style>
  body{margin:0;padding:18px 16px;background:#ffffff;color:#1b1d22;
    font-family:-apple-system,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.55;word-wrap:break-word}
  h1{font-size:21px;margin:0 0 10px} h2{font-size:17px;margin:20px 0 8px}
  p{margin:0 0 9px} br{line-height:1}
  table{border-collapse:collapse;width:100%;margin:10px 0;font-size:13px;display:block;overflow-x:auto}
  td,th{border:1px solid #e2e2e2;padding:6px 9px;text-align:left;white-space:nowrap}
  tr:nth-child(even){background:#f7f7f5}
</style></head><body>${html}</body></html>`,
    [html],
  );

  return (
    <View style={styles.wrap}>
      <WebView
        originWhitelist={['*']}
        source={{ html: doc }}
        style={styles.web}
        javaScriptEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, borderRadius: 18, overflow: 'hidden', backgroundColor: '#fff' },
  web: { flex: 1, backgroundColor: '#fff' },
});
