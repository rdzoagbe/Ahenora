// @ts-nocheck
import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en" style={{ height: "100%" }}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        {/*
          Disable body scrolling on web to make ScrollView components work correctly.
          If you want to enable scrolling, remove `ScrollViewStyleReset` and
          set `overflow: auto` on the body style below.
        */}
        {/* PWA: lets iPhone/desktop users install from the browser. Paths are
            absolute because the web build lives under /app/. */}
        <link rel="manifest" href="/app/manifest.json" />
        <link rel="apple-touch-icon" href="/app/apple-touch-icon.png" />
        <meta name="theme-color" content="#101419" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Ahenora" />
        <ScrollViewStyleReset />
        {/* Install affordance, web only. Chrome fires beforeinstallprompt when
            the manifest + service worker qualify; we catch it and offer our
            own button. iOS never fires it — Safari only installs via
            Share > Add to Home Screen — so iPhones get an instruction bar.
            Hidden inside an installed app, and stays away once dismissed. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function () {
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) return;
  try { if (localStorage.getItem('coo_install_hint_dismissed')) return; } catch (e) { return; }
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(function () {});
    });
  }
  var fr = (navigator.language || '').toLowerCase().indexOf('fr') === 0;
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var deferred = null;
  function bar(text, btnLabel, onClick) {
    var el = document.createElement('div');
    el.id = 'coo-install-bar';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;display:flex;align-items:center;gap:10px;padding:10px 14px;padding-top:calc(10px + env(safe-area-inset-top));background:#1A1F27;color:#fff;font:600 13px/1.35 Inter,-apple-system,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.35)';
    var dot = document.createElement('span');
    dot.style.cssText = 'width:14px;height:14px;border-radius:50%;background:#F97C3C;flex:none';
    var msg = document.createElement('span');
    msg.style.cssText = 'flex:1;min-width:0';
    msg.textContent = text;
    el.appendChild(dot); el.appendChild(msg);
    if (btnLabel) {
      var b = document.createElement('button');
      b.textContent = btnLabel;
      b.style.cssText = 'background:#F97C3C;color:#fff;border:0;border-radius:999px;padding:7px 14px;font:700 13px Inter,sans-serif';
      b.onclick = onClick;
      el.appendChild(b);
    }
    var x = document.createElement('button');
    x.textContent = '\u2715';
    x.setAttribute('aria-label', fr ? 'Fermer' : 'Close');
    x.style.cssText = 'background:none;border:0;color:#9AA1AD;font-size:15px;padding:4px 6px';
    x.onclick = function () { el.remove(); try { localStorage.setItem('coo_install_hint_dismissed', '1'); } catch (e) {} };
    el.appendChild(x);
    document.body.appendChild(el);
    return el;
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    if (document.getElementById('coo-install-bar')) return;
    bar(
      fr ? "Installez Ahenora sur votre \u00e9cran d'accueil." : 'Install Ahenora on your home screen.',
      fr ? 'Installer' : 'Install',
      function () {
        if (!deferred) return;
        deferred.prompt();
        deferred.userChoice.finally(function () {
          var el = document.getElementById('coo-install-bar');
          if (el) el.remove();
          try { localStorage.setItem('coo_install_hint_dismissed', '1'); } catch (e) {}
        });
        deferred = null;
      }
    );
  });
  if (isIOS) {
    window.addEventListener('load', function () {
      setTimeout(function () {
        if (document.getElementById('coo-install-bar')) return;
        bar(
          fr ? "Installez l'appli : touchez Partager, puis \u00ab Sur l'\u00e9cran d'accueil \u00bb." : "Install the app: tap Share, then 'Add to Home Screen'.",
          null,
          null
        );
      }, 2500);
    });
  }
})();
`,
          }}
        />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              body > div:first-child { position: fixed !important; top: 0; left: 0; right: 0; bottom: 0; }
              [role="tablist"] [role="tab"] * { overflow: visible !important; }
              [role="heading"], [role="heading"] * { overflow: visible !important; }
            `,
          }}
        />
      </head>
      <body
        style={{
          margin: 0,
          height: "100%",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </body>
    </html>
  );
}
