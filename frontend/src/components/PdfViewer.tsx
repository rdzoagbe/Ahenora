import React, { useEffect, useMemo, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { WebView } from 'react-native-webview';

interface Props {
  base64: string;
  onError?: () => void;
}

// pdf.js renders the PDF locally inside the WebView — the document bytes never
// leave the device; only the pdf.js library itself loads from the CDN.
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';

function buildHtml(raw: string) {
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=4, user-scalable=yes">
<style>
  html,body{margin:0;padding:0;background:#1b1d22}
  #pages{padding:8px 0}
  canvas{display:block;margin:0 auto 10px;max-width:100%;box-shadow:0 2px 10px rgba(0,0,0,.45)}
  #msg{color:#cbd5e1;font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;text-align:center;padding:40px 24px}
</style></head><body>
<div id="pages"></div>
<div id="msg">Loading…</div>
<script src="${PDFJS}/pdf.min.js"></script>
<script>
(function(){
  var msg=document.getElementById('msg');
  function fail(){ msg.textContent='This document could not be displayed in the app.'; try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage('error');}catch(e){} }
  try{
    if(!window.pdfjsLib){ fail(); return; }
    pdfjsLib.GlobalWorkerOptions.workerSrc='${PDFJS}/pdf.worker.min.js';
    var raw="${raw}";
    var bin=atob(raw), len=bin.length, bytes=new Uint8Array(len);
    for(var i=0;i<len;i++) bytes[i]=bin.charCodeAt(i);
    pdfjsLib.getDocument({data:bytes}).promise.then(function(pdf){
      msg.style.display='none';
      var host=document.getElementById('pages');
      var seq=Promise.resolve();
      for(var p=1;p<=pdf.numPages;p++){ (function(n){
        seq=seq.then(function(){ return pdf.getPage(n).then(function(page){
          var base=page.getViewport({scale:1});
          var scale=(window.innerWidth-16)/base.width;
          var vp=page.getViewport({scale:scale});
          var canvas=document.createElement('canvas');
          canvas.width=vp.width; canvas.height=vp.height;
          host.appendChild(canvas);
          return page.render({canvasContext:canvas.getContext('2d'), viewport:vp}).promise;
        }); });
      })(p); }
      return seq;
    }).catch(fail);
  }catch(e){ fail(); }
})();
</script></body></html>`;
}

// Strict base64 alphabet only. The raw value is interpolated into a JS string
// literal inside the WebView HTML, so anything outside this set (a quote or
// newline) could break out of the string context — reject it instead.
const BASE64_ONLY = /^[A-Za-z0-9+/=\s]*$/;

export function PdfViewer({ base64, onError }: Props) {
  const raw = useMemo(() => (base64.includes(',') ? base64.split(',')[1] : base64), [base64]);
  const safe = useMemo(() => (BASE64_ONLY.test(raw) ? raw.replace(/\s+/g, '') : null), [raw]);
  const html = useMemo(() => (safe ? buildHtml(safe) : ''), [safe]);

  useEffect(() => {
    if (safe === null) onError?.();
  }, [safe, onError]);
  const [loading, setLoading] = useState(true);

  return (
    <View style={styles.wrap}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        style={styles.web}
        javaScriptEnabled
        domStorageEnabled
        onLoadEnd={() => setLoading(false)}
        onMessage={(e) => { if (e.nativeEvent.data === 'error') onError?.(); }}
        onError={() => onError?.()}
      />
      {loading ? (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator color="#fff" />
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, borderRadius: 18, overflow: 'hidden', backgroundColor: '#1b1d22' },
  web: { flex: 1, backgroundColor: '#1b1d22' },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
