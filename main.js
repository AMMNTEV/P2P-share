// ============================================
// main.js — P2P передача файлов через WebRTC
// Мультифайл + очистка Firestore
// ============================================
import {
  createRoom, joinRoom, listenForSignal,
  sendSignal, cleanupRoom, getRoomFromUrl
} from './signaling.js';

const CHUNK_SIZE = 16 * 1024;
const BUFFER_THRESHOLD = 1024 * 1024;
const BUFFER_LOW = 256 * 1024;

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// --- Состояние ---
let pc = null;
let dataChannel = null;
let selectedFiles = [];       // массив File
let roomId = null;
let role = null;              // 'sender' | 'receiver'
let sentAllDone = false;
let receivedFiles = [];       // [{name, mime, size, blob}]
let currentRecvFile = null;   // файл в процессе приёма
let currentRecvChunks = [];
let currentRecvBytes = 0;

// --- DOM ---
const screens = {
  send:    document.getElementById('screen-send'),
  wait:    document.getElementById('screen-wait'),
  receive: document.getElementById('screen-receive'),
  error:   document.getElementById('screen-error')
};

const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const filesList = document.getElementById('filesList');
const filesTotal = document.getElementById('filesTotal');
const filesCount = document.getElementById('filesCount');
const filesTotalSize = document.getElementById('filesTotalSize');
const createLinkBtn = document.getElementById('createLinkBtn');

const linkInput = document.getElementById('linkInput');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const waitFilesList = document.getElementById('waitFilesList');
const waitStatus = document.getElementById('waitStatus');
const sendProgress = document.getElementById('sendProgress');
const sendProgressFill = document.getElementById('sendProgressFill');
const sendProgressText = document.getElementById('sendProgressText');
const cancelSendBtn = document.getElementById('cancelSendBtn');

const recvSubtitle = document.getElementById('recvSubtitle');
const recvStatus = document.getElementById('recvStatus');
const recvFilesList = document.getElementById('recvFilesList');
const recvProgress = document.getElementById('recvProgress');
const recvProgressFill = document.getElementById('recvProgressFill');
const recvProgressText = document.getElementById('recvProgressText');
const downloadAllBtn = document.getElementById('downloadAllBtn');
const cancelRecvBtn = document.getElementById('cancelRecvBtn');

const errorText = document.getElementById('errorText');
const errorBackBtn = document.getElementById('errorBackBtn');

// ============================================
// Утилиты
// ============================================
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' Б';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' МБ';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' ГБ';
}

function showError(text) {
  errorText.textContent = text;
  showScreen('error');
}

function totalSize(files) {
  return files.reduce((s, f) => s + f.size, 0);
}

// ============================================
// UI: список файлов (отправитель)
// ============================================
function renderFilesList() {
  if (selectedFiles.length === 0) {
    filesList.style.display = 'none';
    filesTotal.style.display = 'none';
    createLinkBtn.disabled = true;
    return;
  }

  filesList.style.display = 'flex';
  filesTotal.style.display = 'flex';
  filesList.innerHTML = '';

  selectedFiles.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <span class="file-item-name"></span>
      <span class="file-item-size">${formatSize(file.size)}</span>
      <button class="file-item-remove" title="Удалить">×</button>
    `;
    item.querySelector('.file-item-name').textContent = file.name;
    item.querySelector('.file-item-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      selectedFiles.splice(idx, 1);
      renderFilesList();
    });
    filesList.appendChild(item);
  });

  const n = selectedFiles.length;
  filesCount.textContent = n === 1 ? '1 файл' : n + ' файлов';
  filesTotalSize.textContent = formatSize(totalSize(selectedFiles));
  createLinkBtn.disabled = false;
}

function renderWaitFilesList() {
  waitFilesList.innerHTML = '';
  selectedFiles.forEach(file => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <span class="file-item-name"></span>
      <span class="file-item-size">${formatSize(file.size)}</span>
    `;
    item.querySelector('.file-item-name').textContent = file.name;
    waitFilesList.appendChild(item);
  });
}

function markWaitFileDone(index) {
  const items = waitFilesList.querySelectorAll('.file-item');
  if (items[index]) items[index].classList.add('done');
}

