// ============================================
// signaling.js — сигналинг через Firestore
// Всё в одном документе: rooms/{roomId}
// ============================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot,
  deleteDoc, updateDoc, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBcblJ4HTJj2fhCFNawU_mhPWjgw_K2obI",
  authDomain: "ptwop-share.firebaseapp.com",
  projectId: "ptwop-share",
  storageBucket: "ptwop-share.firebasestorage.app",
  messagingSenderId: "628017026178",
  appId: "1:628017026178:web:4c6fd622cbea59efbe109b",
  measurementId: "G-4MJDK08JRT"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ============================================
// Утилиты
// ============================================
export function getRoomFromUrl() {
  return new URLSearchParams(location.search).get('r');
}

function roomRef(roomId) {
  return doc(db, 'rooms', roomId);
}

// ============================================
// Создание / вход
// ============================================
export async function createRoom() {
  const roomId = Math.random().toString(36).slice(2, 10);
  await setDoc(roomRef(roomId), {
    createdAt: Date.now(),
    offer: null,
    answer: null,
    iceSender: [],
    iceReceiver: [],
    senderDone: false,
    receiverDone: false
  });
  return roomId;
}

export async function joinRoom(roomId) {
  const snap = await getDoc(roomRef(roomId));
  if (!snap.exists()) return false;
  const data = snap.data();
  if (Date.now() - data.createdAt > 60 * 60 * 1000) return false;
  return true;
}

// ============================================
// Sender пишет
// ============================================
export async function setOffer(roomId, sdp) {
  await updateDoc(roomRef(roomId), {
    offer: { type: 'offer', sdp }
  });
}

export async function addSenderIce(roomId, candidate) {
  await updateDoc(roomRef(roomId), {
    iceSender: arrayUnion(candidate)
  });
}

export async function markSenderDone(roomId) {
  await updateDoc(roomRef(roomId), { senderDone: true });
}

// ============================================
// Receiver пишет
// ============================================
export async function setAnswer(roomId, sdp) {
  await updateDoc(roomRef(roomId), {
    answer: { type: 'answer', sdp }
  });
}

export async function addReceiverIce(roomId, candidate) {
  await updateDoc(roomRef(roomId), {
    iceReceiver: arrayUnion(candidate)
  });
}

export async function markReceiverDone(roomId) {
  await updateDoc(roomRef(roomId), { receiverDone: true });
}

// ============================================
// Слушаем комнату
// ============================================
export function listenRoom(roomId, handler) {
  return onSnapshot(roomRef(roomId),
    (snap) => {
      if (!snap.exists()) return;
      handler(snap.data());
    },
    (err) => console.error('[ROOM LISTEN ERROR]', err)
  );
}

// ============================================
// Очистка
// ============================================
export async function cleanupRoom(roomId) {
  if (!roomId) return;
  try {
    await deleteDoc(roomRef(roomId));
    console.log('[CLEANUP] room deleted:', roomId);
  } catch (e) {
    console.warn('[CLEANUP]', e);
  }
}