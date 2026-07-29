// Passkeys (WebAuthn) — warstwa przeglądarki. Ciężką robotę (weryfikacja podpisów)
// robi serwer; tutaj tylko konwersja base64url ↔ ArrayBuffer i wywołanie API przeglądarki.
// Bez zależności → CSP 'self' bez zmian.
(function () {
  'use strict';

  var b64uToBuf = function (s) {
    var pad = '='.repeat((4 - (s.length % 4)) % 4);
    var bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  };
  var bufToB64u = function (buf) {
    var bytes = new Uint8Array(buf), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  // Czy przeglądarka w ogóle potrafi passkeys (wymaga HTTPS albo localhost).
  function supported() {
    return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
  }

  var postJson = function (url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, data: j }; }); });
  };

  // Odpowiedź przeglądarki → JSON w formacie, którego oczekuje @simplewebauthn.
  function credToJson(cred) {
    if (typeof cred.toJSON === 'function') return cred.toJSON(); // nowoczesne przeglądarki
    var r = cred.response, out = {
      id: cred.id,
      rawId: bufToB64u(cred.rawId),
      type: cred.type,
      clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
      response: { clientDataJSON: bufToB64u(r.clientDataJSON) },
    };
    if (r.attestationObject) { // rejestracja
      out.response.attestationObject = bufToB64u(r.attestationObject);
      if (r.getTransports) out.response.transports = r.getTransports();
    } else { // logowanie
      out.response.authenticatorData = bufToB64u(r.authenticatorData);
      out.response.signature = bufToB64u(r.signature);
      out.response.userHandle = r.userHandle ? bufToB64u(r.userHandle) : null;
    }
    return out;
  }

  // ── Rejestracja nowego klucza (w panelu, po zalogowaniu) ───────────────────
  async function register(label) {
    if (!supported()) throw new Error('Ta przeglądarka nie obsługuje passkeys.');
    var res = await postJson('/admin/account/passkey/options', {});
    if (!res.ok) throw new Error(res.data.error || 'Nie udało się rozpocząć.');
    var opts = res.data;

    opts.challenge = b64uToBuf(opts.challenge);
    opts.user.id = b64uToBuf(opts.user.id);
    if (opts.excludeCredentials) {
      opts.excludeCredentials = opts.excludeCredentials.map(function (c) { return Object.assign({}, c, { id: b64uToBuf(c.id) }); });
    }

    var cred = await navigator.credentials.create({ publicKey: opts });
    if (!cred) throw new Error('Anulowano.');
    var verify = await postJson('/admin/account/passkey/verify', { response: credToJson(cred), label: label || '' });
    if (!verify.ok) throw new Error(verify.data.error || 'Weryfikacja nie powiodła się.');
    return true;
  }

  // ── Logowanie kluczem (bez hasła) ──────────────────────────────────────────
  async function login() {
    if (!supported()) throw new Error('Ta przeglądarka nie obsługuje passkeys.');
    var res = await postJson('/admin/login/passkey/options', {});
    if (!res.ok) throw new Error(res.data.error || 'Nie udało się rozpocząć.');
    var opts = res.data;

    opts.challenge = b64uToBuf(opts.challenge);
    if (opts.allowCredentials) {
      opts.allowCredentials = opts.allowCredentials.map(function (c) { return Object.assign({}, c, { id: b64uToBuf(c.id) }); });
    }

    var cred = await navigator.credentials.get({ publicKey: opts });
    if (!cred) throw new Error('Anulowano.');
    var verify = await postJson('/admin/login/passkey', { response: credToJson(cred) });
    if (!verify.ok) throw new Error(verify.data.error || 'Nie rozpoznano klucza.');
    window.location = verify.data.redirect || '/admin';
    return true;
  }

  window.evokePasskey = { supported: supported, register: register, login: login };
})();
