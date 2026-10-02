# -*- coding: utf-8 -*-
"""The page a shared invitation opens: ahenora.com/join (and /fr, /es, /de).

Roland, 2026-09-30, looking at an invitation his partner received on WhatsApp:
"this shouldn't be how the invitation comes". It was the website's own preview
("the family calendar everyone can see", in English, old artwork) over a link
into the web app. On a phone that opened the browser version; and anyone who
went to the store to install the app lost the invitation on the way, because
the app cannot pick up an ahenora.com link by itself.

So an invitation now opens a page of its own:
  * the link preview says it is an invitation, in the inviter's language;
  * the page says who is inviting (asked of the server, which also says when
    an invitation has expired or been used);
  * one button gets the app from the right store for that phone, copying the
    invitation first so it can be pasted into the app after installing;
  * "Open in Ahenora" hands the invitation to the app when it is installed;
  * a computer, or anyone who prefers, can carry on in the browser.

Run:  python3 scripts/build_join_pages.py
"""
import html
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(HERE, "..", "docs")

# The live server. The site is only ever the production site, and the page
# reads nothing but the public invitation lookup.
API = "https://household-coo-production.up.railway.app"
APP_STORE = "https://apps.apple.com/app/id6806811163"
GOOGLE_PLAY = "https://play.google.com/store/apps/details?id=com.householdcoo.app"
SCHEME = "householdcoo://"

