import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { getAuth, GoogleAuthProvider, OAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyAeMFTxWG8P0jwlqZtskJC5Ve141xJmAWw',
  authDomain: 'loyiha-220b0.firebaseapp.com',
  projectId: 'loyiha-220b0',
  storageBucket: 'loyiha-220b0.firebasestorage.app',
  messagingSenderId: '1011779834530',
  appId: '1:1011779834530:web:3b5ae75b2acd92d481fdfb',
  measurementId: 'G-J6B5BLKL9M'
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
export const appleProvider = new OAuthProvider('apple.com');
export const microsoftProvider = new OAuthProvider('microsoft.com');

googleProvider.addScope('email');
googleProvider.addScope('profile');

appleProvider.addScope('email');
appleProvider.addScope('name');

microsoftProvider.addScope('openid');
microsoftProvider.addScope('profile');
microsoftProvider.addScope('email');
microsoftProvider.setCustomParameters({
  prompt: 'select_account'
});

if (typeof window !== 'undefined') {
  void isSupported()
    .then((supported) => {
      if (supported) {
        getAnalytics(app);
      }
    })
    .catch(() => undefined);
}




