/* Install prompt, offline service worker and update notice. */
const $ = (id) => document.getElementById(id);
const installBtn = $('g-install');
const toastEl = $('toast'), toastText = $('toast-text'), toastBtn = $('toast-btn');
let toastTimer = 0;

function toast(text, action, onAction, sticky = false) {
  clearTimeout(toastTimer);
  toastText.textContent = text;
  toastBtn.hidden = !action;
  if (action) { toastBtn.textContent = action; toastBtn.onclick = () => { toastEl.hidden = true; onAction(); }; }
  toastEl.hidden = false;
  if (!sticky) toastTimer = setTimeout(() => { toastEl.hidden = true; }, 5000);
}
$('toast-close').addEventListener('click', () => { toastEl.hidden = true; });

/* ---------- Install ---------- */
const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let deferredPrompt = null;

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();          // show our own button instead of the browser mini-bar
  deferredPrompt = e;
  installBtn.hidden = false;
});
if (isIOS && !isStandalone()) installBtn.hidden = false; // Safari has no prompt API, so we explain the steps

installBtn.addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome === 'accepted') installBtn.hidden = true;
  } else if (isIOS) {
    $('ios-hint').hidden = false;
    $('ios-ok').focus({ preventScroll: true });
  }
});
$('ios-ok').addEventListener('click', () => { $('ios-hint').hidden = true; });
addEventListener('appinstalled', () => {
  installBtn.hidden = true;
  toast('Installed. Launch Cyber Turbo from your home screen or app list.');
});

/* ---------- Service worker ---------- */
const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
if ('serviceWorker' in navigator && secure) {
  addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      let userAskedReload = false;
      const offerUpdate = (worker) =>
        toast('A new version is ready', 'Reload', () => { userAskedReload = true; worker.postMessage('SKIP_WAITING'); }, true);

      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state !== 'installed') return;
          if (navigator.serviceWorker.controller) offerUpdate(worker);
          else toast('Saved for offline play');
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (userAskedReload) location.reload();
      });
      // Look for a new version every hour while the game stays open
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    } catch (err) {
      console.warn('Service worker registration failed:', err);
    }
  });
}

/* iOS Safari ignores user-scalable rules; stop pinch-zoom from breaking the controls */
document.addEventListener('gesturestart', (e) => e.preventDefault());
