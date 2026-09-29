// ============================================
// main.js — P2P передача файлов через WebRTC
// Мультифайл + надёжный сигналинг
// ============================================
import {
  createRoom, joinRoom,
  setOffer, setAnswer,
  addSenderIce, addReceiverIce,
  markSenderDone, markReceiverDone,
  listenRoom, cleanupRoom, getRoomFromUrl
} from './signaling.js';

const CHUNK_SIZE = 16 * 1024;
const BUFFER_THRESHOLD = 1024 * 1024;
const BUFFER_LOW = 256 * 1024;

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    
    // Публичный TURN от Open Relay (без регистрации)
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};

// --- Состояние ---
let pc = null;
let dataChannel = null;
let selectedFiles = [];
let roomId = null;
let role = null;
let unsubRoom = null;

let receivedFiles = [];
let currentRecvFile = null;
let currentRecvChunks = [];
let currentRecvBytes = 0;

let appliedOffer = false;
let appliedAnswer = false;
let appliedSenderIceCount = 0;
let appliedReceiverIceCount = 0;
let remoteDescSet = false;
let pendingIceCandidates = [];

let sendingStarted = false;

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
function log(...args) {
  console.log('[P2P]', ...args);
}

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
  log('ERROR:', text);
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
  receivedFiles.forEach((f) => {
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
  log('Создаю RTCPeerConnection');
  pc = new RTCPeerConnection(RTC_CONFIG);

  pc.onicecandidate = async (event) => {
    if (event.candidate && roomId) {
      log('Отправляю ICE-кандидат');
      try {
        if (role === 'sender') {
          await addSenderIce(roomId, event.candidate.toJSON());
        } else {
          await addReceiverIce(roomId, event.candidate.toJSON());
        }
      } catch (e) {
        console.warn('[ICE send]', e);
      }
    } else if (!event.candidate) {
      log('ICE gathering завершён');
    }
  };

  pc.oniceconnectionstatechange = () => {
    log('ICE state:', pc.iceConnectionState);
  };

  pc.onconnectionstatechange = () => {
    log('PC state:', pc.connectionState);
    if (pc.connectionState === 'failed') {
      waitStatus.textContent = 'Соединение не установлено';
      waitStatus.className = 'status err';
    }
    if (pc.connectionState === 'disconnected') {
      waitStatus.textContent = 'Соединение потеряно';
      waitStatus.className = 'status err';
    }
  };

  if (role === 'sender') {
    log('Создаю DataChannel');
    dataChannel = pc.createDataChannel('file', { ordered: true });
    setupDataChannel();
  } else {
    pc.ondatachannel = (event) => {
      log('Получен DataChannel от отправителя');
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
    log('DataChannel открыт');
    if (role === 'sender') {
      waitStatus.textContent = 'Соединение установлено, отправка...';
      waitStatus.className = 'status ok';
      sendProgress.style.display = 'flex';
      if (!sendingStarted) {
        sendingStarted = true;
        sendAllFiles();
      }
    } else {
      recvStatus.textContent = 'Соединение установлено, приём...';
      recvStatus.className = 'status ok';
    }
  };

  dataChannel.onclose = () => log('DataChannel закрыт');
  dataChannel.onerror = (e) => console.error('[DC error]', e);

  if (role === 'receiver') {
    dataChannel.onmessage = (event) => {
      const data = event.data;

      if (typeof data === 'string') {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }

        if (msg.type === 'meta') {
          log('Новый файл:', msg.name, formatSize(msg.size));
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
          if (currentRecvFile) {
            log('Файл завершён:', currentRecvFile.name);
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
          log('Все файлы получены');
          onAllReceived();
          return;
        }
        return;
      }

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
// Отправитель: отправка файлов по порядку
// ============================================
async function sendAllFiles() {
  try {
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      log(`Отправляю файл ${i + 1}/${selectedFiles.length}:`, file.name);
      await sendOneFile(file, i);
      markWaitFileDone(i);
    }

    log('Все файлы отправлены, шлю all-done');
    dataChannel.send(JSON.stringify({ type: 'all-done' }));
    waitStatus.textContent = 'Все файлы отправлены ✓';
    waitStatus.className = 'status ok';

    if (roomId) await markSenderDone(roomId);
    scheduleCleanup();
  } catch (e) {
    console.error('[SEND]', e);
    waitStatus.textContent = 'Ошибка отправки';
    waitStatus.className = 'status err';
  }
}

async function sendOneFile(file, index) {
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

  if (roomId) await markReceiverDone(roomId);
  scheduleCleanup();
}

downloadAllBtn.addEventListener('click', () => {
  receivedFiles.forEach((f, i) => {
    setTimeout(() => downloadBlob(f.blob, f.name), i * 300);
  });
});

// ============================================
// Очистка: отложенная, через 10 сек
// ============================================
let cleanupScheduled = false;
function scheduleCleanup() {
  if (cleanupScheduled) return;
  cleanupScheduled = true;
  setTimeout(async () => {
    if (roomId) {
      log('Очищаю Firestore');
      await cleanupRoom(roomId);
      roomId = null;
    }
  }, 10000);
}

// ============================================
// Обработка изменений комнаты
// ============================================
async function handleRoomUpdate(data) {
  if (!pc) {
    log('PC не создан, игнорирую обновление');
    return;
  }

  // OFFER (только для получателя)
  if (role === 'receiver' && data.offer && !appliedOffer) {
    log('Получен offer');
    appliedOffer = true;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      remoteDescSet = true;
      await flushPendingIce();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      log('Отправляю answer');
      await setAnswer(roomId, pc.localDescription.sdp);
    } catch (e) {
      console.error('[handle offer]', e);
    }
  }

  // ANSWER (только для отправителя)
  if (role === 'sender' && data.answer && !appliedAnswer) {
    log('Получен answer');
    appliedAnswer = true;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      remoteDescSet = true;
      await flushPendingIce();
    } catch (e) {
      console.error('[handle answer]', e);
    }
  }

  // ICE от sender — применяет receiver
  if (role === 'receiver' && Array.isArray(data.iceSender)) {
    const newOnes = data.iceSender.slice(appliedSenderIceCount);
    appliedSenderIceCount = data.iceSender.length;
    for (const c of newOnes) {
      if (!remoteDescSet) pendingIceCandidates.push(c);
      else {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(c));
          log('Применён ICE от sender');
        } catch (e) { console.warn('[ICE add]', e); }
      }
    }
  }

  // ICE от receiver — применяет sender
  if (role === 'sender' && Array.isArray(data.iceReceiver)) {
    const newOnes = data.iceReceiver.slice(appliedReceiverIceCount);
    appliedReceiverIceCount = data.iceReceiver.length;
    for (const c of newOnes) {
      if (!remoteDescSet) pendingIceCandidates.push(c);
      else {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(c));
          log('Применён ICE от receiver');
        } catch (e) { console.warn('[ICE add]', e); }
      }
    }
  }
}

