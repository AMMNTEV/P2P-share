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

const STUN_LIST = [
  "23.21.150.121:3478",
  "iphone-stun.strato-iphone.de:3478",
  "numb.viagenie.ca:3478",
  "s1.taraba.net:3478",
  "s2.taraba.net:3478",
  "stun.12connect.com:3478",
  "stun.12voip.com:3478",
  "stun.1und1.de:3478",
  "stun.2talk.co.nz:3478",
  "stun.2talk.com:3478",
  "stun.3clogic.com:3478",
  "stun.3cx.com:3478",
  "stun.a-mm.tv:3478",
  "stun.aa.net.uk:3478",
  "stun.acrobits.cz:3478",
  "stun.actionvoip.com:3478",
  "stun.advfn.com:3478",
  "stun.aeta-audio.com:3478",
  "stun.aeta.com:3478",
  "stun.alltel.com.au:3478",
  "stun.altar.com.pl:3478",
  "stun.annatel.net:3478",
  "stun.antisip.com:3478",
  "stun.arbuz.ru:3478",
  "stun.avigora.com:3478",
  "stun.avigora.fr:3478",
  "stun.awa-shima.com:3478",
  "stun.awt.be:3478",
  "stun.b2b2c.ca:3478",
  "stun.bahnhof.net:3478",
  "stun.barracuda.com:3478",
  "stun.bluesip.net:3478",
  "stun.bmwgs.cz:3478",
  "stun.botonakis.com:3478",
  "stun.budgetphone.nl:3478",
  "stun.budgetsip.com:3478",
  "stun.cablenet-as.net:3478",
  "stun.callromania.ro:3478",
  "stun.callwithus.com:3478",
  "stun.cbsys.net:3478",
  "stun.chathelp.ru:3478",
  "stun.cheapvoip.com:3478",
  "stun.ciktel.com:3478",
  "stun.cloopen.com:3478",
  "stun.colouredlines.com.au:3478",
  "stun.comfi.com:3478",
  "stun.commpeak.com:3478",
  "stun.comtube.com:3478",
  "stun.comtube.ru:3478",
  "stun.cope.es:3478",
  "stun.counterpath.com:3478",
  "stun.counterpath.net:3478",
  "stun.cryptonit.net:3478",
  "stun.darioflaccovio.it:3478",
  "stun.datamanagement.it:3478",
  "stun.dcalling.de:3478",
  "stun.decanet.fr:3478",
  "stun.demos.ru:3478",
  "stun.develz.org:3478",
  "stun.dingaling.ca:3478",
  "stun.doublerobotics.com:3478",
  "stun.drogon.net:3478",
  "stun.duocom.es:3478",
  "stun.dus.net:3478",
  "stun.e-fon.ch:3478",
  "stun.easybell.de:3478",
  "stun.easycall.pl:3478",
  "stun.easyvoip.com:3478",
  "stun.efficace-factory.com:3478",
  "stun.einsundeins.com:3478",
  "stun.einsundeins.de:3478",
  "stun.ekiga.net:3478",
  "stun.epygi.com:3478",
  "stun.etoilediese.fr:3478",
  "stun.eyeball.com:3478",
  "stun.faktortel.com.au:3478",
  "stun.freecall.com:3478",
  "stun.freeswitch.org:3478",
  "stun.freevoipdeal.com:3478",
  "stun.fuzemeeting.com:3478",
  "stun.gmx.de:3478",
  "stun.gmx.net:3478",
  "stun.gradwell.com:3478",
  "stun.halonet.pl:3478",
  "stun.hellonanu.com:3478",
  "stun.hoiio.com:3478",
  "stun.hosteurope.de:3478",
  "stun.ideasip.com:3478",
  "stun.imesh.com:3478",
  "stun.infra.net:3478",
  "stun.internetcalls.com:3478",
  "stun.intervoip.com:3478",
  "stun.ipcomms.net:3478",
  "stun.ipfire.org:3478",
  "stun.ippi.fr:3478",
  "stun.ipshka.com:3478",
  "stun.iptel.org:3478",
  "stun.irian.at:3478",
  "stun.it1.hr:3478",
  "stun.ivao.aero:3478",
  "stun.jappix.com:3478",
  "stun.jumblo.com:3478",
  "stun.justvoip.com:3478",
  "stun.kanet.ru:3478",
  "stun.kiwilink.co.nz:3478",
  "stun.kundenserver.de:3478",
  "stun.l.google.com:19302",
  "stun.linea7.net:3478",
  "stun.linphone.org:3478",
  "stun.liveo.fr:3478",
  "stun.lowratevoip.com:3478",
  "stun.lugosoft.com:3478",
  "stun.lundimatin.fr:3478",
  "stun.magnet.ie:3478",
  "stun.manle.com:3478",
  "stun.mgn.ru:3478",
  "stun.mit.de:3478",
  "stun.mitake.com.tw:3478",
  "stun.miwifi.com:3478",
  "stun.modulus.gr:3478",
  "stun.mozcom.com:3478",
  "stun.myvoiptraffic.com:3478",
  "stun.mywatson.it:3478",
  "stun.nas.net:3478",
  "stun.neotel.co.za:3478",
  "stun.netappel.com:3478",
  "stun.netappel.fr:3478",
  "stun.netgsm.com.tr:3478",
  "stun.nfon.net:3478",
  "stun.noblogs.org:3478",
  "stun.noc.ams-ix.net:3478",
  "stun.node4.co.uk:3478",
  "stun.nonoh.net:3478",
  "stun.nottingham.ac.uk:3478",
  "stun.nova.is:3478",
  "stun.nventure.com:3478",
  "stun.on.net.mk:3478",
  "stun.ooma.com:3478",
  "stun.ooonet.ru:3478",
  "stun.oriontelekom.rs:3478",
  "stun.outland-net.de:3478",
  "stun.ozekiphone.com:3478",
  "stun.patlive.com:3478",
  "stun.personal-voip.de:3478",
  "stun.petcube.com:3478",
  "stun.phone.com:3478",
  "stun.phoneserve.com:3478",
  "stun.pjsip.org:3478",
  "stun.poivy.com:3478",
  "stun.powerpbx.org:3478",
  "stun.powervoip.com:3478",
  "stun.ppdi.com:3478",
  "stun.prizee.com:3478",
  "stun.qq.com:3478",
  "stun.qvod.com:3478",
  "stun.rackco.com:3478",
  "stun.rapidnet.de:3478",
  "stun.rb-net.com:3478",
  "stun.refint.net:3478",
  "stun.remote-learner.net:3478",
  "stun.rixtelecom.se:3478",
  "stun.rockenstein.de:3478",
  "stun.rolmail.net:3478",
  "stun.rounds.com:3478",
  "stun.rynga.com:3478",
  "stun.samsungsmartcam.com:3478",
  "stun.schlund.de:3478",
  "stun.services.mozilla.com:3478",
  "stun.sigmavoip.com:3478",
  "stun.sip.us:3478",
  "stun.sipdiscount.com:3478",
  "stun.siplogin.de:3478",
  "stun.sipnet.net:3478",
  "stun.sipnet.ru:3478",
  "stun.siportal.it:3478",
  "stun.sippeer.dk:3478",
  "stun.siptraffic.com:3478",
  "stun.skylink.ru:3478",
  "stun.sma.de:3478",
  "stun.smartvoip.com:3478",
  "stun.smsdiscount.com:3478",
  "stun.snafu.de:3478",
  "stun.softjoys.com:3478",
  "stun.solcon.nl:3478",
  "stun.solnet.ch:3478",
  "stun.sonetel.com:3478",
  "stun.sonetel.net:3478",
  "stun.sovtest.ru:3478",
  "stun.speedy.com.ar:3478",
  "stun.spokn.com:3478",
  "stun.srce.hr:3478",
  "stun.ssl7.net:3478",
  "stun.stunprotocol.org:3478",
  "stun.symform.com:3478",
  "stun.symplicity.com:3478",
  "stun.sysadminman.net:3478",
  "stun.t-online.de:3478",
  "stun.tagan.ru:3478",
  "stun.tatneft.ru:3478",
  "stun.teachercreated.com:3478",
  "stun.tel.lu:3478",
  "stun.telbo.com:3478",
  "stun.telefacil.com:3478",
  "stun.tis-dialog.ru:3478",
  "stun.tng.de:3478",
  "stun.twt.it:3478",
  "stun.u-blox.com:3478",
  "stun.ucallweconn.net:3478",
  "stun.ucsb.edu:3478",
  "stun.ucw.cz:3478",
  "stun.uls.co.za:3478",
  "stun.unseen.is:3478",
  "stun.usfamily.net:3478",
  "stun.veoh.com:3478",
  "stun.vidyo.com:3478",
  "stun.vipgroup.net:3478",
  "stun.virtual-call.com:3478",
  "stun.viva.gr:3478",
  "stun.vivox.com:3478",
  "stun.vline.com:3478",
  "stun.vo.lu:3478",
  "stun.vodafone.ro:3478",
  "stun.voicetrading.com:3478",
  "stun.voip.aebc.com:3478",
  "stun.voip.blackberry.com:3478",
  "stun.voip.eutelia.it:3478",
  "stun.voiparound.com:3478",
  "stun.voipblast.com:3478",
  "stun.voipbuster.com:3478",
  "stun.voipbusterpro.com:3478",
  "stun.voipcheap.co.uk:3478",
  "stun.voipcheap.com:3478",
  "stun.voipfibre.com:3478",
  "stun.voipgain.com:3478",
  "stun.voipgate.com:3478",
  "stun.voipinfocenter.com:3478",
  "stun.voipplanet.nl:3478",
  "stun.voippro.com:3478",
  "stun.voipraider.com:3478",
  "stun.voipstunt.com:3478",
  "stun.voipwise.com:3478",
  "stun.voipzoom.com:3478",
  "stun.vopium.com:3478",
  "stun.voxgratia.org:3478",
  "stun.voxox.com:3478",
  "stun.voys.nl:3478",
  "stun.voztele.com:3478",
  "stun.vyke.com:3478",
  "stun.webcalldirect.com:3478",
  "stun.whoi.edu:3478",
  "stun.wifirst.net:3478",
  "stun.wwdl.net:3478",
  "stun.xs4all.nl:3478",
  "stun.xtratelecom.es:3478",
  "stun.yesss.at:3478",
  "stun.zadarma.com:3478",
  "stun.zadv.com:3478",
  "stun.zoiper.com:3478",
  "stun1.faktortel.com.au:3478",
  "stun1.l.google.com:19302",
  "stun1.voiceeclipse.net:3478",
  "stun2.l.google.com:19302",
  "stun3.l.google.com:19302",
  "stun4.l.google.com:19302",
  "stunserver.org:3478",
  "124.64.206.224:8800",
  "stun.nextcloud.com:443",
  "relay.webwormhole.io",
  "stun.flashdance.cx:3478"
];

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.l.google.com:5349" },
    { urls: "stun:stun1.l.google.com:3478" },
    { urls: "stun:stun1.l.google.com:5349" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:5349" },
    { urls: "stun:stun3.l.google.com:3478" },
    { urls: "stun:stun3.l.google.com:5349" },
    { urls: "stun:stun4.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:5349" },
    { urls: STUN_LIST.map(addr => addr.startsWith('stun:') ? addr : `stun:${addr}`) }
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