// ============================================
// UI: список файлов (получатель)
// ============================================
function renderRecvFilesList() {
  recvFilesList.innerHTML = '';
  receivedFiles.forEach((f, i) => {
    const item = document.createElement('div');
    item.className = 'file-item done';
    item.innerHTML = `
      <span class="file-item-name"></span>
      <span class="file-item-size">${formatSize(f.size)}</span>
      <button class="file-item-remove" title="Скачать">↓</button>
    `;
    item.querySelector('.file-item-name').textContent = f.name;
    item.querySelector('.file-item-remove').addEventListener('click', () => {
      downloadBlob(f.blob, f.name);
    });
    recvFilesList.appendChild(item);
  });

  if (currentRecvFile) {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <span class="file-item-name"></span>
      <span class="file-item-size">${formatSize(currentRecvFile.size)}</span>
    `;
    item.querySelector('.file-item-name').textContent = currentRecvFile.name;
    recvFilesList.appendChild(item);
  }
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ============================================
// WebRTC
// ============================================
function createPeerConnection() {
  pc = new RTCPeerConnection(RTC_CONFIG);

  pc.onicecandidate = (event) => {
    if (event.candidate && roomId) {
      sendSignal(roomId, role, {
        type: 'ice',
        candidate: event.candidate.toJSON()
      });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log('[PC]', pc.connectionState);
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      waitStatus.textContent = 'Соединение потеряно';
      waitStatus.className = 'status err';
    }
  };

  if (role === 'sender') {
    dataChannel = pc.createDataChannel('file', { ordered: true });
    setupDataChannel();
  }

  if (role === 'receiver') {
    pc.ondatachannel = (event) => {
      dataChannel = event.channel;
      setupDataChannel();
    };
  }

  return pc;
}

// ============================================
// DataChannel
// ============================================
function setupDataChannel() {
  dataChannel.binaryType = 'arraybuffer';

  dataChannel.onopen = () => {
    console.log('[DC] open');
    if (role === 'sender') {
      waitStatus.textContent = 'Соединение установлено, отправка...';
      waitStatus.className = 'status ok';
      sendProgress.style.display = 'flex';
      sendAllFiles();
    } else {
      recvStatus.textContent = 'Соединение установлено, приём...';
      recvStatus.className = 'status ok';
    }
  };

  dataChannel.onclose = () => {
    console.log('[DC] close');
  };

  dataChannel.onerror = (e) => {
    console.error('[DC]', e);
  };

  if (role === 'receiver') {
    dataChannel.onmessage = (event) => {
      const data = event.data;

      // Строковое сообщение — управляющее
      if (typeof data === 'string') {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }

        if (msg.type === 'meta') {
          // Начало нового файла
          currentRecvFile = msg;
          currentRecvChunks = [];
          currentRecvBytes = 0;
          recvSubtitle.textContent = 'Получение: ' + msg.name;
          renderRecvFilesList();
          recvProgress.style.display = 'flex';
          recvProgressFill.style.width = '0%';
          recvProgressText.textContent = '0%';
          return;
        }

        if (msg.type === 'end') {
          // Завершение текущего файла
          if (currentRecvFile) {
            const blob = new Blob(currentRecvChunks, {
              type: currentRecvFile.mime || 'application/octet-stream'
            });
            receivedFiles.push({
              name: currentRecvFile.name,
              mime: currentRecvFile.mime,
              size: currentRecvFile.size,
              blob
            });
            currentRecvFile = null;
            currentRecvChunks = [];
            currentRecvBytes = 0;
            renderRecvFilesList();
          }
          return;
        }

        if (msg.type === 'all-done') {
          // Все файлы получены
          onAllReceived();
          return;
        }

        return;
      }

      // Бинарный чанк
      if (currentRecvFile) {
        currentRecvChunks.push(data);
        currentRecvBytes += data.byteLength;

        const total = currentRecvFile.size;
        if (total > 0) {
          const percent = Math.min(100, Math.round((currentRecvBytes / total) * 100));
          recvProgressFill.style.width = percent + '%';
          recvProgressText.textContent = percent + '%';
        }
      }
    };
  }
}

// ============================================
// Отправитель: отправка всех файлов
// ============================================
async function sendAllFiles() {
  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i];
    await sendOneFile(file, i);
    markWaitFileDone(i);
  }

  // Все файлы отправлены
  dataChannel.send(JSON.stringify({ type: 'all-done' }));
  waitStatus.textContent = 'Все файлы отправлены ✓';
  waitStatus.className = 'status ok';

  // Очищаем Firestore — комната больше не нужна
  if (roomId) {
    await cleanupRoom(roomId);
    roomId = null;
    console.log('[CLEANUP] Firestore room deleted');
  }
}

async function sendOneFile(file, index) {
  // Метаданные
  dataChannel.send(JSON.stringify({
    type: 'meta',
    name: file.name,
    size: file.size,
    mime: file.type || 'application/octet-stream',
    index
  }));

  let offset = 0;
  let sentBytes = 0;

  while (offset < file.size) {
    if (dataChannel.bufferedAmount > BUFFER_THRESHOLD) {
      await new Promise(resolve => {
        const check = () => {
          if (dataChannel.bufferedAmount < BUFFER_LOW) resolve();
          else setTimeout(check, 20);
        };
        check();
      });
    }

    const chunk = await readChunk(file, offset, CHUNK_SIZE);
    dataChannel.send(chunk);

    offset += chunk.byteLength;
    sentBytes += chunk.byteLength;

    const percent = Math.round((sentBytes / file.size) * 100);
    sendProgressFill.style.width = percent + '%';
    sendProgressText.textContent = percent + '%';
  }

  // Конец файла
  dataChannel.send(JSON.stringify({ type: 'end' }));
}

function readChunk(file, offset, size) {
  return new Promise((resolve) => {
    const slice = file.slice(offset, offset + size);
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.readAsArrayBuffer(slice);
  });
}

// ============================================
// Получатель: все получено
// ============================================
async function onAllReceived() {
  recvStatus.textContent = `Получено файлов: ${receivedFiles.length} ✓`;
  recvStatus.className = 'status ok';
  recvProgressFill.style.width = '100%';
  recvProgressText.textContent = '100%';
  downloadAllBtn.style.display = 'block';

  // Очищаем Firestore — комната больше не нужна
  if (roomId) {
    await cleanupRoom(roomId);
    roomId = null;
    console.log('[CLEANUP] Firestore room deleted');
  }
}

// Кнопка «Скачать все»
downloadAllBtn.addEventListener('click', () => {
  receivedFiles.forEach((f, i) => {
    // Небольшая задержка, чтобы браузер не блокировал множественные скачивания
    setTimeout(() => downloadBlob(f.blob, f.name), i * 300);
  });
});

// ============================================
// Обработка сигналов
// ============================================
async function handleSignal(data) {
  if (!pc) return;

  try {
    if (data.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription({
        type: 'offer', sdp: data.sdp
      }));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal(roomId, role, {
        type: 'answer',
        sdp: pc.localDescription.sdp
      });
    }
    else if (data.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription({
        type: 'answer', sdp: data.sdp
      }));
    }
    else if (data.type === 'ice') {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  } catch (e) {
    console.error('[SIGNAL]', e);
  }
}

// ============================================
// SENDER
// ============================================
async function startAsSender() {
  role = 'sender';
  roomId = await createRoom();

  const url = new URL(location.href);
  url.searchParams.set('r', roomId);
  linkInput.value = url.toString();

  renderWaitFilesList();
  showScreen('wait');

  createPeerConnection();

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIce(pc);

  await sendSignal(roomId, 'sender', {
    type: 'offer',
    sdp: pc.localDescription.sdp
  });

  listenForSignal(roomId, 'sender', handleSignal);
}

function waitForIce(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(resolve, 3000);
  });
}

// ============================================
// RECEIVER
// ============================================
async function startAsReceiver(roomIdFromUrl) {
  role = 'receiver';
  roomId = roomIdFromUrl;

  const ok = await joinRoom(roomId);
  if (!ok) {
    showError('Комната не найдена или ссылка устарела.');
    return;
  }

  showScreen('receive');
  createPeerConnection();

  listenForSignal(roomId, 'receiver', async (data) => {
    if (data.type === 'offer') await handleSignal(data);
    else if (data.type === 'ice') await handleSignal(data);
  });
}

// ============================================
// UI: выбор файлов
// ============================================
dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer.files.length) {
    addFiles([...e.dataTransfer.files]);
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) {
    addFiles([...fileInput.files]);
    fileInput.value = '';
  }
});

function addFiles(files) {
  selectedFiles = selectedFiles.concat(files);
  renderFilesList();
}

// ============================================
// UI: создать ссылку
// ============================================
createLinkBtn.addEventListener('click', async () => {
  if (selectedFiles.length === 0) return;
  createLinkBtn.disabled = true;
  createLinkBtn.textContent = 'Создание...';
  try {
    await startAsSender();
  } catch (e) {
    console.error(e);
    showError('Не удалось создать комнату: ' + e.message);
  }
});

// ============================================
// UI: копировать ссылку
// ============================================
copyLinkBtn.addEventListener('click', async () => {
  linkInput.select();
  try {
    await navigator.clipboard.writeText(linkInput.value);
    copyLinkBtn.textContent = '✓';
    setTimeout(() => copyLinkBtn.textContent = 'Копировать', 1500);
  } catch {
    document.execCommand('copy');
  }
});

// ============================================
// UI: отмена
// ============================================
cancelSendBtn.addEventListener('click', async () => {
  if (roomId) await cleanupRoom(roomId);
  if (pc) pc.close();
  location.href = location.pathname;
});

cancelRecvBtn.addEventListener('click', async () => {
  if (roomId) await cleanupRoom(roomId);
  if (pc) pc.close();
  location.href = location.pathname;
});

errorBackBtn.addEventListener('click', () => {
  location.href = location.pathname;
});

// ============================================
// СТАРТ
// ============================================
(async function init() {
  const urlRoom = getRoomFromUrl();
  if (urlRoom) {
    await startAsReceiver(urlRoom);
  } else {
    showScreen('send');
  }
})();

window.addEventListener('beforeunload', () => {
  if (pc) pc.close();
});