LANGS = {
    "en": {
        "path": "join",
        "title": "You're invited to Ahenora",
        "og_title": "You're invited to join a household on Ahenora",
        "og_desc": "Open the invitation to join them: one shared calendar, tasks and lists for the whole family.",
        "heading_named": "{name} invites you to join their household",
        "heading": "You're invited to join a household",
        "sub": "Ahenora is the family's shared calendar, tasks and lists, so everyone sees the same week.",
        "step_get": "Get the app",
        "step_open": "Open your invitation",
        "app_store": "Download on the App Store",
        "google_play": "Get it on Google Play",
        "open_app": "Open in Ahenora",
        "open_hint": "Already have the app? This opens your invitation in it.",
        "copy": "Copy my invitation",
        "copied": "Copied. In Ahenora, tap “Have an invitation?” and paste it.",
        "copy_manual": "This browser would not copy it. Press and hold the link below, copy it, then get the app and paste it there.",
        "copy_hint": "If the app does not open it, copy your invitation, then in Ahenora tap “Have an invitation?” and paste it.",
        "browser": "Or continue in your browser",
        "gone": "This invitation has expired or has already been used. Ask them to send you a new one.",
        "missing": "This link is missing its invitation. Ask them to send it again.",
        "footer": "Ahenora · No ads · Your family's data is never sold",
    },
    "fr": {
        "path": "fr/join",
        "title": "Vous êtes invité·e sur Ahenora",
        "og_title": "Vous êtes invité·e à rejoindre un foyer sur Ahenora",
        "og_desc": "Ouvrez l’invitation pour les rejoindre : un agenda, des tâches et des listes partagés par toute la famille.",
        "heading_named": "{name} vous invite à rejoindre son foyer",
        "heading": "Vous êtes invité·e à rejoindre un foyer",
        "sub": "Ahenora, c’est l’agenda, les tâches et les listes partagés de la famille : tout le monde voit la même semaine.",
        "step_get": "Installez l’app",
        "step_open": "Ouvrez votre invitation",
        "app_store": "Télécharger sur l’App Store",
        "google_play": "Disponible sur Google Play",
        "open_app": "Ouvrir dans Ahenora",
        "open_hint": "Vous avez déjà l’app ? Ce bouton y ouvre votre invitation.",
        "copy": "Copier mon invitation",
        "copied": "Copiée. Dans Ahenora, touchez « Vous avez une invitation ? » et collez-la.",
        "copy_manual": "Ce navigateur n’a pas pu la copier. Appuyez longuement sur le lien ci-dessous, copiez-le, puis installez l’app et collez-le.",
        "copy_hint": "Si l’app ne l’ouvre pas, copiez votre invitation, puis dans Ahenora touchez « Vous avez une invitation ? » et collez-la.",
        "browser": "Ou continuer dans le navigateur",
        "gone": "Cette invitation a expiré ou a déjà été utilisée. Demandez-leur de vous en envoyer une nouvelle.",
        "missing": "Il manque l’invitation dans ce lien. Demandez-leur de vous le renvoyer.",
        "footer": "Ahenora · Sans publicité · Les données de votre famille ne sont jamais vendues",
    },
    "es": {
        "path": "es/join",
        "title": "Te han invitado a Ahenora",
        "og_title": "Te han invitado a unirte a un hogar en Ahenora",
        "og_desc": "Abre la invitación para unirte: un calendario, tareas y listas compartidos por toda la familia.",
        "heading_named": "{name} te invita a unirte a su hogar",
        "heading": "Te han invitado a unirte a un hogar",
        "sub": "Ahenora es el calendario, las tareas y las listas compartidos de la familia: todos ven la misma semana.",
        "step_get": "Descarga la app",
        "step_open": "Abre tu invitación",
        "app_store": "Descargar en el App Store",
        "google_play": "Disponible en Google Play",
        "open_app": "Abrir en Ahenora",
        "open_hint": "¿Ya tienes la app? Esto abre tu invitación en ella.",
        "copy": "Copiar mi invitación",
        "copied": "Copiada. En Ahenora, toca «¿Tienes una invitación?» y pégala.",
        "copy_manual": "Este navegador no pudo copiarla. Mantén pulsado el enlace de abajo, cópialo y luego instala la app y pégalo allí.",
        "copy_hint": "Si la app no la abre, copia tu invitación y, en Ahenora, toca «¿Tienes una invitación?» y pégala.",
        "browser": "O continúa en el navegador",
        "gone": "Esta invitación ha caducado o ya se ha usado. Pídeles que te envíen una nueva.",
        "missing": "A este enlace le falta la invitación. Pídeles que te lo vuelvan a enviar.",
        "footer": "Ahenora · Sin anuncios · Los datos de tu familia nunca se venden",
    },
    "de": {
        "path": "de/join",
        "title": "Du bist zu Ahenora eingeladen",
        "og_title": "Du bist eingeladen, einem Haushalt auf Ahenora beizutreten",
        "og_desc": "Öffne die Einladung, um beizutreten: ein gemeinsamer Kalender, Aufgaben und Listen für die ganze Familie.",
        "heading_named": "{name} lädt dich in den Haushalt ein",
        "heading": "Du bist eingeladen, einem Haushalt beizutreten",
        "sub": "Ahenora ist der gemeinsame Kalender der Familie, mit Aufgaben und Listen – alle sehen dieselbe Woche.",
        "step_get": "App holen",
        "step_open": "Einladung öffnen",
        "app_store": "Laden im App Store",
        "google_play": "Jetzt bei Google Play",
        "open_app": "In Ahenora öffnen",
        "open_hint": "Du hast die App schon? Damit öffnest du die Einladung darin.",
        "copy": "Meine Einladung kopieren",
        "copied": "Kopiert. Tippe in Ahenora auf „Hast du eine Einladung?“ und füge sie ein.",
        "copy_manual": "Dieser Browser konnte sie nicht kopieren. Halte den Link unten gedrückt, kopiere ihn, hol dir dann die App und füge ihn dort ein.",
        "copy_hint": "Öffnet die App sie nicht, kopiere deine Einladung und tippe in Ahenora auf „Hast du eine Einladung?“, um sie einzufügen.",
        "browser": "Oder im Browser weitermachen",
        "gone": "Diese Einladung ist abgelaufen oder wurde schon verwendet. Bitte um eine neue.",
        "missing": "In diesem Link fehlt die Einladung. Bitte darum, ihn noch einmal zu schicken.",
        "footer": "Ahenora · Keine Werbung · Die Daten deiner Familie werden nie verkauft",
    },
}

