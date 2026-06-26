// Wspólny uploader dzielący pliki na kawałki (chunked upload), wysyłane RÓWNOLEGLE.
// Omija limity rozmiaru pojedynczego requestu na hostingu współdzielonym i jest
// szybszy dzięki wysyłaniu kilku kawałków naraz (serwer składa je po indeksach).
//
// window.chunkedUpload(files, chunkUrl, onProgress, concurrency) -> Promise<uploadId>
//   files       : FileList lub tablica File
//   chunkUrl    : endpoint przyjmujący kawałki (np. '/admin/transfers/chunk')
//   onProgress  : (percent 0..100) => void   (opcjonalnie)
//   concurrency : ile kawałków naraz (domyślnie 3, zakres 1..4)
(function () {
  var CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB

  function randomId() {
    if (window.crypto && window.crypto.getRandomValues) {
      var a = new Uint8Array(16);
      window.crypto.getRandomValues(a);
      return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    }
    return (Date.now().toString(16) + Math.random().toString(16).slice(2)).padEnd(32, '0').slice(0, 32);
  }

  function sendChunk(chunkUrl, uploadId, job, onChunkProgress) {
    return new Promise(function (resolve, reject) {
      var start = job.ci * CHUNK_SIZE;
      var blob = job.file.slice(start, start + CHUNK_SIZE);
      // Wysyłamy jako multipart/form-data (a NIE octet-stream + nagłówki X-*),
      // bo standardowy formularz przechodzi przez WAF/proxy hostingu współdzielonego.
      var fd = new FormData();
      fd.append('uploadId', uploadId);
      fd.append('fileIndex', String(job.fi));
      fd.append('fileName', job.file.name);
      fd.append('fileType', job.file.type || '');
      fd.append('chunkIndex', String(job.ci));
      fd.append('totalChunks', String(job.total));
      fd.append('chunk', blob, 'chunk');
      var xhr = new XMLHttpRequest();
      xhr.open('POST', chunkUrl);
      // Bez setRequestHeader — przeglądarka sama ustawi multipart z boundary.
      xhr.upload.onprogress = function (e) { if (onChunkProgress) onChunkProgress(job, e.loaded); };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error('Błąd przesyłania kawałka (' + xhr.status + ')'));
      };
      xhr.onerror = function () { reject(new Error('Błąd sieci podczas przesyłania')); };
      xhr.send(fd);
    });
  }

  function chunkedUpload(files, chunkUrl, onProgress, concurrency) {
    var arr = Array.prototype.slice.call(files);
    var uploadId = randomId();
    var totalBytes = arr.reduce(function (n, f) { return n + f.size; }, 0) || 1;
    var pool = Math.max(1, Math.min(4, concurrency || 3));

    // Zbuduj listę wszystkich kawałków (po wszystkich plikach).
    var jobs = [];
    arr.forEach(function (file, fi) {
      var total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
      for (var ci = 0; ci < total; ci++) jobs.push({ file: file, fi: fi, ci: ci, total: total });
    });

    var doneBytes = 0;        // bajty z ukończonych kawałków
    var liveLoaded = {};      // postęp aktualnie wysyłanych kawałków (po kluczu)
    function report() {
      var live = 0;
      for (var k in liveLoaded) live += liveLoaded[k];
      if (onProgress) onProgress(Math.min(99, Math.round(((doneBytes + live) / totalBytes) * 100)));
    }
    function onChunkProgress(job, loaded) { liveLoaded[job.fi + '_' + job.ci] = loaded; report(); }

    var next = 0;
    function worker() {
      if (next >= jobs.length) return Promise.resolve();
      var job = jobs[next++];
      var key = job.fi + '_' + job.ci;
      return sendChunk(chunkUrl, uploadId, job, onChunkProgress).then(function () {
        var size = Math.min(CHUNK_SIZE, job.file.size - job.ci * CHUNK_SIZE);
        doneBytes += size < 0 ? 0 : size;
        delete liveLoaded[key];
        report();
        return worker();
      });
    }

    return Promise.all(
      Array.apply(null, { length: pool }).map(function () { return worker(); })
    ).then(function () {
      if (onProgress) onProgress(100);
      return uploadId;
    });
  }

  window.chunkedUpload = chunkedUpload;
})();
