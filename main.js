// ============================================
// main.js — P2P передача файлов через WebRTC
// Исправленная обработка ICE Буфера + Публичные TURN
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
    // STUN серверы
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    
    // Публичные рабочей конфигурации TURN (OpenRelay)
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10
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

// Очереди для ICE-кандидатов (пока не установлен RemoteDescription)
const pendingIceCandidates = [];

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
// UI
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
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ============================================
// WebRTC Logic
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
    }
  };

  pc.onconnectionstatechange = () => {
    log('PC state:', pc.connectionState);
    if (pc.connectionState === 'failed') {
      waitStatus.textContent = 'Ошибка P2P соединения (NAT/Firewall)';
      waitStatus.className = 'status err';
    } else if (pc.connectionState === 'disconnected') {
      waitStatus.textContent = 'Соединение временно прервано...';
      waitStatus.className = 'status err';
    }
  };

  if (role === 'sender') {
    dataChannel = pc.createDataChannel('file', { ordered: true });
    setupDataChannel();
  } else {
    pc.ondatachannel = (event) => {
      log('Получен DataChannel');
      dataChannel = event.channel;
      setupDataChannel();
    };
  }

  return pc;
}

async function processCandidate(candidate) {
  if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
    pendingIceCandidates.push(candidate);
    return;
  }
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (e) {
    console.warn('[ICE Add Error]', e);
  }
}

async function flushPendingCandidates() {
  while (pendingIceCandidates.length > 0) {
    const candidate = pendingIceCandidates.shift();
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn('[ICE Flush Error]', e);
    }
  }
}

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

  if (role === 'receiver') {
    dataChannel.onmessage = (event) => {
      const data = event.data;

      if (typeof data === 'string') {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }

        if (msg.type === 'meta') {
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

async function sendAllFiles() {
  try {
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      await sendOneFile(file, i);
      markWaitFileDone(i);
    }

    dataChannel.send(JSON.stringify({ type: 'all-done' }));
    waitStatus.textContent = 'Все файлы отправлены ✓';
    waitStatus.className = 'status ok';

    if (roomId) await markSenderDone(roomId);
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

async function onAllReceived() {
  recvStatus.textContent = `Получено файлов: ${receivedFiles.length} ✓`;
  recvStatus.className = 'status ok';
  recvProgressFill.style.width = '100%';
  recvProgressText.textContent = '100%';
  downloadAllBtn.style.display = 'block';

  if (roomId) await markReceiverDone(roomId);
}

downloadAllBtn.addEventListener('click', () => {
  receivedFiles.forEach((f, i) => {
    setTimeout(() => downloadBlob(f.blob, f.name), i * 300);
  });
});

// ============================================
// Обработка сигналов из Firestore
// ============================================
async function handleRoomUpdate(data) {
  if (!pc) return;

  // 1. OFFER (Receiver side)
  if (role === 'receiver' && data.offer && !appliedOffer) {
    appliedOffer = true;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      await flushPendingCandidates();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await setAnswer(roomId, pc.localDescription.sdp);
    } catch (e) {
      console.error('[handle offer]', e);
    }
  }

  // 2. ANSWER (Sender side)
  if (role === 'sender' && data.answer && !appliedAnswer) {
    appliedAnswer = true;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      await flushPendingCandidates();
    } catch (e) {
      console.error('[handle answer]', e);
    }
  }

  // 3. ICE-кандидаты от Sender
  if (role === 'receiver' && Array.isArray(data.iceSender)) {
    for (const candidate of data.iceSender) {
      await processCandidate(candidate);
    }
  }

  // 4. ICE-кандидаты от Receiver
  if (role === 'sender' && Array.isArray(data.iceReceiver)) {
    for (const candidate of data.iceReceiver) {
      await processCandidate(candidate);
    }
  }
}

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
  await setOffer(roomId, pc.localDescription.sdp);

  unsubRoom = listenRoom(roomId, handleRoomUpdate);
}

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

  unsubRoom = listenRoom(roomId, handleRoomUpdate);
}

// ============================================
// UI Events
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