TEMPLATE = """<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="robots" content="noindex">
<meta name="description" content="{og_desc}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Ahenora">
<meta property="og:title" content="{og_title}">
<meta property="og:description" content="{og_desc}">
<meta property="og:image" content="https://ahenora.com/assets/invite-og-{lang}.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="https://ahenora.com/{path}/">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;700;800&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet">
<style>
  :root {{ --bg:#FAF6F1; --card:#FFFFFF; --ink:#22201D; --muted:#6B635B; --line:#ECE4DA;
          --orange:#F26A1B; --orangeDeep:#CA470A; --soft:#FDEBDD; }}
  * {{ box-sizing:border-box; }}
  html,body {{ margin:0; background:var(--bg); color:var(--ink);
              font-family:Figtree,-apple-system,"Segoe UI",Roboto,Arial,sans-serif; }}
  main {{ max-width:440px; margin:0 auto; padding:28px 20px 40px; }}
  .brand {{ display:flex; align-items:center; gap:10px; font-weight:800; font-size:20px; }}
  .brand img {{ width:40px; height:40px; border-radius:11px; }}
  h1 {{ font-family:"Playfair Display",Georgia,serif; font-weight:800; font-size:30px;
       line-height:1.12; margin:26px 0 10px; text-wrap:balance; }}
  .sub {{ color:var(--muted); font-size:15.5px; line-height:1.5; margin:0 0 22px; }}
  .step {{ background:var(--card); border:1px solid var(--line); border-radius:18px;
          padding:16px; margin-bottom:12px; }}
  .step h2 {{ display:flex; align-items:center; gap:10px; font-size:16px; margin:0 0 12px; }}
  .num {{ width:24px; height:24px; border-radius:99px; background:var(--soft); color:var(--orangeDeep);
         display:inline-flex; align-items:center; justify-content:center; font-size:13px; font-weight:800; }}
  a.btn, button.btn {{ display:block; width:100%; text-align:center; text-decoration:none; border:0;
         font:inherit; font-weight:800; font-size:16px; padding:14px 16px; border-radius:14px;
         cursor:pointer; margin-top:8px; }}
  .primary {{ background:var(--orange); color:#fff; }}
  .ghost {{ background:var(--soft); color:var(--orangeDeep); }}
  .hint {{ color:var(--muted); font-size:13.5px; line-height:1.45; margin:10px 2px 0; }}
  .ok {{ color:#2E7852; font-weight:700; }}
  .browser {{ display:block; text-align:center; margin:18px 0 0; color:var(--orangeDeep);
             font-weight:700; font-size:15px; }}
  .gone {{ background:var(--card); border:1px solid var(--line); border-radius:18px; padding:18px;
          font-size:15.5px; line-height:1.5; }}
  footer {{ color:var(--muted); font-size:12.5px; text-align:center; margin-top:28px; }}
  [hidden] {{ display:none !important; }}
  a:focus-visible, button:focus-visible {{ outline:3px solid var(--orange); outline-offset:2px; }}
</style>
</head>
<body>
<main>
  <div class="brand"><img src="/assets/icon.png" alt="">Ahenora</div>
  <h1 id="heading">{heading}</h1>
  <p class="sub">{sub}</p>

  <div id="gone" class="gone" hidden></div>

  <div id="steps">
    <section class="step" id="get">
      <h2><span class="num">1</span>{step_get}</h2>
      <a class="btn primary" id="store-ios" href="{app_store}">{app_store_label}</a>
      <a class="btn primary" id="store-android" href="{google_play}">{google_play_label}</a>
    </section>
    <section class="step">
      <h2><span class="num">2</span>{step_open}</h2>
      <a class="btn primary" id="open-app" href="{scheme}">{open_app}</a>
      <p class="hint">{open_hint}</p>
      <button class="btn ghost" id="copy" type="button">{copy}</button>
      <p class="hint" id="copy-note">{copy_hint}</p>
    </section>
    <a class="browser" id="browser" href="/app/">{browser}</a>
  </div>
  <footer>{footer}</footer>
</main>
<script>
(function () {{
  var TEXT = {text_json};
  var API = {api_json};
  var params = new URLSearchParams(window.location.search);
  var token = (params.get('invite') || '').trim();
  var valid = /^[A-Za-z0-9_-]{{8,200}}$/.test(token);
  var $ = function (id) {{ return document.getElementById(id); }};

  function showGone(message) {{
    $('steps').hidden = true;
    $('gone').hidden = false;
    $('gone').textContent = message;
  }}
  if (!valid) {{ showGone(TEXT.missing); return; }}

  // The invitation as a link the app understands, and as one it can paste.
  var joinLink = window.location.origin + window.location.pathname + '?invite=' + encodeURIComponent(token);
  $('open-app').href = '{scheme}?invite=' + encodeURIComponent(token);
  $('browser').href = '/app/?invite=' + encodeURIComponent(token);

  // Only the store this phone can use; a computer is offered both, and the
  // browser comes first for it.
  var ua = navigator.userAgent || '';
  var android = /Android/i.test(ua) && !/CrOS/i.test(ua);
  var ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1);
  if (android) $('store-ios').hidden = true;
  if (ios) $('store-android').hidden = true;

  // In-app browsers (Facebook, Instagram, Messenger) often have no clipboard
  // API, or refuse it. Then the old way, and if that fails too the link is
  // shown to copy by hand: a silent failure here meant the store opened and
  // the invitation was lost.
  function legacyCopy() {{
    try {{
      var area = document.createElement('textarea');
      area.value = joinLink;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    }} catch (e) {{ return false; }}
  }}
  var shownByHand = false;
  function showByHand() {{
    shownByHand = true;
    var note = $('copy-note');
    note.className = 'hint';
    note.textContent = TEXT.copy_manual + ' ';
    var link = document.createElement('span');
    link.textContent = joinLink;
    link.style.userSelect = 'all';
    link.style.webkitUserSelect = 'all';
    link.style.wordBreak = 'break-all';
    link.style.fontWeight = '700';
    note.appendChild(link);
  }}
  function copy(then) {{
    var finished = false;
    var done = function (ok) {{
      if (finished) return;
      finished = true;
      if (!ok && !legacyCopy()) {{ showByHand(); return; }}
      $('copy-note').textContent = TEXT.copied;
      $('copy-note').className = 'hint ok';
      if (then) then();
    }};
    // A clipboard promise that never settles counts as a refusal.
    setTimeout(function () {{ done(false); }}, 1500);
    try {{
      navigator.clipboard.writeText(joinLink).then(function () {{ done(true); }}, function () {{ done(false); }});
    }} catch (e) {{ done(false); }}
  }}
  $('copy').addEventListener('click', function () {{ copy(); }});
  // Going to the store loses the link, so the invitation is copied on the way.
  // When it could not be copied, the first tap shows it instead; a second tap
  // goes to the store.
  ['store-ios', 'store-android'].forEach(function (id) {{
    $(id).addEventListener('click', function (e) {{
      var href = this.href;
      if (shownByHand) return;
      e.preventDefault();
      var gone = false;
      var go = function () {{ if (!gone) {{ gone = true; window.location.href = href; }} }};
      copy(go);
    }});
  }});

  // Who is inviting, and whether the invitation still stands.
  fetch(API + '/api/family/invite/' + encodeURIComponent(token))
    .then(function (res) {{
      if (res.status === 404 || res.status === 410) {{ showGone(TEXT.gone); return null; }}
      return res.ok ? res.json() : null;
    }})
    .then(function (invite) {{
      if (!invite) return;
      if (invite.status && invite.status !== 'pending') {{ showGone(TEXT.gone); return; }}
      var name = (invite.inviter_name || '').trim();
      if (name) $('heading').textContent = TEXT.heading_named.split('{{name}}').join(name);
    }})
    .catch(function () {{ /* the page still works without the name */ }});
}})();
</script>
</body>
</html>
"""


def page(code: str, copy: dict) -> str:
    esc = {k: html.escape(v, quote=True) for k, v in copy.items()}
    text = {k: copy[k] for k in ("heading_named", "gone", "missing", "copied", "copy_manual")}
    return TEMPLATE.format(
        lang=code, scheme=SCHEME, app_store=APP_STORE, google_play=GOOGLE_PLAY,
        app_store_label=esc["app_store"], google_play_label=esc["google_play"],
        text_json=json.dumps(text, ensure_ascii=False).replace("</", "<\\/"),
        api_json=json.dumps(API),
        **{k: v for k, v in esc.items() if k not in ("app_store", "google_play")},
    )


def build():
    written = []
    for code, copy in LANGS.items():
        folder = os.path.join(DOCS, copy["path"])
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, "index.html")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(page(code, copy))
        written.append(path)
    return written


if __name__ == "__main__":
    for p in build():
        print("wrote", os.path.relpath(p, os.path.join(HERE, "..")))
