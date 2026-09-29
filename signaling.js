// ============================================
// signaling.js — сигналинг через Firestore
// Структура:
//   rooms/{roomId}            — документ комнаты
//   rooms/{roomId}/signals/*  — SDP/ICE-сигналы
// ============================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot, deleteDoc,
  collection, addDoc, getDocs
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
// Комнаты
// ============================================
export function getRoomFromUrl() {
  return new URLSearchParams(location.search).get('r');
}

export async function createRoom() {
  const roomId = Math.random().toString(36).slice(2, 10);
  await setDoc(doc(db, 'rooms', roomId), {
    createdAt: Date.now(),
    sender: true,
    receiver: false
  });
  return roomId;
}

export async function joinRoom(roomId) {
  const snap = await getDoc(doc(db, 'rooms', roomId));
  if (!snap.exists()) return false;
  const data = snap.data();
  // TTL: 1 час
  if (Date.now() - data.createdAt > 60 * 60 * 1000) return false;
  await setDoc(doc(db, 'rooms', roomId), { receiver: true }, { merge: true });
  return true;
}

/**
 * Полная очистка комнаты:
 * 1. Удаляем все документы из подколлекции signals
 * 2. Удаляем сам документ комнаты
 */
export async function cleanupRoom(roomId) {
  if (!roomId) return;
  try {
    const signalsRef = collection(db, 'rooms', roomId, 'signals');
    const snap = await getDocs(signalsRef);
    const deletes = [];
    snap.forEach(d => deletes.push(deleteDoc(d.ref)));
    await Promise.all(deletes);

    await deleteDoc(doc(db, 'rooms', roomId));
    console.log('[CLEANUP] room + signals deleted:', roomId);
  } catch (e) {
    console.warn('[CLEANUP]', e);
  }
}

// ============================================
// Сигналы
// ============================================
export async function sendSignal(roomId, fromRole, data) {
  await addDoc(collection(db, 'rooms', roomId, 'signals'), {
    from: fromRole,
    ts: Date.now(),
    ...data
  });
}

/**
 * Слушает сигналы, адресованные myRole.
 * НЕ удаляет сигналы сразу — они удаляются только в cleanupRoom().
 * Это защищает от гонок: если вторая сторона ещё не подписалась, она увидит все сигналы при подписке.
 */
export function listenForSignal(roomId, myRole, handler) {
  const ref = collection(db, 'rooms', roomId, 'signals');
  const processed = new Set();

  const unsub = onSnapshot(ref,
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type !== 'added') return;
        const data = change.doc.data();
        const id = change.doc.id;

        if (data.from === myRole) return;
        if (processed.has(id)) return;
        processed.add(id);

        handler(data);
      });
    },
    (err) => {
      console.error('[SIGNAL LISTEN ERROR]', err);
    }
  );

  return unsub;
}