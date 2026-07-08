// Wspólny uploader dzielący pliki na kawałki (chunked upload), wysyłane RÓWNOLEGLE.
// Omija limity rozmiaru pojedynczego requestu na hostingu współdzielonym i jest
// szybszy dzięki wysyłaniu kilku kawałków naraz (serwer składa je po indeksach).
//
// window.chunkedUpload(files, chunkUrl, onProgress, concurrency, onFileProgress) -> Promise<uploadId>
//   files          : FileList, tablica File LUB tablica { file, name } (name = ścieżka względna
//                    z folderu, np. 'katalog/plik.pdf' — serwer zapisze ją jako originalName)
//   chunkUrl       : endpoint przyjmujący kawałki (np. '/admin/transfers/chunk')
//   onProgress     : (percent 0..100) => void                  (postęp łączny, opcjonalnie)
//   concurrency    : ile kawałków naraz (domyślnie 3, zakres 1..4)
//   onFileProgress : (fileIndex, percent 0..100) => void       (postęp per-plik, opcjonalnie)
//
// window.collectDataTransferFiles(dataTransfer) -> Promise<[{ file, relPath }]>
//   Zbiera pliki z przeciągnięcia, WCHODZĄC REKURENCYJNIE do upuszczonych katalogów
//   (webkitGetAsEntry). Bez tego folder w e.dataTransfer.files to nieczytelny pseudo-plik
//   (0 B, bez typu) — próba wysłania kończy się błędem sieci. Pomija pliki-śmieci systemowe.
(function () {
  var CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
  var CHUNK_RETRIES = 3;            // próby na kawałek (1 + 2 powtórki)
  var CHUNK_TIMEOUT = 120000;       // ms na pojedynczy kawałek
  var JUNK = /^(\.DS_Store|Thumbs\.db|desktop\.ini|\.localized)$|^\._/;

  function randomId() {
    if (window.crypto && window.crypto.getRandomValues) {
      var a = new Uint8Array(16);
      window.crypto.getRandomValues(a);
      return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    }
    return (Date.now().toString(16) + Math.random().toString(16).slice(2)).padEnd(32, '0').slice(0, 32);
  }

  function sendChunkOnce(chunkUrl, uploadId, job, onChunkProgress) {
    return new Promise(function (resolve, reject) {
      var start = job.ci * CHUNK_SIZE;
      var blob = job.file.slice(start, start + CHUNK_SIZE);
      // Wysyłamy jako multipart/form-data (a NIE octet-stream + nagłówki X-*),
      // bo standardowy formularz przechodzi przez WAF/proxy hostingu współdzielonego.
      var fd = new FormData();
      fd.append('uploadId', uploadId);
      fd.append('fileIndex', String(job.fi));
      fd.append('fileName', job.name);
      fd.append('fileType', job.file.type || '');
      fd.append('chunkIndex', String(job.ci));
      fd.append('totalChunks', String(job.total));
      fd.append('chunk', blob, 'chunk');
      var xhr = new XMLHttpRequest();
      xhr.open('POST', chunkUrl);
      xhr.timeout = CHUNK_TIMEOUT;
      // Bez setRequestHeader — przeglądarka sama ustawi multipart z boundary.
      xhr.upload.onprogress = function (e) { if (onChunkProgress) onChunkProgress(job, e.loaded); };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        // 4xx (poza 429) nie ma sensu powtarzać — serwer odrzucił kawałek świadomie.
        // Dołączamy powód z odpowiedzi ({ error }), żeby komunikat coś mówił.
        var detail = '';
        try { detail = JSON.parse(xhr.responseText).error || ''; } catch (e) {}
        reject(mkError('Błąd przesyłania kawałka (' + xhr.status + ')' + (detail ? ': ' + detail : ''), xhr.status >= 500 || xhr.status === 429));
      };
      xhr.onerror = function () { reject(mkError('Błąd sieci podczas przesyłania', true)); };
      xhr.ontimeout = function () { reject(mkError('Przekroczono czas przesyłania kawałka', true)); };
      xhr.send(fd);
    });
  }

  function mkError(msg, retryable) {
    var e = new Error(msg);
    e.retryable = retryable;
    return e;
  }

  // Kawałek ponawiamy z odczekaniem (0.5s, 2s) — chwilowe zerwania łącza,
  // limity połączeń hostingu czy timeouty nie wywalają całego uploadu.
  function sendChunk(chunkUrl, uploadId, job, onChunkProgress, attempt) {
    attempt = attempt || 1;
    return sendChunkOnce(chunkUrl, uploadId, job, onChunkProgress).catch(function (err) {
      if (!err.retryable || attempt >= CHUNK_RETRIES) throw err;
      if (onChunkProgress) onChunkProgress(job, 0); // wyzeruj postęp powtarzanego kawałka
      return new Promise(function (r) { setTimeout(r, attempt === 1 ? 500 : 2000); }).then(function () {
        return sendChunk(chunkUrl, uploadId, job, onChunkProgress, attempt + 1);
      });
    });
  }

  function chunkedUpload(files, chunkUrl, onProgress, concurrency, onFileProgress) {
    // Normalizacja wejścia: File → { file, name }; wpisy z folderów niosą ścieżkę względną.
    var arr = Array.prototype.slice.call(files).map(function (f) {
      var file = f && f.file ? f.file : f;
      var name = (f && (f.name || f.relPath)) || file.name;
      return { file: file, name: name };
    });
    var uploadId = randomId();
    var totalBytes = arr.reduce(function (n, it) { return n + it.file.size; }, 0) || 1;
    var pool = Math.max(1, Math.min(4, concurrency || 3));

    // Zbuduj listę wszystkich kawałków (po wszystkich plikach).
    var jobs = [];
    arr.forEach(function (it, fi) {
      var total = Math.max(1, Math.ceil(it.file.size / CHUNK_SIZE));
      for (var ci = 0; ci < total; ci++) jobs.push({ file: it.file, name: it.name, fi: fi, ci: ci, total: total });
    });

    var doneBytes = 0;        // bajty z ukończonych kawałków (łącznie)
    var doneByFile = {};      // ukończone bajty per plik (indeks fi)
    var liveLoaded = {};      // postęp aktualnie wysyłanych kawałków (po kluczu fi_ci)
    function report() {
      var live = 0;
      for (var k in liveLoaded) live += liveLoaded[k];
      if (onProgress) onProgress(Math.min(99, Math.round(((doneBytes + live) / totalBytes) * 100)));
      if (onFileProgress) {
        var liveByFile = {};
        for (var key in liveLoaded) { var f = key.split('_')[0]; liveByFile[f] = (liveByFile[f] || 0) + liveLoaded[key]; }
        arr.forEach(function (it, fi) {
          var got = (doneByFile[fi] || 0) + (liveByFile[fi] || 0);
          onFileProgress(fi, Math.min(99, Math.round((got / (it.file.size || 1)) * 100)));
        });
      }
    }
    function onChunkProgress(job, loaded) { liveLoaded[job.fi + '_' + job.ci] = loaded; report(); }

    var next = 0;
    function worker() {
      if (next >= jobs.length) return Promise.resolve();
      var job = jobs[next++];
      var key = job.fi + '_' + job.ci;
      return sendChunk(chunkUrl, uploadId, job, onChunkProgress).then(function () {
        var size = Math.min(CHUNK_SIZE, job.file.size - job.ci * CHUNK_SIZE);
        size = size < 0 ? 0 : size;
        doneBytes += size;
        doneByFile[job.fi] = (doneByFile[job.fi] || 0) + size;
        delete liveLoaded[key];
        report();
        return worker();
      });
    }

    return Promise.all(
      Array.apply(null, { length: pool }).map(function () { return worker(); })
    ).then(function () {
      if (onProgress) onProgress(100);
      if (onFileProgress) arr.forEach(function (it, fi) { onFileProgress(fi, 100); });
      return uploadId;
    });
  }

  // ── Zbieranie plików z drag&drop (w tym całych katalogów) ──────────────────

  function isJunkName(name) { return JUNK.test(name || ''); }

  // Rekurencyjne czytanie FileSystemDirectoryEntry. GOTCHA: readEntries() zwraca
  // porcjami (Chrome: max 100 wpisów) — trzeba wołać w pętli aż zwróci pustą tablicę.
  function readAllEntries(reader) {
    return new Promise(function (resolve, reject) {
      var all = [];
      (function loop() {
        reader.readEntries(function (entries) {
          if (!entries.length) return resolve(all);
          all = all.concat(Array.prototype.slice.call(entries));
          loop();
        }, reject);
      })();
    });
  }

  function walkEntry(entry, out) {
    if (!entry) return Promise.resolve();
    if (entry.isFile) {
      if (isJunkName(entry.name)) return Promise.resolve();
      return new Promise(function (resolve) {
        entry.file(function (file) {
          // fullPath zaczyna się od '/', np. '/katalog/plik.pdf' → 'katalog/plik.pdf'.
          out.push({ file: file, relPath: String(entry.fullPath || file.name).replace(/^\/+/, '') });
          resolve();
        }, function () { resolve(); }); // nieczytelny wpis pomijamy zamiast wywalać upload
      });
    }
    if (entry.isDirectory) {
      return readAllEntries(entry.createReader()).then(function (entries) {
        return entries.reduce(function (p, e) { return p.then(function () { return walkEntry(e, out); }); }, Promise.resolve());
      }).catch(function () {});
    }
    return Promise.resolve();
  }

  function collectDataTransferFiles(dt) {
    var items = dt && dt.items;
    // Nowoczesna ścieżka: webkitGetAsEntry pozwala wejść do katalogów.
    if (items && items.length && items[0].webkitGetAsEntry) {
      var entries = [];
      for (var i = 0; i < items.length; i++) {
        var entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
        if (entry) entries.push(entry);
      }
      var out = [];
      return entries.reduce(function (p, e) { return p.then(function () { return walkEntry(e, out); }); }, Promise.resolve())
        .then(function () { return out; });
    }
    // Fallback: zwykłe pliki; katalog-pseudo-plik (0 B, bez typu) odfiltrowujemy.
    var files = Array.prototype.slice.call((dt && dt.files) || []);
    return Promise.resolve(
      files
        .filter(function (f) { return !(f.size === 0 && !f.type) && !isJunkName(f.name); })
        .map(function (f) { return { file: f, relPath: f.name }; })
    );
  }

  window.chunkedUpload = chunkedUpload;
  window.collectDataTransferFiles = collectDataTransferFiles;
})();
