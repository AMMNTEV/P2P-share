// ============================================
// main.js — P2P передача файлов через WebRTC
// ============================================
import {
  createRoom, joinRoom, listenForSignal,
  sendSignal, cleanupRoom, getRoomFromUrl
} from './signaling.js';

const CHUNK_SIZE = 16 * 1024;       // 16 KB — безопасный размер для DataChannel
const BUFFER_THRESHOLD = 1024 * 1024; // 1 MB — порог для backpressure
const BUFFER_LOW = 256 * 1024;       // 256 KB — до этого ждём

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// --- Состояние ---
let pc = null;
let dataChannel = null;
let selectedFile = null;
let roomId = null;
let role = null; // 'sender' | 'receiver'
let receivedChunks = [];
let receivedBytes = 0;
let fileMeta = null;

// --- DOM ---
const screens = {
  send:    document.getElementById('screen-send'),
  wait:    document.getElementById('screen-wait'),
  receive: document.getElementById('screen-receive'),
  error:   document.getElementById('screen-error')
};

const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const createLinkBtn = document.getElementById('createLinkBtn');

const linkInput = document.getElementById('linkInput');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const waitFileName = document.getElementById('waitFileName');
const waitFileSize = document.getElementById('waitFileSize');
const waitStatus = document.getElementById('waitStatus');
const sendProgress = document.getElementById('sendProgress');
const sendProgressFill = document.getElementById('sendProgressFill');
const sendProgressText = document.getElementById('sendProgressText');
const cancelSendBtn = document.getElementById('cancelSendBtn');

const recvSubtitle = document.getElementById('recvSubtitle');
const recvStatus = document.getElementById('recvStatus');
const recvFileInfo = document.getElementById('recvFileInfo');
const recvFileName = document.getElementById('recvFileName');
const recvFileSize = document.getElementById('recvFileSize');
const recvProgress = document.getElementById('recvProgress');
const recvProgressFill = document.getElementById('recvProgressFill');
const recvProgressText = document.getElementById('recvProgressText');
const downloadBtn = document.getElementById('downloadBtn');
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

// ============================================
// WebRTC: создание peer connection
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

  // Для отправителя: создаём DataChannel
  if (role === 'sender') {
    dataChannel = pc.createDataChannel('file', {
      ordered: true
    });
    setupDataChannel();
  }

  // Для получателя: ждём DataChannel
  if (role === 'receiver') {
    pc.ondatachannel = (event) => {
      dataChannel = event.channel;
      setupDataChannel();
    };
  }

  return pc;
}

// ============================================
// DataChannel: обработка
// ============================================
function setupDataChannel() {
  dataChannel.binaryType = 'arraybuffer';

  dataChannel.onopen = () => {
    console.log('[DC] open');
    if (role === 'sender') {
      waitStatus.textContent = 'Соединение установлено, отправка...';
      waitStatus.className = 'status ok';
      sendProgress.style.display = 'flex';
      sendFile();
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

  // Получатель принимает данные
  if (role === 'receiver') {
    dataChannel.onmessage = async (event) => {
      const data = event.data;

      // Первое сообщение — метаданные (JSON)
      if (typeof data === 'string') {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'meta') {
            fileMeta = msg;
            recvFileName.textContent = msg.name;
            recvFileSize.textContent = formatSize(msg.size);
            recvFileInfo.style.display = 'block';
            recvProgress.style.display = 'flex';
            recvSubtitle.textContent = 'Получение файла...';
            return;
          }
          if (msg.type === 'end') {
            onReceiveComplete();
            return;
          }
        } catch (e) {
          console.warn('Bad meta', e);
        }
        return;
      }

      // Бинарный чанк
      receivedChunks.push(data);
      receivedBytes += data.byteLength;

      if (fileMeta && fileMeta.size > 0) {
        const percent = Math.min(100, Math.round((receivedBytes / fileMeta.size) * 100));
        recvProgressFill.style.width = percent + '%';
        recvProgressText.textContent = percent + '%';
      }
    };
  }
}

// ============================================
// Отправитель: отправка файла
// ============================================
async function sendFile() {
  if (!selectedFile || !dataChannel) return;

  // Отправляем метаданные
  dataChannel.send(JSON.stringify({
    type: 'meta',
    name: selectedFile.name,
    size: selectedFile.size,
    mime: selectedFile.type || 'application/octet-stream'
  }));

  const file = selectedFile;
  let offset = 0;
  let sentBytes = 0;

  while (offset < file.size) {
    // Backpressure: ждём, пока буфер опустеет
    if (dataChannel.bufferedAmount > BUFFER_THRESHOLD) {
      await new Promise(resolve => {
        const check = () => {
          if (dataChannel.bufferedAmount < BUFFER_LOW) {
            resolve();
          } else {
            setTimeout(check, 20);
          }
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

  // Сигнал окончания
  dataChannel.send(JSON.stringify({ type: 'end' }));

  waitStatus.textContent = 'Файл отправлен ✓';
  waitStatus.className = 'status ok';
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
// Получатель: собрать и скачать файл
// ============================================
function onReceiveComplete() {
  const blob = new Blob(receivedChunks, {
    type: fileMeta?.mime || 'application/octet-stream'
  });

  const url = URL.createObjectURL(blob);
  downloadBtn.style.display = 'block';
  downloadBtn.onclick = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileMeta?.name || 'file';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // Автоскачивание
  const a = document.createElement('a');
  a.href = url;
  a.download = fileMeta?.name || 'file';
  document.body.appendChild(a);
  a.click();
  a.remove();

  recvStatus.textContent = 'Файл получен ✓';
  recvStatus.className = 'status ok';
  recvProgressFill.style.width = '100%';
  recvProgressText.textContent = '100%';
}

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
// Роль: SENDER
// ============================================
async function startAsSender() {
  role = 'sender';
  roomId = await createRoom();

  const url = new URL(location.href);
  url.searchParams.set('r', roomId);
  linkInput.value = url.toString();

  waitFileName.textContent = selectedFile.name;
  waitFileSize.textContent = formatSize(selectedFile.size);

  showScreen('wait');

  // Создаём PC, оффер
  createPeerConnection();

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Ждём ICE gathering
  await waitForIce(pc);

  // Отправляем оффер через Firestore
  await sendSignal(roomId, 'sender', {
    type: 'offer',
    sdp: pc.localDescription.sdp
  });

  // Слушаем ответ
  listenForSignal(roomId, 'sender', (data) => {
    handleSignal(data);
  });
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
// Роль: RECEIVER
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

  // Создаём PC
  createPeerConnection();

  // Слушаем оффер от отправителя
  listenForSignal(roomId, 'receiver', async (data) => {
    if (data.type === 'offer') {
      await handleSignal(data);
    } else if (data.type === 'ice') {
      await handleSignal(data);
    }
  });
}

// ============================================
// UI: выбор файла
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
    handleFile(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) {
    handleFile(fileInput.files[0]);
  }
});

function handleFile(file) {
  selectedFile = file;
  fileName.textContent = file.name;
  fileSize.textContent = formatSize(file.size);
  fileInfo.style.display = 'block';
  createLinkBtn.disabled = false;
}

// ============================================
// UI: создать ссылку
// ============================================
createLinkBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
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
  if (roomId) await cleanupRoom(roomId, 'sender');
  if (pc) pc.close();
  location.href = location.pathname;
});

cancelRecvBtn.addEventListener('click', async () => {
  if (roomId) await cleanupRoom(roomId, 'receiver');
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

// Уборка при закрытии
window.addEventListener('beforeunload', () => {
  if (pc) pc.close();
});