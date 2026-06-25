// Wspólny uploader dzielący pliki na kawałki (chunked upload).
// Omija limity rozmiaru pojedynczego requestu na hostingu współdzielonym.
//
// window.chunkedUpload(files, chunkUrl, onProgress) -> Promise<uploadId>
//   files     : FileList lub tablica File
//   chunkUrl  : endpoint przyjmujący kawałki (np. '/admin/transfers/chunk')
//   onProgress: (percent 0..100) => void   (opcjonalnie)
// Po rozwiązaniu Promise wyślij właściwe żądanie tworzące z nagłówkiem
// 'X-Upload-Id: <uploadId>' i polami formularza (urlencoded) — serwer złoży pliki.
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

  function sendChunk(chunkUrl, uploadId, file, fileIndex, chunkIndex, totalChunks, onUploadProgress) {
    return new Promise(function (resolve, reject) {
      var start = chunkIndex * CHUNK_SIZE;
      var blob = file.slice(start, start + CHUNK_SIZE);
      var xhr = new XMLHttpRequest();
      xhr.open('POST', chunkUrl);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('X-Upload-Id', uploadId);
      xhr.setRequestHeader('X-File-Index', String(fileIndex));
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
      xhr.setRequestHeader('X-File-Type', file.type || '');
      xhr.setRequestHeader('X-Chunk-Index', String(chunkIndex));
      xhr.setRequestHeader('X-Total-Chunks', String(totalChunks));
      xhr.upload.onprogress = function (e) { if (onUploadProgress) onUploadProgress(e.loaded); };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) resolve(blob.size);
        else reject(new Error('Błąd przesyłania kawałka (' + xhr.status + ')'));
      };
      xhr.onerror = function () { reject(new Error('Błąd sieci podczas przesyłania')); };
      xhr.send(blob);
    });
  }

  function chunkedUpload(files, chunkUrl, onProgress) {
    var arr = Array.prototype.slice.call(files);
    var uploadId = randomId();
    var totalBytes = arr.reduce(function (n, f) { return n + f.size; }, 0) || 1;
    var completed = 0; // bajty w pełni wysłanych kawałków

    return (async function () {
      for (var fi = 0; fi < arr.length; fi++) {
        var file = arr[fi];
        var totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
        for (var ci = 0; ci < totalChunks; ci++) {
          await sendChunk(chunkUrl, uploadId, file, fi, ci, totalChunks, function (loaded) {
            if (onProgress) onProgress(Math.min(99, Math.round(((completed + loaded) / totalBytes) * 100)));
          });
          completed += Math.min(CHUNK_SIZE, file.size - ci * CHUNK_SIZE);
          if (onProgress) onProgress(Math.min(99, Math.round((completed / totalBytes) * 100)));
        }
      }
      if (onProgress) onProgress(100);
      return uploadId;
    })();
  }

  window.chunkedUpload = chunkedUpload;
})();