async function flushPendingIce() {
  if (pendingIceCandidates.length === 0) return;
  log('Применяю отложенные ICE:', pendingIceCandidates.length);
  const queue = pendingIceCandidates;
  pendingIceCandidates = [];
  for (const c of queue) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(c));
    } catch (e) {
      console.warn('[ICE add flushed]', e);
    }
  }
}

// ============================================
// SENDER
// ============================================
async function startAsSender() {
  role = 'sender';
  log('=== Режим отправителя ===');

  roomId = await createRoom();
  log('Комната создана:', roomId);

  const url = new URL(location.href);
  url.searchParams.set('r', roomId);
  linkInput.value = url.toString();

  renderWaitFilesList();
  showScreen('wait');

  unsubRoom = listenRoom(roomId, handleRoomUpdate);
  log('Подписка на комнату');

  createPeerConnection();

  log('Создаю offer');
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  log('Отправляю offer');
  await setOffer(roomId, pc.localDescription.sdp);

  log('Жду answer...');
}

// ============================================
// RECEIVER
// ============================================
async function startAsReceiver(roomIdFromUrl) {
  role = 'receiver';
  roomId = roomIdFromUrl;
  log('=== Режим получателя, комната:', roomId, '===');

  const ok = await joinRoom(roomId);
  if (!ok) {
    showError('Комната не найдена или ссылка устарела.');
    return;
  }

  showScreen('receive');
  log('Жду offer от отправителя...');

  createPeerConnection();

  unsubRoom = listenRoom(roomId, handleRoomUpdate);
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
// UI: кнопки
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

cancelSendBtn.addEventListener('click', async () => {
  if (unsubRoom) unsubRoom();
  if (roomId) await cleanupRoom(roomId);
  if (pc) pc.close();
  location.href = location.pathname;
});

cancelRecvBtn.addEventListener('click', async () => {
  if (unsubRoom) unsubRoom();
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
  if (unsubRoom) unsubRoom();
  if (pc) pc.close();
});