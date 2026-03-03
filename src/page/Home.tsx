import { useState, useEffect, useRef, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { Star, MapPin, Phone, Mail, Menu, X, Eye, EyeOff, ArrowRight, Check, Plus, Trash2, LogOut, Users, Car as CarIcon, Send, MessageCircle, AlertCircle, Search, Sun, Moon, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithRedirect,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, runTransaction, setDoc } from 'firebase/firestore';
import { appleProvider, auth, db, googleProvider, microsoftProvider } from '../firebase';
import brandLogo from '../assets/image.png';

type Page = 'login' | 'home' | 'carpark' | 'cardetail' | 'about' | 'contacts' | 'admin';
type UserRole = 'admin' | 'user' | '';
type MessageSender = 'user' | 'admin';
type ThemeMode = 'dark' | 'light';
type SocialProvider = 'google' | 'apple' | 'microsoft';
const AUTH_STORAGE_KEY = 'dlrent_auth';
const AUTH_CHANGE_EVENT = 'dlrent-auth-change';
const THEME_STORAGE_KEY = 'dlrent_theme';
const ADMIN_EMAIL = 'admin987@gmail.com';
const API_URL = '';
const ENABLE_GOOGLE_AUTH = import.meta.env.VITE_ENABLE_GOOGLE_AUTH !== 'false';
const ENABLE_APPLE_AUTH = import.meta.env.VITE_ENABLE_APPLE_AUTH !== 'false';
const ENABLE_MICROSOFT_AUTH = import.meta.env.VITE_ENABLE_MICROSOFT_AUTH !== 'false';
const MIN_CAR_IMAGES = 5;
const MAX_CAR_IMAGES = 10;
const BASE_URL_INPUT_COUNT = 5;

const formatDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const getBookingReturnTime = (booking: Pick<Booking, 'returnTime'>) =>
  typeof booking.returnTime === 'string' && booking.returnTime.trim() ? booking.returnTime : '23:59';

const getBookingReturnAtMs = (booking: Pick<Booking, 'returnDate' | 'returnTime'>) => {
  const returnAt = new Date(`${booking.returnDate}T${getBookingReturnTime(booking)}:00`);
  return Number.isFinite(returnAt.getTime()) ? returnAt.getTime() : Number.MAX_SAFE_INTEGER;
};

const sanitizePhoneInput = (raw: string) => {
  const cleaned = raw.replace(/[^\d+]/g, '');
  const withoutExtraPluses = cleaned.replace(/\+/g, '');
  const withLeadingPlus = cleaned.startsWith('+') ? `+${withoutExtraPluses}` : withoutExtraPluses;
  return withLeadingPlus.slice(0, 13);
};

const isValidUzbekPhone = (raw: string) => /^\+998\d{9}$/.test(sanitizePhoneInput(raw));
const isMobileAuthEnvironment = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isMobileUa = /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(ua);
  const isSmallViewport = window.matchMedia('(max-width: 1024px)').matches;
  return isMobileUa || isSmallViewport;
};

// ==================== INTERFACES ====================

interface StoredAuth {
  userName: string;
  userRole: Exclude<UserRole, ''>;
}

interface Car {
  id: number;
  name: string;
  price: string;
  features: string[];
  image: string;
  imageGallery?: string[];
  rating: number;
  quantity: number;
}

interface BookingInput {
  carId: number;
  carName: string;
  phoneNumber?: string;
  pickupDate: string;
  returnDate: string;
  returnTime?: string;
  timestamp: string;
}

interface Booking extends BookingInput {
  id: number;
  status: 'active' | 'completed';
  userName: string;
}

interface ChatMessage {
  id: number;
  bookingId: number;
  text: string;
  sender: MessageSender;
  time: string;
  read: boolean;
}

interface NewCarInput {
  name: string;
  price: string;
  features: string[];
  image: string;
  imageGallery: string[];
  rating: number;
  quantity: number;
}

type NavigateFn = (page: Page, carId?: number | null) => void;
type SendMessageFn = (bookingId: number, messageText: string, sender?: MessageSender) => Promise<boolean>;

interface LoginProps {
  onNavigate: NavigateFn;
  onLoginSuccess: (email: string, role: Exclude<UserRole, ''>) => void;
  onEmailAuth: (email: string, password: string) => Promise<{ ok: boolean; message?: string }>;
  onSocialAuth: (provider: SocialProvider) => Promise<{ ok: boolean; message?: string }>;
}

interface ChatModalProps {
  booking: Booking;
  onClose: () => void;
  onSendMessage: SendMessageFn;
  messages: ChatMessage[];
}

interface HomeProps {
  onNavigate: NavigateFn;
}

interface CarParkProps {
  onNavigate: NavigateFn;
  cars: Car[];
}

interface CarDetailProps {
  carId: number;
  onNavigate: NavigateFn;
  allCars: Car[];
  onBookCar: (booking: BookingInput) => Promise<boolean>;
}

interface AdminPanelProps {
  cars: Car[];
  bookings: Booking[];
  onAddCar: (newCar: NewCarInput) => Promise<boolean>;
  onDeleteCar: (carId: number) => void;
  messages: ChatMessage[];
  onSendMessage: SendMessageFn;
  onMarkOneUnreadAsRead: (bookingId: number) => Promise<void>;
}

interface NavigationProps {
  currentPage: Page;
  onNavigate: NavigateFn;
  userName: string;
  userRole: UserRole;
  onLogout: () => void;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
}


interface ApiJsonResponse<T = unknown> {
  ok: boolean;
  status: number;
  json: () => Promise<T>;
}

interface ApiErrorPayload {
  message: string;
  code?: string;
}

const createApiJsonResponse = <T,>(data: T, status = 200): ApiJsonResponse<T> => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data
});

const parseApiPath = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url.startsWith('/') ? url : `/${url}`;
  }
};

const createNumericId = () => Date.now() + Math.floor(Math.random() * 100000);

const getApiErrorMessage = async (response: ApiJsonResponse, fallback: string) => {
  try {
    const data = (await response.json()) as Partial<ApiErrorPayload>;
    if (typeof data.code === 'string' && data.code.includes('permission-denied')) {
      return 'Firebase ruxsati yoqilgan emas. Firestore Rules va login holatini tekshiring.';
    }
    if (typeof data.message === 'string' && data.message.trim()) {
      return data.message;
    }
  } catch {
    // ignore payload parse errors
  }
  return fallback;
};

const apiFetch = async (url: string, init?: RequestInit): Promise<ApiJsonResponse> => {
  const method = (init?.method ?? 'GET').toUpperCase();
  const path = parseApiPath(url);
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;

  try {
    if (path === '/cars' && method === 'GET') {
      const snapshot = await getDocs(collection(db, 'car'));
      const carsData = snapshot.docs.map((entry) => entry.data());
      return createApiJsonResponse(carsData);
    }

    if (path === '/bookings' && method === 'GET') {
      const snapshot = await getDocs(collection(db, 'bookings'));
      const bookingsData = snapshot.docs.map((entry) => entry.data());
      return createApiJsonResponse(bookingsData);
    }

    if (path === '/messages' && method === 'GET') {
      const snapshot = await getDocs(collection(db, 'messages'));
      const messagesData = snapshot.docs.map((entry) => entry.data());
      return createApiJsonResponse(messagesData);
    }

    if (path === '/cars' && method === 'POST') {
      const id = createNumericId();
      const newCar = { id, ...(body as Omit<Car, 'id'>) };
      await setDoc(doc(db, 'car', String(id)), newCar);
      return createApiJsonResponse(newCar, 201);
    }

    if (path === '/bookings' && method === 'POST') {
      const bookingInput = body as Omit<Booking, 'id'>;
      const bookingId = createNumericId();
      const createdBooking: Booking = {
        id: bookingId,
        ...(bookingInput as BookingInput),
        status: bookingInput.status === 'completed' ? 'completed' : 'active',
        userName: bookingInput.userName
      };

      await runTransaction(db, async (transaction) => {
        const carRef = doc(db, 'car', String(bookingInput.carId));
        const carSnap = await transaction.get(carRef);
        if (!carSnap.exists()) {
          throw new Error('Car not found');
        }

        const currentCar = carSnap.data() as Partial<Car>;
        const currentQty = Number.isFinite(currentCar.quantity) ? Number(currentCar.quantity) : 0;
        if (currentQty <= 0) {
          throw new Error('Car is not available');
        }

        transaction.update(carRef, { quantity: currentQty - 1 });
        transaction.set(doc(db, 'bookings', String(bookingId)), createdBooking);
      });

      return createApiJsonResponse(createdBooking, 201);
    }

    if (path === '/messages' && method === 'POST') {
      const id = createNumericId();
      const newMessage: ChatMessage = {
        id,
        bookingId: Number((body as Partial<ChatMessage>).bookingId),
        text: String((body as Partial<ChatMessage>).text ?? ''),
        sender: (body as Partial<ChatMessage>).sender === 'admin' ? 'admin' : 'user',
        time: new Date().toISOString(),
        read: false
      };
      await setDoc(doc(db, 'messages', String(id)), newMessage);
      return createApiJsonResponse(newMessage, 201);
    }

    if (path.startsWith('/cars/') && method === 'PATCH') {
      const id = Number(path.split('/')[2]);
      const carRef = doc(db, 'car', String(id));
      await setDoc(carRef, body as Partial<Car>, { merge: true });
      const updated = await getDoc(carRef);
      return createApiJsonResponse(updated.data() ?? null);
    }

    if (path.startsWith('/messages/') && method === 'PATCH') {
      const id = Number(path.split('/')[2]);
      const messageRef = doc(db, 'messages', String(id));
      await setDoc(messageRef, body as Partial<ChatMessage>, { merge: true });
      const updated = await getDoc(messageRef);
      return createApiJsonResponse(updated.data() ?? null);
    }

    if (path.startsWith('/bookings/') && method === 'PATCH') {
      const id = Number(path.split('/')[2]);
      const bookingRef = doc(db, 'bookings', String(id));
      let updatedBooking: Booking | null = null;

      await runTransaction(db, async (transaction) => {
        const bookingSnap = await transaction.get(bookingRef);
        if (!bookingSnap.exists()) {
          throw new Error('Booking not found');
        }

        const currentBooking = bookingSnap.data() as Booking;
        const patchData = body as Partial<Booking>;
        const nextBooking = { ...currentBooking, ...patchData };

        if (currentBooking.status !== 'completed' && patchData.status === 'completed') {
          const carRef = doc(db, 'car', String(currentBooking.carId));
          const carSnap = await transaction.get(carRef);
          if (carSnap.exists()) {
            const carData = carSnap.data() as Partial<Car>;
            const currentQty = Number.isFinite(carData.quantity) ? Number(carData.quantity) : 0;
            transaction.update(carRef, { quantity: currentQty + 1 });
          }
        }

        transaction.set(bookingRef, nextBooking, { merge: true });
        updatedBooking = nextBooking;
      });

      return createApiJsonResponse(updatedBooking);
    }

    if (path.startsWith('/cars/') && method === 'DELETE') {
      const id = Number(path.split('/')[2]);
      await deleteDoc(doc(db, 'car', String(id)));
      return createApiJsonResponse({ success: true });
    }

    return createApiJsonResponse({ message: 'Not found' }, 404);
  } catch (error) {
    console.error('Firestore API adapter error:', error);
    const code =
      typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : '';
    const rawMessage =
      typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : 'Internal error';
    const status = code.includes('permission-denied') ? 403 : 500;
    return createApiJsonResponse({ message: rawMessage, code }, status);
  }
};
const BRAND_LOGO_SRC = brandLogo;

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const BrandLogo = ({ size = 'md', className = '' }: BrandLogoProps) => {
  const [isBroken, setIsBroken] = useState(false);
  const sizeClass =
    size === 'sm' ? 'brand-logo-sm' : size === 'lg' ? 'brand-logo-lg' : 'brand-logo-md';

  return (
    <div
      className={`brand-logo-wrap brand-logo-clickable ${sizeClass} ${className}`.trim()}
      onClick={() => {
        if (!isBroken) {
          window.open(BRAND_LOGO_SRC, '_blank', 'noopener,noreferrer');
        }
      }}
    >
      {!isBroken && (
        <img
          src={BRAND_LOGO_SRC}
          alt="DL Rent logo"
          className="brand-logo-img"
          loading="lazy"
          onError={() => setIsBroken(true)}
        />
      )}
    </div>
  );
};

// ==================== LOGIN COMPONENT ====================

const Login = ({ onNavigate, onLoginSuccess, onEmailAuth, onSocialAuth }: LoginProps) => {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const socialProvidersCount =
    Number(ENABLE_GOOGLE_AUTH) + Number(ENABLE_APPLE_AUTH) + Number(ENABLE_MICROSOFT_AUTH);
  const socialGridClass =
    socialProvidersCount <= 1 ? 'grid-cols-1' : socialProvidersCount === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3';

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    const trimmedEmail = email.trim();
    const result = await onEmailAuth(trimmedEmail, password);
    if (!result.ok) {
      setError(result.message ?? t('login.authFailed'));
      setIsLoading(false);
      return;
    }

    const role: Exclude<UserRole, ''> = trimmedEmail.toLowerCase() === ADMIN_EMAIL ? 'admin' : 'user';
    onLoginSuccess(trimmedEmail, role);
    onNavigate(role === 'admin' ? 'admin' : 'home');
    setIsLoading(false);
  };

  const handleSocialClick = async (provider: SocialProvider) => {
    setError('');
    setIsLoading(true);
    const result = await onSocialAuth(provider);
    if (result.ok) {
      onNavigate('home');
    } else {
      setError(result.message ?? t('login.authFailed'));
    }
    setIsLoading(false);
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-teal-900 flex items-center justify-center p-4 overflow-hidden animate-pageEnter">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-44 -right-40 w-96 h-96 bg-blue-500/25 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-48 -left-40 w-[26rem] h-[26rem] bg-teal-500/25 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.06),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(45,212,191,0.08),transparent_35%)]"></div>
      </div>

      <div className="relative z-10 w-full max-w-lg">
        <div className="text-center mb-8">
          <BrandLogo size="lg" className="mx-auto mb-3" />
          <p className="text-slate-300/90 text-xs sm:text-sm tracking-[0.24em]">PREMIUM CAR RENTAL</p>
        </div>

        <div className="backdrop-blur-xl bg-gradient-to-b from-white/14 to-white/6 border border-white/20 rounded-3xl p-6 sm:p-8 shadow-2xl">
          <h1 className="text-3xl font-bold text-white mb-2">{t('login.welcomeBack')}</h1>
          <p className="text-slate-300 mb-7 text-sm">{t('login.subtitle')}</p>

          {error && (
            <div className="mb-6 p-3.5 bg-red-500/20 border border-red-500/50 rounded-xl text-red-300 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div className="relative">
              <label className="block text-sm font-medium text-slate-200 mb-2">{t('login.email')}</label>
              <div className="relative">
                <input
                  type="text"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="w-full px-5 py-3.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-400/30 focus:bg-white/15 transition backdrop-blur-sm"
                />
                <Mail className="absolute right-4 top-4 w-5 h-5 text-slate-400" />
              </div>
            </div>

            <div className="relative">
              <label className="block text-sm font-medium text-slate-200 mb-2">{t('login.password')}</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="********"
                  className="w-full px-5 py-3.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-400/30 focus:bg-white/15 transition backdrop-blur-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-4 text-slate-400 hover:text-slate-200 transition"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white font-semibold py-3.5 rounded-xl transition transform hover:scale-[1.02] active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg shadow-blue-900/30"
            >
              {isLoading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  {t('login.processing')}
                </>
              ) : (
                <>
                  {t('login.continue')}
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>

          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-white/15"></div>
            <span className="text-xs text-slate-400 uppercase tracking-wider">{t('login.or')}</span>
            <div className="h-px flex-1 bg-white/15"></div>
          </div>

          {socialProvidersCount > 0 && (
            <div className={`grid ${socialGridClass} gap-3`}>
              {ENABLE_GOOGLE_AUTH && (
                <button
                  type="button"
                  onClick={() => handleSocialClick('google')}
                  disabled={isLoading}
                  className="w-full border border-white/30 hover:border-white/50 text-white font-semibold py-3.5 rounded-xl transition hover:bg-white/10 disabled:opacity-60 flex items-center justify-center gap-3"
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
                    <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.2.8 3.9 1.4l2.7-2.6C16.9 3.2 14.7 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12S6.6 21.8 12 21.8c6.9 0 9.6-4.8 9.6-7.3 0-.5-.1-.9-.1-1.3H12z" />
                    <path fill="#34A853" d="M3.3 7.4l3.2 2.3C7.3 7.8 9.5 6 12 6c1.9 0 3.2.8 3.9 1.4l2.7-2.6C16.9 3.2 14.7 2.2 12 2.2 8.2 2.2 4.9 4.3 3.3 7.4z" />
                    <path fill="#FBBC05" d="M12 21.8c2.6 0 4.8-.8 6.4-2.2l-3-2.4c-.8.6-1.9 1-3.4 1-3.9 0-5.2-2.6-5.5-3.9l-3.2 2.5c1.6 3.1 4.9 5 8.7 5z" />
                    <path fill="#4285F4" d="M21.6 14.5c.1-.4.1-.8.1-1.3 0-.4 0-.9-.1-1.3H12v2.6h5.5c-.3 1.5-1.2 2.7-2.4 3.5l3 2.4c1.7-1.6 3.5-4.5 3.5-8z" />
                  </svg>
                  <span>{t('login.google')}</span>
                </button>
              )}

              {ENABLE_APPLE_AUTH && (
                <button
                  type="button"
                  onClick={() => handleSocialClick('apple')}
                  disabled={isLoading}
                  className="w-full border border-white/30 hover:border-white/50 text-white font-semibold py-3.5 rounded-xl transition hover:bg-white/10 disabled:opacity-60 flex items-center justify-center gap-3"
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
                    <path d="M16.7 12.8c0-2 1.6-3 1.7-3.1-1-.5-2.5-.6-3.5-.2-.9.4-1.6 1.2-2.2 1.2-.6 0-1.5-.8-2.5-.8-1.3 0-2.5.8-3.2 2-.9 1.6-.2 4 1.1 5.8.6.9 1.4 1.9 2.4 1.8 1-.1 1.4-.6 2.6-.6 1.2 0 1.6.6 2.6.6 1.1 0 1.8-.9 2.4-1.8.7-1 1-2 1-2.1-.1 0-2.4-.9-2.4-2.8zM14.6 7.1c.5-.6.9-1.5.8-2.3-.8 0-1.7.5-2.2 1.1-.5.6-.9 1.5-.8 2.3.9.1 1.7-.4 2.2-1.1z" />
                  </svg>
                  <span>{t('login.apple')}</span>
                </button>
              )}

              {ENABLE_MICROSOFT_AUTH && (
                <button
                  type="button"
                  onClick={() => handleSocialClick('microsoft')}
                  disabled={isLoading}
                  className="w-full border border-white/30 hover:border-white/50 text-white font-semibold py-3.5 rounded-xl transition hover:bg-white/10 disabled:opacity-60 flex items-center justify-center gap-3"
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
                    <rect x="2" y="2" width="9" height="9" fill="#f25022" />
                    <rect x="13" y="2" width="9" height="9" fill="#7fba00" />
                    <rect x="2" y="13" width="9" height="9" fill="#00a4ef" />
                    <rect x="13" y="13" width="9" height="9" fill="#ffb900" />
                  </svg>
                  <span>{t('login.microsoft')}</span>
                </button>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-4 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm">
            <p className="text-xs text-slate-400 mb-2 font-semibold uppercase tracking-wider">{t('login.userAuth')}</p>
            <p className="text-xs text-slate-300">{t('login.userAuthLine1')}</p>
            <p className="text-xs text-slate-300">{t('login.userAuthLine2')}</p>
          </div>

          <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-2xl backdrop-blur-sm">
            <p className="text-xs text-blue-300 mb-2 font-semibold uppercase tracking-wider">{t('login.adminDemo')}</p>
            <p className="text-xs text-blue-200">{t('login.adminEmail')}: <span className="text-blue-300 font-semibold">{ADMIN_EMAIL}</span></p>
            <p className="text-xs text-blue-200">{t('login.adminPass')}: <span className="text-blue-300 font-semibold">654987</span></p>
          </div>
        </div>
      </div>
    </div>
  );
};

// ==================== CHAT MODAL ====================

const ChatModal = ({ booking, onClose, onSendMessage, messages }: ChatModalProps) => {
  const { t } = useTranslation();
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [onClose]);

  const handleSend = async () => {
    if (!message.trim() || isSending) return;
    setIsSending(true);
    const didSend = await onSendMessage(booking.id, message);
    if (didSend) {
      setMessage('');
    }
    setIsSending(false);
  };

  const bookingMessages = messages.filter((m) => m.bookingId === booking.id) || [];

  return (
    <div
      className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 pt-14 sm:p-6"
      onMouseDown={onClose}
    >
      <div
        className="bg-gradient-to-br from-slate-900 to-slate-950 border border-white/20 rounded-2xl w-full max-w-2xl h-[32rem] sm:h-[34rem] max-h-[86vh] sm:max-h-[90vh] flex flex-col shadow-2xl animate-modalDrop overflow-hidden"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-white/10 p-5 flex items-center justify-between bg-white/5 rounded-t-2xl">
          <div>
            <h2 className="text-xl font-bold text-white">{booking.carName}</h2>
            <p className="text-sm text-gray-400">Booking #{booking.id} | Chat with admin</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition p-1 rounded-lg hover:bg-white/10">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-gradient-to-b from-transparent to-slate-950/40">
          {bookingMessages.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
              <MessageCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>{t('chat.noMessages')}</p>
            </div>
          ) : (
            bookingMessages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl shadow ${msg.sender === 'user'
                  ? 'bg-teal-500/30 border border-teal-500/50 text-teal-100'
                  : 'bg-blue-500/30 border border-blue-500/50 text-blue-100'
                  }`}>
                  <p className="text-xs font-semibold opacity-70 mb-1">{msg.sender === 'user' ? 'You' : 'Admin'}</p>
                  <p className="text-sm leading-relaxed break-words">{msg.text}</p>
                  <p className="text-xs opacity-60 mt-1 text-right">{msg.time}</p>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-white/10 p-4 flex gap-2 bg-white/5 rounded-b-2xl">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            disabled={isSending}
            placeholder={t('chat.typeMessage')}
            className="flex-1 px-4 py-2.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:border-teal-400"
          />
          <button
            onClick={handleSend}
            disabled={isSending || !message.trim()}
            className="px-4 py-2.5 bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white rounded-xl transition flex items-center gap-2 font-semibold"
          >
            <Send className="w-4 h-4" />
            {isSending ? t('chat.sending') : t('chat.send')}
          </button>
        </div>
      </div>
    </div>
  );
};
// CARDETAIL, ADMINPANEL, NAVIGATION, ABOUT VA CONTACTS KOMPONENTLARINI
// app-fixed.tsx ga qo'shish uchun quyidagi kodni ishlatilgan tsx faylingizga qo'shish kerak
// 
// QUYIDAGI JOYGA QO'SHING: Login va ChatModal komponentlaridan keyin
// (CarPark komponenti va handleNavigate dan oldin)

// ==================== CAR DETAIL COMPONENT ====================

const CarDetail = ({ carId, onNavigate, allCars, onBookCar }: CarDetailProps) => {
  const { t } = useTranslation();
  const availableCars = allCars.filter((c) => c.quantity > 0);
  const car = availableCars.find((c) => c.id === carId) || availableCars[0];
  const [pickupDate, setPickupDate] = useState(() => formatDateInput(new Date()));
  const [returnDate, setReturnDate] = useState(() => formatDateInput(addDays(new Date(), 2)));
  const [returnTime, setReturnTime] = useState('13:30');
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isReserveModalOpen, setIsReserveModalOpen] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('+998');
  const [phoneError, setPhoneError] = useState('');
  const todayDate = formatDateInput(new Date());
  const minReturnDate = formatDateInput(addDays(new Date(`${pickupDate}T00:00:00`), 1));

  const handlePickupDateChange = (value: string) => {
    const nextPickup = value < todayDate ? todayDate : value;
    const nextMinReturn = formatDateInput(addDays(new Date(`${nextPickup}T00:00:00`), 1));
    setPickupDate(nextPickup);
    if (returnDate < nextMinReturn) {
      setReturnDate(nextMinReturn);
    }
  };

  const handleReturnDateChange = (value: string) => {
    setReturnDate(value < minReturnDate ? minReturnDate : value);
  };

  if (!car) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950 pt-28 sm:pt-32 pb-16 sm:pb-20 animate-pageEnter">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <AlertCircle className="w-14 h-14 mx-auto text-yellow-400 mb-4" />
          <h1 className="text-3xl font-bold text-white mb-2">{t('detail.noAvailableCar')}</h1>
          <p className="text-gray-400 mb-8">{t('detail.chooseAvailable')}</p>
          <button
            onClick={() => onNavigate('carpark')}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-teal-500 to-blue-500 text-white font-semibold hover:from-teal-600 hover:to-blue-600 transition"
          >
            {t('detail.goToFleet')}
          </button>
        </div>
      </div>
    );
  }

  const carInfoCards: Array<{ icon: ReactNode; label: string; value: string }> = [
    { icon: <Star className="w-6 h-6 text-yellow-400" />, label: 'Admin Rating', value: car.rating.toFixed(1) },
    { icon: <span className="text-2xl font-bold text-teal-300">EUR</span>, label: 'Price / Day', value: car.price },
    { icon: <CarIcon className="w-6 h-6 text-blue-300" />, label: 'Available Units', value: String(car.quantity) },
    { icon: <Check className="w-6 h-6 text-emerald-300" />, label: 'Features Added', value: String(car.features.length) },
  ];

  const galleryImages = (car.imageGallery ?? []).filter((image) => typeof image === 'string' && image.trim().length > 0);
  const carouselImages = galleryImages;
  const safeImageIndex = carouselImages.length > 0 ? currentImageIndex % carouselImages.length : 0;
  const primaryImage = carouselImages[safeImageIndex] ?? null;
  const sideImages = carouselImages.filter((_, idx) => idx !== safeImageIndex);

  const showPrevImage = () => {
    if (carouselImages.length <= 1) return;
    setCurrentImageIndex((prev) => (prev - 1 + carouselImages.length) % carouselImages.length);
  };

  const showNextImage = () => {
    if (carouselImages.length <= 1) return;
    setCurrentImageIndex((prev) => (prev + 1) % carouselImages.length);
  };

  const handleBook = async () => {
    const normalizedPhone = sanitizePhoneInput(phoneNumber);
    if (normalizedPhone.length <= 4) {
      setPhoneError('Telefon raqam kiriting. Masalan: +998901234567');
      return;
    }
    if (!isValidUzbekPhone(normalizedPhone)) {
      setPhoneError('Telefon format noto\'g\'ri. To\'g\'ri format: +998901234567');
      return;
    }

    if (!pickupDate || !returnDate) {
      alert('Please select both pickup and return dates.');
      return;
    }

    if (pickupDate < todayDate) {
      alert('Pick-up date cannot be earlier than today.');
      return;
    }

    if (returnDate < minReturnDate) {
      alert('Minimum rental period is 1 day. Return date must be at least the next day.');
      return;
    }

    if (car) {
      if (car.quantity <= 0) {
        alert('This car is currently out of stock.');
        return;
      }

      const didBook = await onBookCar({
        carId: car.id,
        carName: car.name,
        phoneNumber: normalizedPhone,
        pickupDate,
        returnDate,
        returnTime,
        timestamp: new Date().toLocaleString()
      });
      if (didBook) {
        alert('Car booking created successfully.');
        setIsReserveModalOpen(false);
        setPhoneNumber('+998');
        setPhoneError('');
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950 pt-28 sm:pt-32 pb-16 sm:pb-20 animate-pageEnter">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <button
          onClick={() => onNavigate('carpark')}
          className="mb-8 text-teal-400 hover:text-teal-300 font-semibold flex items-center gap-2 transition"
        >
          {'< '} {t('detail.backToFleet')}
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          <div>
            <div className="relative bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-xl border border-white/20 rounded-3xl p-6 sm:p-12 text-center mb-8">
              <div className="absolute inset-0 bg-gradient-to-br from-teal-500/10 to-blue-500/10 rounded-3xl"></div>
              {primaryImage ? (
                <div className="relative z-10 mb-8">
                  <img
                    src={primaryImage}
                    alt={car.name}
                    className="w-full h-72 object-cover rounded-2xl border border-white/20 cursor-zoom-in"
                    onClick={() => setPreviewImage(primaryImage)}
                    title="Click to enlarge image"
                  />
                  {carouselImages.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={showPrevImage}
                        className="absolute left-3 top-1/2 -translate-y-1/2 p-2 bg-black/40 border border-white/20 rounded-lg text-white hover:bg-black/60 transition"
                        aria-label="Previous image"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <button
                        type="button"
                        onClick={showNextImage}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-black/40 border border-white/20 rounded-lg text-white hover:bg-black/60 transition"
                        aria-label="Next image"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div className="h-72 rounded-2xl border border-white/20 mb-8 flex flex-col items-center justify-center gap-3 text-slate-300">
                  <CarIcon className="w-16 h-16 text-slate-400" />
                  <p className="text-sm">Image URL not found</p>
                </div>
              )}
              <h1 className="text-3xl font-bold text-white flex items-center justify-center gap-2">
                <CarIcon className="w-7 h-7 text-teal-300" />
                {car.name}
              </h1>
            </div>

            {sideImages.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
                {sideImages.map((imageSrc, idx) => (
                  <button
                    key={`${imageSrc.slice(0, 24)}-${idx}`}
                    type="button"
                    onClick={() => {
                      const imageIndex = carouselImages.indexOf(imageSrc);
                      if (imageIndex >= 0) {
                        setCurrentImageIndex(imageIndex);
                      }
                      setPreviewImage(imageSrc);
                    }}
                    className="rounded-xl overflow-hidden border border-white/20 hover:border-teal-500/60 transition"
                    title={`Open photo ${idx + 2}`}
                  >
                    <img
                      src={imageSrc}
                      alt={`${car.name} extra ${idx + 2}`}
                      className="w-full h-24 object-cover"
                    />
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {carInfoCards.map((spec, idx) => (
                <div key={idx} className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl p-4">
                  <div className="mb-2">{spec.icon}</div>
                  <p className="text-xs text-gray-400 mb-1">{spec.label}</p>
                  <p className="text-lg font-bold text-white">{spec.value}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-3 flex items-center gap-2">
                <Check className="w-4 h-4 text-teal-300" />
                Admin Added Features
              </p>
              {car.features.length === 0 ? (
                <p className="text-sm text-gray-300">No features were added by admin for this car.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {car.features.map((feature, idx) => (
                    <span
                      key={`${feature}-${idx}`}
                      className="px-3 py-1 bg-teal-500/20 border border-teal-500/50 rounded-full text-teal-300 text-sm"
                    >
                      {feature}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="sticky top-28 sm:top-32 bg-gradient-to-br from-white/15 to-white/5 backdrop-blur-xl border border-white/30 rounded-3xl p-5 sm:p-8">
              <div className="mb-8">
                <p className="text-gray-400 text-sm mb-2">{t('detail.startingFrom')}</p>
                <p className="text-4xl sm:text-5xl font-bold bg-gradient-to-r from-teal-400 to-blue-400 bg-clip-text text-transparent">
                  {car.price}
                </p>
                <p className="text-gray-400 text-sm">{t('detail.perDayIncluded')}</p>
                <p className="text-teal-300 text-sm mt-2 flex items-center gap-2">
                  <CarIcon className="w-4 h-4" />
                  {t('detail.availableNow')}: {car.quantity}
                </p>
              </div>

              <div className="space-y-4 mb-8">
                <div>
                  <label className="text-sm text-gray-300 font-medium block mb-2">Pick-up Location</label>
                  <select className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white focus:border-teal-400 focus:outline-none transition backdrop-blur-sm">
                    <option className="bg-slate-900">Sofia Office</option>
                    <option className="bg-slate-900">Plovdiv Airport</option>
                    <option className="bg-slate-900">Stara Zagora</option>
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-gray-300 font-medium block mb-2">Pick-up Date</label>
                    <input type="date" min={todayDate} value={pickupDate} onChange={(e) => handlePickupDateChange(e.target.value)} placeholder="Select pick-up date" className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white focus:border-teal-400 focus:outline-none transition backdrop-blur-sm" />
                  </div>
                  <div>
                    <label className="text-sm text-gray-300 font-medium block mb-2">Pick-up Time</label>
                    <input type="time" defaultValue="13:30" placeholder="Select pick-up time" className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white focus:border-teal-400 focus:outline-none transition backdrop-blur-sm" />
                  </div>
                </div>

                <div>
                  <label className="text-sm text-gray-300 font-medium block mb-2">Return Location</label>
                  <select className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white focus:border-teal-400 focus:outline-none transition backdrop-blur-sm">
                    <option className="bg-slate-900">Sofia Office</option>
                    <option className="bg-slate-900">Plovdiv Airport</option>
                    <option className="bg-slate-900">Stara Zagora</option>
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-gray-300 font-medium block mb-2">Return Date</label>
                    <input type="date" min={minReturnDate} value={returnDate} onChange={(e) => handleReturnDateChange(e.target.value)} placeholder="Select return date" className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white focus:border-teal-400 focus:outline-none transition backdrop-blur-sm" />
                  </div>
                  <div>
                    <label className="text-sm text-gray-300 font-medium block mb-2">Return Time</label>
                    <input type="time" value={returnTime} onChange={(e) => setReturnTime(e.target.value || '13:30')} placeholder="Select return time" className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white focus:border-teal-400 focus:outline-none transition backdrop-blur-sm" />
                  </div>
                </div>
              </div>

              <div className="bg-white/5 border border-teal-500/30 rounded-xl p-4 mb-6">
                <div className="flex gap-3">
                  <Check className="w-5 h-5 text-teal-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-white">Full Coverage Included</p>
                    <p className="text-xs text-gray-400 mt-1">Liability, damage, theft & roadside assistance</p>
                  </div>
                </div>
              </div>

              <button
                onClick={() => {
                  if (car.quantity <= 0) return;
                  setPhoneNumber('+998');
                  setPhoneError('');
                  setIsReserveModalOpen(true);
                }}
                disabled={car.quantity <= 0}
                className="w-full py-4 bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white font-bold rounded-xl transition transform hover:scale-105 active:scale-95 hover:shadow-2xl disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {car.quantity <= 0 ? t('detail.outOfStock') : t('detail.reserveNow')}
              </button>

              <p className="text-xs text-gray-500 text-center mt-4">{t('detail.noHiddenFees')}</p>
            </div>
          </div>
        </div>
      </div>

      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm p-4 flex items-center justify-center"
          onClick={() => setPreviewImage(null)}
        >
          <button
            type="button"
            onClick={() => setPreviewImage(null)}
            className="absolute top-6 right-6 p-2 bg-white/10 border border-white/20 rounded-lg text-white hover:bg-white/20 transition"
            aria-label="Close image preview"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={previewImage}
            alt={`${car.name} preview`}
            className="max-h-[90vh] max-w-[95vw] object-contain rounded-2xl border border-white/20 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {isReserveModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-4 flex items-center justify-center"
          onClick={() => setIsReserveModalOpen(false)}
        >
          <div
            className="w-full max-w-md bg-gradient-to-br from-white/10 to-white/5 border border-white/20 rounded-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <CarIcon className="w-5 h-5 text-teal-300" />
                {t('detail.reserveTitle')} {car.name}
              </h3>
              <button
                type="button"
                onClick={() => setIsReserveModalOpen(false)}
                className="p-2 rounded-lg bg-white/10 border border-white/20 text-white hover:bg-white/20 transition"
                aria-label="Close reserve modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-300 mb-4">{t('detail.reserveDesc')}</p>
            <input
              type="tel"
              inputMode="numeric"
              value={phoneNumber}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setPhoneNumber(sanitizePhoneInput(e.target.value));
                if (phoneError) setPhoneError('');
              }}
              placeholder="+998901234567"
              className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:border-teal-400"
            />
            {phoneError && <p className="text-red-300 text-xs mt-2">{phoneError}</p>}
            <div className="flex gap-3 mt-5">
              <button
                type="button"
                onClick={() => {
                  setIsReserveModalOpen(false);
                  setPhoneNumber('+998');
                  setPhoneError('');
                }}
                className="flex-1 py-3 border border-white/20 rounded-xl text-white hover:bg-white/10 transition"
              >
                {t('detail.cancel')}
              </button>
              <button
                type="button"
                onClick={handleBook}
                className="flex-1 py-3 bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white font-semibold rounded-xl transition"
              >
                {t('detail.confirmReserve')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== NAVIGATION COMPONENT ====================

const Navigation = ({ currentPage, onNavigate, userName, userRole, onLogout, themeMode, onToggleTheme }: NavigationProps) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { t, i18n } = useTranslation();
  const currentLang = i18n.resolvedLanguage ?? i18n.language;
  const isRu = currentLang.toLowerCase().startsWith('ru');
  const nextLanguage = isRu ? 'en' : 'ru';
  const languageToggleLabel = isRu ? 'EN' : 'RU';

  const navItems: Array<{ label: string; page: Page }> = userRole === 'admin'
    ? []
    : [
      { label: t('nav.home'), page: 'home' as Page },
      { label: t('nav.fleet'), page: 'carpark' as Page },
      { label: t('nav.about'), page: 'about' as Page },
      { label: t('nav.contact'), page: 'contacts' as Page },
    ];

  return (
    <nav className="fixed top-0 left-0 right-0 w-full bg-gradient-to-b from-slate-900/95 to-slate-900/80 backdrop-blur-xl border-b border-white/10 z-[100]">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="select-none">
          <BrandLogo size="sm" />
        </div>

        <div className="hidden lg:flex gap-8 items-center">
          {navItems.map((item) => (
            <button
              key={item.page}
              onClick={() => onNavigate(item.page)}
              className={`font-medium transition ${currentPage === item.page
                ? 'text-teal-400'
                : 'text-gray-300 hover:text-white'
                }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="hidden lg:flex items-center gap-4">
          <div className="flex items-center gap-[5px]">
            <button
              type="button"
              onClick={() => void i18n.changeLanguage(nextLanguage)}
              className="px-3 py-2 border border-white/20 text-gray-200 hover:bg-white/10 rounded-lg transition font-semibold tracking-wide"
              title={`Switch language to ${nextLanguage.toUpperCase()}`}
            >
              {languageToggleLabel}
            </button>
            <button
              onClick={onToggleTheme}
              className="px-3 py-2 border border-white/20 text-gray-200 hover:bg-white/10 rounded-lg transition flex items-center gap-2"
              title={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {themeMode === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
          <div className="text-right">
            <span className="text-gray-300 text-sm block">
              {userRole === 'admin' ? t('nav.admin') : t('nav.user')}
            </span>
            <span className="text-teal-400 font-semibold text-xs">{userName.slice(0, 20)}</span>
          </div>
          <button
            onClick={onLogout}
            className="px-4 py-2 border border-teal-500/30 text-teal-400 hover:bg-teal-500/10 rounded-lg transition flex items-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            {t('nav.logout')}
          </button>
        </div>

        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="lg:hidden text-white p-2 rounded-lg border border-white/20 bg-white/5 hover:bg-white/10 transition"
        >
          {isMenuOpen ? <X /> : <Menu />}
        </button>
      </div>

      {isMenuOpen && (
        <div className="lg:hidden bg-slate-950/95 border-t border-white/10 p-4 space-y-3">
          <button
            type="button"
            onClick={() => {
              onToggleTheme();
              setIsMenuOpen(false);
            }}
            className="w-full text-left px-4 py-2 border border-white/20 text-gray-200 hover:bg-white/10 rounded-lg transition flex items-center gap-2"
            title={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {themeMode === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            <span>{themeMode === 'dark' ? 'Light mode' : 'Dark mode'}</span>
          </button>
          <button
            type="button"
            onClick={() => void i18n.changeLanguage(nextLanguage)}
            className="w-full text-left px-4 py-2 border border-white/20 text-gray-200 hover:bg-white/10 rounded-lg transition font-semibold tracking-wide"
          >
            {languageToggleLabel}
          </button>
          {navItems.map((item) => (
            <button
              key={item.page}
              onClick={() => {
                onNavigate(item.page);
                setIsMenuOpen(false);
              }}
              className="w-full text-left px-4 py-2 text-gray-300 hover:text-teal-400 transition"
            >
              {item.label}
            </button>
          ))}
          <button
            onClick={onLogout}
            className="w-full px-4 py-2 border border-teal-500/30 text-teal-400 hover:bg-teal-500/10 rounded-lg transition"
          >
            <LogOut className="w-4 h-4 inline mr-2" />
            {t('nav.logout')}
          </button>
        </div>
      )}
    </nav>
  );
};

// ==================== ABOUT COMPONENT ====================

const About = () => {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950 pt-28 sm:pt-32 pb-16 sm:pb-20 animate-pageEnter">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <h1 className="text-3xl sm:text-5xl font-bold text-white mb-6">{t('about.title')}</h1>
        <div className="bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-xl border border-white/20 rounded-2xl p-5 sm:p-8 space-y-5 text-gray-300 leading-relaxed">
          <p>
            Our platform was built to simplify the full car rental workflow for both customers and administrators.
          </p>
          <p>
            On the customer side, users can explore available vehicles, view detailed car information, and submit a reservation quickly with transparent pricing and clear booking details.
          </p>
          <p>
            On the admin side, the platform helps manage fleet inventory, bookings, and customer communication in one place. It also supports practical operations such as automatic stock updates when a booking starts or ends.
          </p>
          <p>
            The main goal of this project is to provide a reliable, user-friendly rental management experience that is easy to operate, easy to extend, and ready for real-world daily use.
          </p>
        </div>
      </div>
    </div>
  );
};

// ==================== CONTACTS COMPONENT ====================

const Contacts = () => {
  const { t } = useTranslation();
  const offices = [
    { city: 'Sofia', addr: 'Aleksandar Malinov Blvd 37', phone: '+359 898 636 246' },
    { city: 'Plovdiv', addr: 'Kulensko Shose Blvd 20', phone: '+359 898 636 246' },
    { city: 'Stara Zagora', addr: 'Tsar Simeon Veliki St. 83', phone: '+359 898 636 246' },
    { city: 'Plovdiv Airport', addr: 'Airport Terminal', phone: '+359 898 636 246' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950 pt-28 sm:pt-32 pb-16 sm:pb-20 animate-pageEnter">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <h1 className="text-3xl sm:text-5xl font-bold text-white mb-4 text-center">{t('contacts.title')}</h1>
        <p className="text-gray-400 text-base sm:text-lg text-center mb-10 sm:mb-16">{t('contacts.subtitle')}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {offices.map((office, idx) => (
            <div key={idx} className="bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-xl border border-white/20 rounded-2xl p-6 hover:border-teal-500/50 transition">
              <h3 className="text-xl font-bold text-white mb-4">{office.city}</h3>
              <div className="space-y-3 text-gray-400 text-sm">
                <p className="flex gap-2"><MapPin className="w-4 h-4 text-teal-400 flex-shrink-0" />{office.addr}</p>
                <p className="flex gap-2"><Phone className="w-4 h-4 text-teal-400 flex-shrink-0" /><a href={`tel:${office.phone}`} className="hover:text-teal-400 transition">{office.phone}</a></p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ==================== ADMIN PANEL COMPONENT ====================

const AdminPanel = ({ cars, bookings, onAddCar, onDeleteCar, messages, onSendMessage, onMarkOneUnreadAsRead }: AdminPanelProps) => {
  const { t } = useTranslation();
  const [newCar, setNewCar] = useState<NewCarInput>({
    name: '',
    price: '',
    features: [],
    image: 'CAR',
    imageGallery: Array(BASE_URL_INPUT_COUNT).fill(''),
    rating: 4.8,
    quantity: 1
  });
  const [featureInput, setFeatureInput] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [isReplySending, setIsReplySending] = useState(false);
  const [isSavingCar, setIsSavingCar] = useState(false);

  const carEmojis = ['CAR', 'SUV', 'SPORT', 'RACE', 'VAN', 'PICKUP', 'EV', 'LUX'];
  const incomingMessages = messages.filter((m) => m.sender === 'user').slice().reverse();

  const handleAddFeature = () => {
    const trimmed = featureInput.trim();
    if (!trimmed) return;
    if (newCar.features.some((feature) => feature.toLowerCase() === trimmed.toLowerCase())) {
      setFeatureInput('');
      return;
    }
    setNewCar((prev) => ({ ...prev, features: [...prev.features, trimmed] }));
    setFeatureInput('');
  };

  const handleRemoveFeature = (index: number) => {
    setNewCar((prev) => ({ ...prev, features: prev.features.filter((_, i) => i !== index) }));
  };

  const handleImageUrlChange = (index: number, value: string) => {
    setNewCar((prev) => {
      const next = [...prev.imageGallery];
      next[index] = value;
      return { ...prev, imageGallery: next };
    });
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSavingCar) return;
    if (!newCar.name.trim() || !newCar.price.trim()) {
      alert('Please enter car name and price.');
      return;
    }
    const normalizedImageUrls = newCar.imageGallery
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (normalizedImageUrls.length < MIN_CAR_IMAGES) {
      alert(`Please upload at least ${MIN_CAR_IMAGES} images.`);
      return;
    }
    if (normalizedImageUrls.length > MAX_CAR_IMAGES) {
      alert(`You can upload up to ${MAX_CAR_IMAGES} images.`);
      return;
    }
    for (const imageUrl of normalizedImageUrls) {
      try {
        const parsed = new URL(imageUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw new Error('protocol');
        }
      } catch {
        alert('Each image must be a valid http/https URL.');
        return;
      }
    }

    setIsSavingCar(true);
    try {
      const saved = await onAddCar({
        ...newCar,
        name: newCar.name.trim(),
        price: newCar.price.trim(),
        quantity: Math.max(1, Math.floor(Number(newCar.quantity) || 1)),
        imageGallery: normalizedImageUrls.slice(0, MAX_CAR_IMAGES)
      });

      if (!saved) {
        return;
      }

      setNewCar({
        name: '',
        price: '',
        features: [],
        image: 'CAR',
        imageGallery: Array(BASE_URL_INPUT_COUNT).fill(''),
        rating: 4.8,
        quantity: 1
      });
      setShowForm(false);
    } finally {
      setIsSavingCar(false);
    }
  };

  const handleDeleteCarClick = (car: Car) => {
    const shouldDelete = window.confirm(`Delete "${car.name}" from fleet?\nThis will also remove related bookings and messages.`);
    if (!shouldDelete) return;
    onDeleteCar(car.id);
  };

  const handleSendReply = async (bookingId: number) => {
    if (!replyMessage.trim() || isReplySending) return;
    setIsReplySending(true);
    const sent = await onSendMessage(bookingId, replyMessage, 'admin');
    if (sent) setReplyMessage('');
    setIsReplySending(false);
  };

  const handleToggleBookingConversation = (booking: Booking) => {
    const isOpen = selectedBooking?.id === booking.id;
    setSelectedBooking(isOpen ? null : booking);
    if (!isOpen) {
      void onMarkOneUnreadAsRead(booking.id);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950 pt-28 sm:pt-32 pb-16 sm:pb-20 animate-pageEnter">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between mb-12">
          <div>
            <h1 className="text-3xl sm:text-5xl font-bold text-white mb-2">{t('admin.title')}</h1>
            <p className="text-gray-400">{t('admin.subtitle')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
          <div className="bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-xl border border-white/20 rounded-2xl p-6">
            <CarIcon className="w-8 h-8 text-teal-400 mb-4" />
            <p className="text-gray-400 text-sm">{t('admin.totalCars')}</p>
            <p className="text-3xl font-bold text-white">{cars.reduce((sum, car) => sum + car.quantity, 0)}</p>
          </div>
          <div className="bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-xl border border-white/20 rounded-2xl p-6">
            <Users className="w-8 h-8 text-blue-400 mb-4" />
            <p className="text-gray-400 text-sm">{t('admin.activeBookings')}</p>
            <p className="text-3xl font-bold text-white">{bookings.filter((b) => b.status === 'active').length}</p>
          </div>
          <div className="bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-xl border border-white/20 rounded-2xl p-6">
            <MessageCircle className="w-8 h-8 text-purple-400 mb-4" />
            <p className="text-gray-400 text-sm">{t('admin.totalMessages')}</p>
            <p className="text-3xl font-bold text-white">{messages.length}</p>
          </div>
          <div className="bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-xl border border-white/20 rounded-2xl p-6">
            <MessageCircle className="w-8 h-8 text-orange-400 mb-4" />
            <p className="text-gray-400 text-sm">{t('admin.unreadMessages')}</p>
            <p className="text-3xl font-bold text-white">{messages.filter((m) => m.sender !== 'admin' && !m.read).length}</p>
          </div>
        </div>

        <div className="mb-12">
          <button
            onClick={() => setShowForm((prev) => !prev)}
            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white font-bold rounded-xl transition transform hover:scale-105 active:scale-95"
          >
            <Plus className="w-5 h-5" />
            {t('admin.addNewCar')}
          </button>
        </div>

        {showForm && (
          <div className="bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-xl border border-white/20 rounded-2xl p-8 mb-12">
            <h2 className="text-2xl font-bold text-white mb-6">Add New Vehicle</h2>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-2">Car Name</label>
                  <input type="text" value={newCar.name} onChange={(e) => setNewCar((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. BMW M5 Competition" className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white focus:outline-none focus:border-teal-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-2">Price per Day</label>
                  <input type="number" step="0.01" value={newCar.price} onChange={(e) => setNewCar((prev) => ({ ...prev, price: e.target.value }))} placeholder="e.g. 120" className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white focus:outline-none focus:border-teal-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-2">Car Icon</label>
                  <select value={newCar.image} onChange={(e) => setNewCar((prev) => ({ ...prev, image: e.target.value }))} className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white focus:outline-none focus:border-teal-400">
                    {carEmojis.map((emoji) => <option key={emoji} value={emoji} className="bg-slate-900">{emoji}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-2">Quantity</label>
                  <input type="number" min="1" value={newCar.quantity} onChange={(e) => setNewCar((prev) => ({ ...prev, quantity: Math.max(1, Number(e.target.value) || 1) }))} placeholder="e.g. 3" className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white focus:outline-none focus:border-teal-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-2">Car Images</label>
                  <div className="space-y-2">
                    {Array.from({ length: BASE_URL_INPUT_COUNT }).map((_, index) => (
                      <input
                        key={`image-url-${index}`}
                        type="url"
                        value={newCar.imageGallery[index] ?? ''}
                        onChange={(e) => handleImageUrlChange(index, e.target.value)}
                        placeholder={`Image URL ${index + 1} (https://...)`}
                        className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:border-teal-400"
                      />
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-gray-400">
                    Min {MIN_CAR_IMAGES}, max {MAX_CAR_IMAGES}. Current: {newCar.imageGallery.filter((img) => img.trim().length > 0).length}
                  </p>
                  {newCar.imageGallery.filter((img) => img.trim().length > 0).length > 0 && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {newCar.imageGallery
                        .filter((img) => img.trim().length > 0)
                        .map((image, index) => (
                        <div key={`${index}-${image.slice(0, 16)}`} className="relative">
                          <img src={image} alt={`Car preview ${index + 1}`} className="w-full h-20 object-cover rounded-lg border border-white/20" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-200 mb-2">Rating (1-5)</label>
                  <input type="number" min="1" max="5" step="0.1" value={newCar.rating} onChange={(e) => setNewCar((prev) => ({ ...prev, rating: Number(e.target.value) || 4.8 }))} placeholder="1.0 - 5.0" className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white focus:outline-none focus:border-teal-400" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-200 mb-2">Features</label>
                <div className="flex gap-2 mb-4">
                  <input type="text" value={featureInput} onChange={(e) => setFeatureInput(e.target.value)} placeholder="e.g. Apple CarPlay, Sunroof" className="flex-1 px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white focus:outline-none focus:border-teal-400" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddFeature(); } }} />
                  <button type="button" onClick={handleAddFeature} className="px-4 py-3 bg-teal-500 hover:bg-teal-600 text-white rounded-xl transition">Add</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {newCar.features.map((feature, idx) => (
                    <div key={idx} className="flex items-center gap-2 px-3 py-1 bg-teal-500/20 border border-teal-500/50 rounded-full text-teal-300 text-sm">
                      {feature}
                      <button type="button" onClick={() => handleRemoveFeature(idx)} className="text-teal-400 hover:text-teal-200 transition">x</button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-4 pt-6">
                <button type="submit" disabled={isSavingCar} className="flex-1 py-3 bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white font-bold rounded-xl transition disabled:opacity-60 disabled:cursor-not-allowed">
                  {isSavingCar ? 'Saving...' : 'Add Car to Fleet'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-3 border border-white/20 text-white font-bold rounded-xl hover:bg-white/5 transition">Cancel</button>
              </div>
            </form>
          </div>
        )}

        <div>
          <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
            <CarIcon className="w-6 h-6 text-teal-400" />
            Fleet Management ({cars.length} cars)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {cars.map((car) => (
              <div key={car.id} className="bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-xl border border-white/20 rounded-2xl p-6">
                <div className="flex items-start justify-between mb-4">
                  {car.imageGallery?.[0] ? (
                    <img src={car.imageGallery[0]} alt={car.name} className="w-20 h-20 object-cover rounded-xl border border-white/20" />
                  ) : (
                    <div className="w-20 h-20 rounded-xl border border-white/20 flex items-center justify-center bg-white/5">
                      <CarIcon className="w-10 h-10 text-slate-400" />
                    </div>
                  )}
                  <button onClick={() => handleDeleteCarClick(car)} className="p-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded-lg transition" title="Delete car" aria-label={`Delete ${car.name}`}>
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
                <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                  <CarIcon className="w-4 h-4 text-teal-300" />
                  {car.name}
                </h3>
                <p className="text-teal-300 mb-2 flex items-center gap-2">
                  <CarIcon className="w-4 h-4" />
                  Available: {car.quantity}
                </p>
                <p className="text-2xl font-bold text-teal-400 mb-3 flex items-center gap-2">
                  <span className="text-lg">€</span>
                  {car.price.replace(/^€/, '')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {car.features.map((feat) => <span key={feat} className="text-xs px-2 py-1 bg-blue-500/20 text-blue-300 rounded-full">{feat}</span>)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-16">
          <h2 className="text-2xl font-bold text-white mb-6">Incoming Messages</h2>
          {incomingMessages.length === 0 ? (
            <p className="text-gray-400">No incoming messages yet.</p>
          ) : (
            <div className="space-y-3">
              {incomingMessages.map((msg) => {
                const booking = bookings.find((b) => b.id === msg.bookingId);
                const contactPhone = booking?.phoneNumber ? sanitizePhoneInput(booking.phoneNumber) : '';
                return (
                  <div key={`${msg.bookingId}-${msg.id}`} className="bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-xl border border-white/20 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm text-teal-300 font-semibold">{booking ? `${booking.carName} (Booking #${booking.id})` : `Booking #${msg.bookingId}`}</p>
                      <button onClick={() => booking && handleToggleBookingConversation(booking)} className="px-3 py-1.5 bg-teal-500/20 border border-teal-500/50 text-teal-300 rounded-lg hover:bg-teal-500/30 transition text-xs">
                        {booking && selectedBooking?.id === booking.id ? 'Close' : 'Open Conversation'}
                      </button>
                    </div>
                    {contactPhone && (
                      <div className="mb-2 flex items-center gap-2">
                        <p className="text-xs text-slate-300">
                          Phone:{' '}
                          <a href={`tel:${contactPhone}`} className="text-teal-300 hover:text-teal-200 underline">
                            {contactPhone}
                          </a>
                        </p>
                        <a
                          href={`tel:${contactPhone}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-teal-500/40 bg-teal-500/10 px-2 py-1 text-[11px] text-teal-300 hover:bg-teal-500/20 transition"
                          title={`Call ${contactPhone}`}
                        >
                          <Phone className="w-3.5 h-3.5" />
                          Call
                        </a>
                      </div>
                    )}
                    <p className="text-sm text-gray-200">{msg.text}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {bookings.length > 0 && (
          <div className="mt-16">
            <h2 className="text-2xl font-bold text-white mb-6">Customer Conversations</h2>
            <div className="space-y-4">
              {bookings.map((booking) => {
                const bookingMsgs = messages.filter((m) => m.bookingId === booking.id);
                return (
                  <div key={booking.id} className="bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-xl border border-white/20 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-xl font-bold text-white">{booking.carName}</h3>
                        <p className="text-sm text-gray-400">Booking #{booking.id}</p>
                        {booking.phoneNumber && (
                          <div className="mt-1 flex items-center gap-2">
                            <p className="text-xs text-slate-300">
                              Phone:{' '}
                              <a
                                href={`tel:${sanitizePhoneInput(booking.phoneNumber)}`}
                                className="text-teal-300 hover:text-teal-200 underline"
                              >
                                {sanitizePhoneInput(booking.phoneNumber)}
                              </a>
                            </p>
                            <a
                              href={`tel:${sanitizePhoneInput(booking.phoneNumber)}`}
                              className="inline-flex items-center gap-1 rounded-lg border border-teal-500/40 bg-teal-500/10 px-2 py-1 text-[11px] text-teal-300 hover:bg-teal-500/20 transition"
                              title={`Call ${sanitizePhoneInput(booking.phoneNumber)}`}
                            >
                              <Phone className="w-3.5 h-3.5" />
                              Call
                            </a>
                          </div>
                        )}
                      </div>
                      <button onClick={() => handleToggleBookingConversation(booking)} className="px-4 py-2 bg-teal-500/20 border border-teal-500/50 text-teal-300 rounded-lg hover:bg-teal-500/30 transition">
                        {selectedBooking?.id === booking.id ? 'Close' : 'View Messages'} ({bookingMsgs.length})
                      </button>
                    </div>
                    {selectedBooking?.id === booking.id && (
                      <div className="mt-4 bg-black/20 rounded-xl p-4">
                        <div className="space-y-3 mb-4 max-h-60 overflow-y-auto">
                          {bookingMsgs.map((msg) => (
                            <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                              <div className={`max-w-xs px-3 py-2 rounded-lg text-sm ${msg.sender === 'user' ? 'bg-teal-500/30 text-teal-100' : 'bg-blue-500/30 text-blue-100'}`}>
                                <p>{msg.text}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <input type="text" value={replyMessage} onChange={(e) => setReplyMessage(e.target.value)} className="flex-1 px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-teal-400 text-sm" placeholder="Type your reply..." onKeyDown={(e) => e.key === 'Enter' && void handleSendReply(booking.id)} />
                          <button onClick={() => void handleSendReply(booking.id)} disabled={isReplySending} className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg transition text-sm flex items-center gap-1 disabled:opacity-60">
                            <Send className="w-4 h-4" />Send
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ==================== HOME COMPONENT ====================

const Home = ({ onNavigate }: HomeProps) => {
  const { t } = useTranslation();
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="min-h-screen animate-pageEnter">
      <section className="relative min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-teal-900 pt-24 sm:pt-24 overflow-hidden flex items-center">
        <div className="absolute inset-0 overflow-hidden">
          <div
            className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-blue-500/20 to-transparent rounded-full blur-3xl"
            style={{ transform: `translateY(${scrollY * 0.5}px)` }}
          ></div>
          <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-gradient-to-tr from-teal-500/20 to-transparent rounded-full blur-3xl"></div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-10 py-16 sm:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            <div className="space-y-8 animate-fadeInUp">
              <div>
                <span className="inline-block px-4 py-2 bg-teal-500/20 border border-teal-500/40 rounded-full text-teal-300 text-sm font-medium mb-6">
                  {t('home.badge')}
                </span>
                <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold text-white leading-tight mb-6">
                  <span className="bg-gradient-to-r from-teal-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">
                    {t('home.title1')}
                  </span>
                  <br />
                  {t('home.title2')}
                </h1>
              </div>

              <p className="text-base sm:text-xl text-gray-300 leading-relaxed max-w-xl">
                {t('home.desc')}
              </p>

              <div className="flex flex-col sm:flex-row gap-4 pt-4">
                <button
                  onClick={() => onNavigate('carpark')}
                  className="group relative px-8 py-4 bg-gradient-to-r from-teal-500 to-blue-500 text-white font-semibold rounded-xl overflow-hidden hover:shadow-2xl transition transform hover:scale-105 active:scale-95"
                >
                  <span className="relative z-10 flex items-center gap-2">
                    {t('home.browse')}
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition" />
                  </span>
                </button>
                <button
                  onClick={() => onNavigate('contacts')}
                  className="px-8 py-4 border border-white/30 hover:border-white/60 text-white font-semibold rounded-xl backdrop-blur-sm hover:bg-white/10 transition"
                >
                  {t('home.contact')}
                </button>
              </div>
            </div>

            <div className="relative animate-fadeInRight" style={{ animationDelay: '0.2s' }}>
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-teal-500/30 to-blue-500/30 rounded-3xl blur-3xl"></div>
                <div className="relative bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-xl border border-white/20 rounded-3xl p-6 sm:p-12 text-center shadow-2xl">
                  <img
                    src="https://cdn.pixabay.com/photo/2017/03/27/14/56/auto-2179220_1280.jpg"
                    alt="Featured car"
                    className="w-full h-52 sm:h-60 object-cover rounded-2xl mb-8 border border-white/20"
                  />
                  <h2 className="text-3xl font-bold text-white mb-4 flex items-center justify-center gap-2">
                    <CarIcon className="w-7 h-7 text-teal-300" />
                    VW Arteon
                  </h2>
                  <p className="text-gray-300 text-lg mb-6">{t('home.featured')}</p>
                  <div className="flex justify-around text-center">
                    <div>
                      <p className="text-2xl font-bold text-teal-400">250+</p>
                      <p className="text-xs text-gray-400 mt-1 flex items-center justify-center gap-1">
                        <CarIcon className="w-3.5 h-3.5 text-teal-400" />
                        {t('home.carsAvailable')}
                      </p>
                    </div>
                    <div className="border-l border-white/10"></div>
                    <div>
                      <p className="text-2xl font-bold text-blue-400">4.9</p>
                      <p className="text-xs text-gray-400 mt-1">{t('home.clientRating')}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

// ==================== CAR PARK COMPONENT ====================

const CarPark = ({ onNavigate, cars }: CarParkProps) => {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const availableCars = cars.filter((car) => car.quantity > 0);
  const totalAvailableCars = availableCars.reduce((total, car) => total + car.quantity, 0);
  const filteredCars = availableCars.filter((car) => {
    if (!normalizedSearch) return true;
    const inName = car.name.toLowerCase().includes(normalizedSearch);
    const inPrice = car.price.toLowerCase().includes(normalizedSearch);
    const inFeatures = car.features.some((feature) => feature.toLowerCase().includes(normalizedSearch));
    return inName || inPrice || inFeatures;
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950 pt-28 sm:pt-32 pb-16 sm:pb-20 animate-pageEnter">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-16 animate-fadeInUp">
          <h1 className="text-3xl sm:text-5xl font-bold text-white mb-4 flex items-center justify-center gap-3">
            <CarIcon className="w-10 h-10 text-teal-400" />
            {t('carpark.title')}
          </h1>
          <p className="text-gray-400 text-base sm:text-lg">
            {availableCars.length} / {totalAvailableCars} {t('home.carsAvailable')}
          </p>
          <div className="mt-8 max-w-xl mx-auto">
            <label className="sr-only" htmlFor="fleet-search">Search cars</label>
            <div className="relative">
              <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                id="fleet-search"
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t('carpark.searchPlaceholder')}
                className="w-full rounded-2xl border border-white/20 bg-white/10 backdrop-blur-xl pl-12 pr-4 py-3.5 text-white placeholder-slate-400 focus:outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-500/30 transition"
              />
            </div>
            {searchTerm.trim() && (
              <p className="text-xs text-slate-400 mt-2 text-left">
                Found {filteredCars.length} result(s) for "{searchTerm.trim()}"
              </p>
            )}
          </div>
        </div>

        {cars.length === 0 ? (
          <div className="text-center py-20">
            <AlertCircle className="w-16 h-16 mx-auto text-yellow-400 mb-4" />
            <p className="text-gray-400 text-lg">{t('carpark.noCars')}</p>
          </div>
        ) : availableCars.length === 0 ? (
          <div className="text-center py-20">
            <AlertCircle className="w-16 h-16 mx-auto text-yellow-400 mb-4" />
            <p className="text-gray-400 text-lg">{t('carpark.allBooked')}</p>
          </div>
        ) : filteredCars.length === 0 ? (
          <div className="text-center py-20">
            <Search className="w-14 h-14 mx-auto text-slate-500 mb-4" />
            <p className="text-gray-300 text-lg">{t('carpark.noMatch')}</p>
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="mt-5 px-5 py-2.5 rounded-xl border border-teal-500/40 text-teal-300 hover:bg-teal-500/10 transition"
            >
              {t('carpark.clearSearch')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-8">
            {filteredCars.map((car, idx) => (
              <div
                key={car.id}
                className="group cursor-pointer animate-fadeInUp w-full max-w-[620px] mx-auto"
                style={{ animationDelay: `${idx * 0.1}s` }}
                onClick={() => onNavigate('cardetail', car.id)}
              >
                <div className="relative bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-xl border border-white/20 rounded-3xl overflow-hidden hover:border-teal-500/50 transition h-full flex flex-col">
                  <div className="relative h-56 bg-gradient-to-br from-teal-500/20 to-blue-500/20 flex items-center justify-center overflow-hidden">
                    {car.imageGallery?.[0] ? (
                      <img
                        src={car.imageGallery[0]}
                        alt={car.name}
                        className="h-full w-full object-cover group-hover:scale-110 transition duration-500"
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full w-full group-hover:scale-110 transition duration-500">
                        <CarIcon className="w-20 h-20 text-white/70" />
                      </div>
                    )}
                  </div>

                  <div className="p-6 flex flex-col flex-grow">
                    <h3 className="text-xl font-bold text-white mb-3">{car.name}</h3>
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <p className="text-xs text-teal-300 flex items-center gap-1.5">
                        <CarIcon className="w-3.5 h-3.5" />
                        {t('detail.availableNow')}: {car.quantity}
                      </p>
                      <div className="flex items-center gap-2">
                        <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                        <span className="text-yellow-400 font-semibold">{car.rating}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 mb-6">
                      {car.features.map((feat: string) => (
                        <span key={feat} className="text-xs px-3 py-1 bg-teal-500/20 text-teal-300 rounded-full border border-teal-500/30">
                          {feat}
                        </span>
                      ))}
                    </div>

                    <div className="border-t border-white/10 pt-4 mt-auto">
                      <p className="text-2xl font-bold bg-gradient-to-r from-teal-400 to-blue-400 bg-clip-text text-transparent mb-4">
                        {car.price}
                        <span className="text-sm text-gray-400">/day</span>
                      </p>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onNavigate('cardetail', car.id);
                        }}
                        className="w-full py-3 bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white font-semibold rounded-xl transition transform hover:scale-105 active:scale-95 group-hover:shadow-xl"
                      >
                        {t('carpark.bookNow')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ==================== CAR DETAIL COMPONENT ====================
// (Qolgan barcha komponentlar - Home, CarDetail, AdminPanel, Navigation, About, Contacts)
// Kodning uzunligi sababli qolgan qismini pastdan qo'shaman...

// ==================== MAIN APP ====================

const DLRentApp = () => {
  const [currentPage, setCurrentPage] = useState<Page>('login');
  const [selectedCarId, setSelectedCarId] = useState(1);
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState<UserRole>('');
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'dark';
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  const [cars, setCars] = useState<Car[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const autoReturnInProgressRef = useRef(false);
  const [authRefreshToken, setAuthRefreshToken] = useState(0);

  // ==================== THEME EFFECT ====================
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.style.colorScheme = themeMode;
    document.body.dataset.theme = themeMode;
  }, [themeMode]);

  // ==================== LOAD DATA FROM FIRESTORE ====================
  useEffect(() => {
    const loadChatData = async () => {
      if (!auth.currentUser) {
        setBookings([]);
        setMessages([]);
        return;
      }
      try {
        const [bookingsRes, messagesRes] = await Promise.all([
          apiFetch(`${API_URL}/bookings`),
          apiFetch(`${API_URL}/messages`)
        ]);
        if (!bookingsRes.ok || !messagesRes.ok) {
          throw new Error('Bookings/messages Firestore request failed');
        }

        const rawBookings = (await bookingsRes.json()) as unknown[];
        const rawMessages = (await messagesRes.json()) as unknown[];

        setBookings(
          rawBookings
            .filter((booking): booking is Partial<Booking> =>
              typeof booking === 'object' &&
              booking !== null &&
              typeof (booking as Partial<Booking>).id === 'number' &&
              typeof (booking as Partial<Booking>).carId === 'number' &&
              typeof (booking as Partial<Booking>).carName === 'string' &&
              typeof (booking as Partial<Booking>).pickupDate === 'string' &&
              typeof (booking as Partial<Booking>).returnDate === 'string' &&
              typeof (booking as Partial<Booking>).timestamp === 'string' &&
              typeof (booking as Partial<Booking>).userName === 'string'
            )
            .map((booking) => ({
              id: booking.id as number,
              carId: booking.carId as number,
              carName: booking.carName as string,
              phoneNumber: typeof booking.phoneNumber === 'string' ? booking.phoneNumber : '',
              pickupDate: booking.pickupDate as string,
              returnDate: booking.returnDate as string,
              returnTime: typeof booking.returnTime === 'string' ? booking.returnTime : undefined,
              timestamp: booking.timestamp as string,
              userName: booking.userName as string,
              status: booking.status === 'completed' ? 'completed' : 'active'
            } satisfies Booking))
        );

        setMessages(
          rawMessages
            .filter((message): message is ChatMessage =>
              typeof message === 'object' &&
              message !== null &&
              typeof (message as ChatMessage).id === 'number' &&
              typeof (message as ChatMessage).bookingId === 'number' &&
              typeof (message as ChatMessage).text === 'string' &&
              ((message as ChatMessage).sender === 'user' || (message as ChatMessage).sender === 'admin') &&
              typeof (message as ChatMessage).time === 'string' &&
              typeof (message as ChatMessage).read === 'boolean'
            )
        );
      } catch (error) {
        console.error('Could not load bookings/messages from Firestore:', error);
      }
    };

    void loadChatData();
  }, [authRefreshToken]);

  // ==================== AUTH SYNC ====================
  useEffect(() => {
    const syncAuthFromStorage = () => {
      try {
        const raw = localStorage.getItem(AUTH_STORAGE_KEY);
        if (!raw) {
          setUserName('');
          setUserRole('');
          setCurrentPage('login');
          return;
        }

        const parsed = JSON.parse(raw) as Partial<StoredAuth>;
        if (parsed.userRole === 'admin' || parsed.userRole === 'user') {
          setUserRole(parsed.userRole);
          setUserName(typeof parsed.userName === 'string' ? parsed.userName : '');
          setCurrentPage(parsed.userRole === 'admin' ? 'admin' : 'home');
          return;
        }

        setUserName('');
        setUserRole('');
        setCurrentPage('login');
      } catch (error) {
        console.error('Could not restore auth from localStorage:', error);
      }
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key === AUTH_STORAGE_KEY) {
        syncAuthFromStorage();
      }
    };

    const onAuthChange = () => {
      syncAuthFromStorage();
    };

    syncAuthFromStorage();
    window.addEventListener('storage', onStorage);
    window.addEventListener(AUTH_CHANGE_EVENT, onAuthChange);

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(AUTH_CHANGE_EVENT, onAuthChange);
    };
  }, []);

  // ==================== FIREBASE AUTH STATE ====================
  useEffect(() => {
    void getRedirectResult(auth).catch((error) => {
      console.error('Redirect sign-in failed:', error);
    });
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (!firebaseUser) {
        setUserName('');
        setUserRole('');
        setCurrentPage('login');
        localStorage.removeItem(AUTH_STORAGE_KEY);
        window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
        setAuthRefreshToken((prev) => prev + 1);
        return;
      }
      const email = firebaseUser.email ?? firebaseUser.displayName ?? '';
      if (!email) {
        setUserName('');
        setUserRole('');
        setCurrentPage('login');
        localStorage.removeItem(AUTH_STORAGE_KEY);
        window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
        setAuthRefreshToken((prev) => prev + 1);
        return;
      }
      const role: Exclude<UserRole, ''> = email.trim().toLowerCase() === ADMIN_EMAIL ? 'admin' : 'user';
      setUserName(email);
      setUserRole(role);
      localStorage.setItem(
        AUTH_STORAGE_KEY,
        JSON.stringify({
          userName: email,
          userRole: role
        } satisfies StoredAuth)
      );
      window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
      setCurrentPage((prev) => (prev === 'login' ? (role === 'admin' ? 'admin' : 'home') : prev));
      setAuthRefreshToken((prev) => prev + 1);
    });

    return () => unsubscribe();
  }, []);

  // ==================== LOAD CARS ====================
  useEffect(() => {
    const loadCars = async () => {
      try {
        const response = await apiFetch(`${API_URL}/cars`);
        if (!response.ok) {
          throw new Error(`Cars Firestore request failed with status ${response.status}`);
        }
        const data = (await response.json()) as unknown[];
        const processedCars = data
          .map((raw) => {
            const typedRaw = raw as Partial<Car>;
            const id = typeof typedRaw.id === 'number' ? typedRaw.id : null;
            if (id === null) return null;
            return { ...typedRaw, id } as Car;
          })
          .filter((car): car is Car => car !== null);

        setCars(
          processedCars.map((car: Car) => ({
            ...car,
            imageGallery:
              Array.isArray(car.imageGallery) && car.imageGallery.length > 0
                ? car.imageGallery.filter((img): img is string => typeof img === 'string' && img.trim().length > 0)
                : [],
            quantity: Number.isFinite(car.quantity) ? Math.max(0, Math.floor(Number(car.quantity))) : 1
          }))
        );
      } catch (error) {
        console.error('Could not load cars from Firestore:', error);
      }
    };

    void loadCars();
  }, [authRefreshToken]);

  // ==================== AUTO COMPLETE EXPIRED BOOKINGS ====================
  useEffect(() => {
    const autoCompleteExpiredBookings = async () => {
      if (autoReturnInProgressRef.current) return;

      const expiredActiveBookings = bookings.filter(
        (booking) => booking.status === 'active' && Date.now() >= getBookingReturnAtMs(booking)
      );
      if (expiredActiveBookings.length === 0) return;

      autoReturnInProgressRef.current = true;

      try {
        const completedBookingResults = await Promise.allSettled(
          expiredActiveBookings.map(async (booking) => {
            const response = await apiFetch(`${API_URL}/bookings/${booking.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'completed' })
            });
            if (!response.ok) {
              throw new Error(`Could not complete booking ${booking.id}`);
            }
            return booking;
          })
        );

        const completedBookings = completedBookingResults
          .filter((result): result is PromiseFulfilledResult<Booking> => result.status === 'fulfilled')
          .map((result) => result.value);

        if (completedBookings.length === 0) return;

        const completedBookingIds = new Set(completedBookings.map((booking) => booking.id));
        setBookings((prev) =>
          prev.map((booking) =>
            completedBookingIds.has(booking.id) ? { ...booking, status: 'completed' } : booking
          )
        );
        setSelectedBooking((prev) =>
          prev && completedBookingIds.has(prev.id) ? { ...prev, status: 'completed' } : prev
        );

        // Transaction restores car quantities during booking completion.
        // We only resync local cars to avoid double increments.
        try {
          const carsResponse = await apiFetch(`${API_URL}/cars`);
          if (carsResponse.ok) {
            const rawCars = (await carsResponse.json()) as unknown[];
            const normalizedCars = rawCars
              .map((raw) => {
                const typedRaw = raw as Partial<Car>;
                const id = typeof typedRaw.id === 'number' ? typedRaw.id : null;
                if (id === null) return null;
                return { ...typedRaw, id } as Car;
              })
              .filter((car): car is Car => car !== null)
              .map((car) => ({
                ...car,
                imageGallery:
                  Array.isArray(car.imageGallery) && car.imageGallery.length > 0
                    ? car.imageGallery.filter((img): img is string => typeof img === 'string' && img.trim().length > 0)
                    : [],
                quantity: Number.isFinite(car.quantity) ? Math.max(0, Math.floor(Number(car.quantity))) : 1
              }));

            setCars(normalizedCars);
          }
        } catch (carSyncError) {
          console.error('Could not sync cars after auto-complete:', carSyncError);
        }
      } catch (error) {
        console.error('Could not auto-complete expired bookings:', error);
      } finally {
        autoReturnInProgressRef.current = false;
      }
    };

    void autoCompleteExpiredBookings();
    const timerId = window.setInterval(() => {
      void autoCompleteExpiredBookings();
    }, 60_000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [bookings]);

  // ==================== HANDLERS ====================

  const handleNavigate = (page: Page, carId: number | null = null) => {
    if (carId !== null) setSelectedCarId(carId);
    setCurrentPage(page);
    window.scrollTo(0, 0);
  };

  const handleLoginSuccess = (email: string, role: Exclude<UserRole, ''>) => {
    setUserName(email);
    setUserRole(role);
    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        userName: email,
        userRole: role
      } satisfies StoredAuth)
    );
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
  };

  // ? FIREBASE AUTH - Faqat authentication
  const handleEmailAuth = async (email: string, password: string) => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      return { ok: false, message: 'Email and password are required.' };
    }

    try {
      // Sign in
      await signInWithEmailAndPassword(auth, trimmedEmail, password);
      return { ok: true };
    } catch (signInError: unknown) {
      const authCode =
        typeof signInError === 'object' &&
          signInError !== null &&
          'code' in signInError &&
          typeof (signInError as { code?: unknown }).code === 'string'
          ? (signInError as { code: string }).code
          : '';
      // Firebase may return `invalid-credential` for both missing users and wrong password.
      // We attempt create; if email exists, we map back to incorrect-password UX.
      if (authCode === 'auth/user-not-found' || authCode === 'auth/invalid-credential') {
        try {
          await createUserWithEmailAndPassword(auth, trimmedEmail, password);
          return { ok: true };
        } catch (createError: unknown) {
          const createCode =
            typeof createError === 'object' &&
              createError !== null &&
              'code' in createError &&
              typeof (createError as { code?: unknown }).code === 'string'
              ? (createError as { code: string }).code
              : '';

          if (createCode === 'auth/email-already-in-use') {
            return { ok: false, message: 'Incorrect password.' };
          }

          console.error('Create user failed:', createError);
          return { ok: false, message: 'Registration failed. Try again.' };
        }
      }
      if (authCode === 'auth/operation-not-allowed') {
        return { ok: false, message: 'Email/password login is disabled in Firebase Auth.' };
      }
      if (authCode === 'auth/wrong-password') {
        return { ok: false, message: 'Incorrect password.' };
      }
      console.error('Sign in failed:', signInError);
      return { ok: false, message: 'Login failed. Email or password is incorrect.' };
    }
  };

  const handleSocialAuth = async (provider: SocialProvider) => {
    if (provider === 'google' && !ENABLE_GOOGLE_AUTH) {
      return { ok: false, message: 'Google sign-in vaqtincha o‘chirilgan.' };
    }
    if (provider === 'apple' && !ENABLE_APPLE_AUTH) {
      return { ok: false, message: 'Apple sign-in hali sozlanmagan.' };
    }
    if (provider === 'microsoft' && !ENABLE_MICROSOFT_AUTH) {
      return { ok: false, message: 'Microsoft sign-in hali sozlanmagan.' };
    }

    try {
      const firebaseProvider =
        provider === 'apple'
          ? appleProvider
          : provider === 'microsoft'
            ? microsoftProvider
            : googleProvider;

      if (isMobileAuthEnvironment()) {
        await signInWithRedirect(auth, firebaseProvider);
        return { ok: true };
      }

      const result = await signInWithPopup(auth, firebaseProvider);
      const email = result.user.email ?? result.user.displayName ?? 'social-user';
      handleLoginSuccess(email, 'user');
      return { ok: true };
    } catch (error) {
      console.error(`${provider} auth failed:`, error);
      const fallbackError =
        typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          typeof (error as { code?: unknown }).code === 'string'
          ? (error as { code: string }).code
          : '';

      if (fallbackError === 'auth/unauthorized-domain') {
        const host = typeof window !== 'undefined' ? window.location.hostname : 'your-domain.vercel.app';
        return {
          ok: false,
          message: `Firebase domain ruxsati yo'q: ${host}. Firebase Console -> Authentication -> Settings -> Authorized domains ga shu domainni qo'shing.`
        };
      }

      if (
        fallbackError === 'auth/popup-blocked' ||
        fallbackError === 'auth/popup-closed-by-user' ||
        fallbackError === 'auth/operation-not-supported-in-this-environment'
      ) {
        try {
          await signInWithRedirect(
            auth,
            provider === 'apple' ? appleProvider : provider === 'microsoft' ? microsoftProvider : googleProvider
          );
          return { ok: true };
        } catch (redirectError) {
          console.error(`${provider} redirect auth failed:`, redirectError);
        }
      }

      if (fallbackError === 'auth/operation-not-allowed') {
        return { ok: false, message: `${provider} sign-in Firebase Auth'da yoqilmagan.` };
      }

      return { ok: false, message: `${provider} sign-in failed. Please try again.` };
    }
  };

  const handleLogout = () => {
    setCurrentPage('login');
    setUserName('');
    setUserRole('');
    localStorage.removeItem(AUTH_STORAGE_KEY);
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    void signOut(auth).catch((error) => console.error('Firebase sign out failed:', error));
  };

  const handleBookCar = async (booking: BookingInput) => {
    if (!auth.currentUser) {
      alert('Avval login qiling, keyin bron qilish mumkin.');
      setCurrentPage('login');
      return false;
    }
    const targetCar = cars.find((car) => car.id === booking.carId);
    if (!targetCar || targetCar.quantity <= 0) {
      alert('This car is not available right now.');
      return false;
    }

    try {
      const bookingPayload = {
        ...booking,
        status: 'active',
        userName
      };

      const response = await apiFetch(`${API_URL}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookingPayload)
      });

      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to create booking');
        throw new Error(message);
      }
      const newBooking = (await response.json()) as Booking;

      setBookings((prev) => [...prev, newBooking]);
      setCars((prev) =>
        prev.map((car) => (car.id === targetCar.id ? { ...car, quantity: car.quantity - 1 } : car))
      );

      const contactNumber = typeof booking.phoneNumber === 'string' ? sanitizePhoneInput(booking.phoneNumber) : '';
      if (contactNumber) {
        try {
          const phoneMessageResponse = await apiFetch(`${API_URL}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bookingId: newBooking.id as number,
              text: `Contact number: ${contactNumber}`,
              sender: 'user' as const
            })
          });

          if (phoneMessageResponse.ok) {
            const phoneMessage = (await phoneMessageResponse.json()) as ChatMessage;
            setMessages((prev) => [...prev, phoneMessage]);
          }
        } catch (error) {
          console.error('Could not send auto phone message:', error);
        }
      }

      setCurrentPage('home');
      return true;
    } catch (error) {
      console.error('Could not create booking:', error);
      alert(
        error instanceof Error
          ? error.message
          : 'Booking failed. Firebase ruxsatlari va login holatini tekshiring.'
      );
      return false;
    }
  };

  const handleSendMessage = async (bookingId: number, messageText: string, sender: MessageSender = 'user') => {
    if (!auth.currentUser) {
      alert('Xabar yuborish uchun login qiling.');
      setCurrentPage('login');
      return false;
    }
    if (!messageText.trim()) return false;
    const targetBooking = bookings.find((booking) => booking.id === bookingId);
    if (!targetBooking) return false;
    if (sender === 'user' && targetBooking.userName !== userName) return false;

    const messagePayload = {
      bookingId,
      text: messageText,
      sender
    };

    try {
      const response = await apiFetch(`${API_URL}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messagePayload)
      });

      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to send message');
        throw new Error(message);
      }
      const newMessage = (await response.json()) as ChatMessage;

      setMessages((prev) => [...prev, newMessage]);
      return true;
    } catch (error) {
      console.error('Could not send message:', error);
      alert(
        error instanceof Error
          ? error.message
          : 'Message was not sent. Firebase ruxsatlarini tekshiring.'
      );
      return false;
    }
  };

  const handleMarkOneUnreadAsRead = async (bookingId: number) => {
    if (!auth.currentUser) return;
    const targetMessage = messages.find(
      (message) => message.bookingId === bookingId && message.sender === 'user' && !message.read
    );
    if (!targetMessage) return;

    setMessages((prev) =>
      prev.map((message) =>
        message.id === targetMessage.id ? { ...message, read: true } : message
      )
    );

    try {
      const response = await apiFetch(`${API_URL}/messages/${targetMessage.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: true })
      });

      if (!response.ok) {
        throw new Error('Failed to mark message as read');
      }
    } catch (error) {
      console.error('Could not update message read status:', error);
      setMessages((prev) =>
        prev.map((message) =>
          message.id === targetMessage.id ? { ...message, read: false } : message
        )
      );
    }
  };

  const handleAddCar = async (newCar: NewCarInput) => {
    if (!auth.currentUser) {
      alert('Avval login qiling.');
      setCurrentPage('login');
      return false;
    }
    const normalizedName = newCar.name.trim().toLowerCase();
    const existingCar = cars.find((car) => car.name.trim().toLowerCase() === normalizedName);

    if (existingCar) {
      const updatedQuantity = existingCar.quantity + 1;

      try {
        const response = await apiFetch(`${API_URL}/cars/${existingCar.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quantity: updatedQuantity })
        });

        if (!response.ok) {
          const message = await getApiErrorMessage(response, 'Failed to update car quantity');
          throw new Error(message);
        }
        const updatedCarData = (await response.json()) as Partial<Car>;

        setCars((prev) =>
          prev.map((car) =>
            car.id === existingCar.id
              ? { ...car, quantity: Number.isFinite(updatedCarData.quantity) ? Number(updatedCarData.quantity) : car.quantity }
              : car
          )
        );
        return true;
      } catch (error) {
        console.error('Could not increase car quantity:', error);
        alert(
          error instanceof Error
            ? error.message
            : 'Car quantity was not updated. Firebase ruxsatlarini tekshiring.'
        );
        return false;
      }
    }

    const payload: Omit<Car, 'id'> = {
      ...newCar,
      imageGallery: newCar.imageGallery,
      price: newCar.price.startsWith('EUR ') ? newCar.price : `EUR ${newCar.price}`,
      quantity: Math.max(1, newCar.quantity)
    };

    try {
      const response = await apiFetch(`${API_URL}/cars`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const message = await getApiErrorMessage(response, `HTTP ${response.status}`);
        throw new Error(message);
      }
      const createdCar = (await response.json()) as Partial<Car>;
      const normalizedCreatedCar: Car = {
        id: typeof createdCar.id === 'number' ? createdCar.id : Date.now(),
        name: typeof createdCar.name === 'string' ? createdCar.name : newCar.name,
        price: typeof createdCar.price === 'string' ? createdCar.price : payload.price,
        features: Array.isArray(createdCar.features) ? createdCar.features : newCar.features,
        image: typeof createdCar.image === 'string' ? createdCar.image : newCar.image,
        rating: typeof createdCar.rating === 'number' ? createdCar.rating : newCar.rating,
        quantity: typeof createdCar.quantity === 'number' ? Math.max(0, Math.floor(createdCar.quantity)) : newCar.quantity,
        imageGallery:
          Array.isArray(createdCar.imageGallery) && createdCar.imageGallery.length > 0
            ? createdCar.imageGallery.filter((img): img is string => typeof img === 'string' && img.trim().length > 0)
            : newCar.imageGallery
      };

      setCars((prev) => [
        ...prev,
        normalizedCreatedCar
      ]);
      return true;
    } catch (error) {
      console.error('Could not save car to Firestore:', error);
      alert(
        error instanceof Error ? error.message : 'Car was not saved. Firebase ruxsatlarini tekshiring.'
      );
      return false;
    }
  };

  const handleDeleteCar = async (carId: number) => {
    if (!auth.currentUser) {
      alert('Avval login qiling.');
      setCurrentPage('login');
      return;
    }
    try {
      const response = await apiFetch(`${API_URL}/cars/${carId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to delete car');
        throw new Error(message);
      }

      setCars((prev) => prev.filter((c) => c.id !== carId));

      const relatedBookingIds = bookings
        .filter((booking) => booking.carId === carId)
        .map((booking) => booking.id);

      if (relatedBookingIds.length > 0) {
        setBookings((prev) => prev.filter((booking) => !relatedBookingIds.includes(booking.id)));
        setMessages((prev) => prev.filter((msg) => !relatedBookingIds.includes(msg.bookingId)));
      }

      if (selectedBooking && selectedBooking.carId === carId) {
        setSelectedBooking(null);
      }
    } catch (error) {
      console.error('Could not delete car from Firestore:', error);
      alert(
        error instanceof Error ? error.message : 'Car was not deleted. Firebase ruxsatlarini tekshiring.'
      );
    }
  };

  return (
    <div className={`min-h-screen app-shell ${themeMode === 'light' ? 'theme-light' : 'theme-dark'}`}>
      {currentPage !== 'login' && (
        <Navigation
          currentPage={currentPage}
          onNavigate={handleNavigate}
          userName={userName}
          userRole={userRole}
          onLogout={handleLogout}
          themeMode={themeMode}
          onToggleTheme={() => setThemeMode((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        />
      )}

      {currentPage === 'login' && (
        <Login
          onNavigate={handleNavigate}
          onLoginSuccess={handleLoginSuccess}
          onEmailAuth={handleEmailAuth}
          onSocialAuth={handleSocialAuth}
        />
      )}
      {currentPage === 'home' && <Home onNavigate={handleNavigate} />}
      {currentPage === 'carpark' && <CarPark onNavigate={handleNavigate} cars={cars} />}
      {currentPage === 'cardetail' && (
        <CarDetail
          carId={selectedCarId}
          onNavigate={handleNavigate}
          allCars={cars}
          onBookCar={handleBookCar}
        />
      )}
      {currentPage === 'about' && <About />}
      {currentPage === 'contacts' && <Contacts />}
      {currentPage === 'admin' && (
        <AdminPanel
          cars={cars}
          bookings={bookings}
          onAddCar={handleAddCar}
          onDeleteCar={handleDeleteCar}
          messages={messages}
          onSendMessage={handleSendMessage}
          onMarkOneUnreadAsRead={handleMarkOneUnreadAsRead}
        />
      )}

      {selectedBooking && userRole === 'admin' && (
        <ChatModal
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
          onSendMessage={handleSendMessage}
          messages={messages}
        />
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Sora:wght@500;600;700;800&display=swap');

        :root {
          --bg-start: #060b17;
          --bg-end: #0f1e3f;
          --panel: rgba(13, 24, 46, 0.72);
          --panel-strong: rgba(22, 40, 74, 0.82);
          --soft-border: rgba(148, 163, 184, 0.28);
          --text-main: #e6edf8;
          --text-soft: #9fb2cc;
          --brand-a: #0ea5a6;
          --brand-b: #3b82f6;
          --brand-c: #f59e0b;
          --shadow-soft: 0 14px 40px rgba(2, 8, 23, 0.34);
          --shadow-pop: 0 22px 56px rgba(2, 8, 23, 0.44);
        }

        .theme-light {
          --bg-start: #f4f7fb;
          --bg-end: #e6edf9;
          --panel: rgba(255, 255, 255, 0.88);
          --panel-strong: rgba(248, 250, 252, 0.95);
          --soft-border: rgba(15, 23, 42, 0.15);
          --text-main: #0f172a;
          --text-soft: #475569;
          --brand-a: #0f766e;
          --brand-b: #1d4ed8;
          --brand-c: #d97706;
          --shadow-soft: 0 12px 30px rgba(15, 23, 42, 0.14);
          --shadow-pop: 0 18px 44px rgba(15, 23, 42, 0.18);
        }

        html, body, #root {
          min-height: 100%;
        }

        body {
          margin: 0;
          font-family: 'Manrope', sans-serif;
          color: var(--text-main);
          background:
            radial-gradient(1200px 620px at 2% -8%, color-mix(in srgb, var(--brand-a) 22%, transparent), transparent 65%),
            radial-gradient(980px 560px at 98% -16%, color-mix(in srgb, var(--brand-b) 22%, transparent), transparent 66%),
            radial-gradient(780px 460px at 52% 120%, color-mix(in srgb, var(--brand-c) 12%, transparent), transparent 72%),
            linear-gradient(170deg, var(--bg-start), var(--bg-end));
          transition: background 260ms ease, color 220ms ease;
        }

        h1, h2, h3, h4, .font-bold {
          font-family: 'Sora', 'Manrope', sans-serif;
          letter-spacing: -0.02em;
        }

        .app-shell {
          background:
            radial-gradient(1000px 540px at 9% -4%, color-mix(in srgb, var(--brand-a) 14%, transparent), transparent 66%),
            radial-gradient(920px 580px at 91% -14%, color-mix(in srgb, var(--brand-b) 14%, transparent), transparent 68%),
            linear-gradient(170deg, var(--bg-start), var(--bg-end));
          color: var(--text-main);
          overflow-x: clip;
        }

        .brand-logo-wrap {
          position: relative;
          isolation: isolate;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          background:
            radial-gradient(circle at 30% 24%, rgba(255, 255, 255, 0.16), transparent 42%),
            linear-gradient(145deg, color-mix(in srgb, var(--panel-strong) 86%, transparent), color-mix(in srgb, var(--panel) 88%, transparent));
          border: 1px solid color-mix(in srgb, var(--brand-b) 38%, var(--soft-border));
          box-shadow:
            0 0 0 1px color-mix(in srgb, var(--brand-a) 25%, transparent),
            0 14px 34px color-mix(in srgb, var(--brand-b) 18%, transparent),
            var(--shadow-soft);
          overflow: hidden;
          transition: transform 180ms ease, box-shadow 220ms ease;
        }

        .brand-logo-wrap::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          pointer-events: none;
          background: linear-gradient(130deg, rgba(255, 255, 255, 0.22), transparent 40%);
          z-index: 2;
        }

        .brand-logo-wrap:hover {
          transform: translateY(-1px) scale(1.01);
          box-shadow:
            0 0 0 1px color-mix(in srgb, var(--brand-a) 45%, transparent),
            0 20px 44px color-mix(in srgb, var(--brand-b) 28%, transparent),
            var(--shadow-pop);
        }

        .brand-logo-clickable {
          cursor: pointer;
        }

        .brand-logo-sm {
          width: 56px;
          height: 56px;
          padding: 3px;
        }

        .brand-logo-md {
          width: 104px;
          height: 104px;
          padding: 5px;
        }

        .brand-logo-lg {
          width: 152px;
          height: 152px;
          padding: 7px;
        }

        .brand-logo-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          border-radius: inherit;
          position: relative;
          z-index: 1;
        }

        .app-shell::before {
          content: '';
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 0;
          opacity: 0.34;
          background-image:
            linear-gradient(rgba(148, 163, 184, 0.08) 1px, transparent 1px),
            linear-gradient(90deg, rgba(148, 163, 184, 0.08) 1px, transparent 1px);
          background-size: 56px 56px;
          mask-image: radial-gradient(circle at center, #000 20%, transparent 80%);
        }

        .app-shell::after {
          content: '';
          position: fixed;
          inset: -22vmax;
          pointer-events: none;
          z-index: 0;
          opacity: 0.2;
          background:
            radial-gradient(circle at 18% 28%, color-mix(in srgb, var(--brand-a) 28%, transparent), transparent 36%),
            radial-gradient(circle at 82% 14%, color-mix(in srgb, var(--brand-b) 24%, transparent), transparent 40%),
            radial-gradient(circle at 52% 82%, color-mix(in srgb, var(--brand-c) 20%, transparent), transparent 44%);
          animation: premiumDrift 18s ease-in-out infinite alternate;
        }

        .app-shell > * {
          position: relative;
          z-index: 1;
        }

        .app-shell nav,
        .app-shell [class*='backdrop-blur'] {
          box-shadow: var(--shadow-soft);
          border-color: var(--soft-border) !important;
        }

        .app-shell nav .max-w-7xl {
          max-width: min(1240px, calc(100% - 1.5rem));
          margin-top: 0.72rem;
          border: 1px solid color-mix(in srgb, var(--soft-border) 82%, transparent);
          border-radius: 18px;
          background:
            linear-gradient(130deg, color-mix(in srgb, var(--panel-strong) 92%, transparent), color-mix(in srgb, var(--panel) 90%, transparent));
          box-shadow:
            0 8px 22px color-mix(in srgb, var(--brand-b) 14%, transparent),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
        }

        .app-shell [class*='rounded-2xl'],
        .app-shell [class*='rounded-3xl'] {
          backdrop-filter: blur(14px);
          transition: transform 180ms ease, box-shadow 220ms ease, border-color 180ms ease;
        }

        @media (hover: hover) {
          .app-shell [class*='rounded-2xl']:hover,
          .app-shell [class*='rounded-3xl']:hover {
            transform: translateY(-2px);
            box-shadow: var(--shadow-pop) !important;
            border-color: color-mix(in srgb, var(--brand-b) 42%, var(--soft-border)) !important;
          }
        }

        .app-shell button {
          transition: transform 170ms ease, box-shadow 170ms ease, filter 170ms ease, background-color 170ms ease;
        }

        .app-shell button:hover {
          transform: translateY(-1px);
        }

        .app-shell button:active {
          transform: translateY(0) scale(0.98);
        }

        .app-shell button[class*='from-teal-500'][class*='to-blue-500'] {
          position: relative;
          overflow: hidden;
          box-shadow:
            0 10px 24px color-mix(in srgb, var(--brand-b) 28%, transparent),
            0 4px 12px color-mix(in srgb, var(--brand-a) 24%, transparent);
        }

        .app-shell button[class*='from-teal-500'][class*='to-blue-500']::before {
          content: '';
          position: absolute;
          top: -160%;
          left: -32%;
          width: 44%;
          height: 430%;
          transform: rotate(24deg);
          background: linear-gradient(180deg, transparent, rgba(255, 255, 255, 0.34), transparent);
          transition: left 420ms ease;
        }

        .app-shell button[class*='from-teal-500'][class*='to-blue-500']:hover::before {
          left: 118%;
        }

        .app-shell input,
        .app-shell textarea,
        .app-shell select {
          border-color: var(--soft-border) !important;
          background: color-mix(in srgb, var(--panel) 80%, transparent) !important;
        }

        .app-shell input:focus,
        .app-shell textarea:focus,
        .app-shell select:focus {
          border-color: color-mix(in srgb, var(--brand-a) 65%, #ffffff 35%) !important;
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand-a) 25%, transparent) !important;
        }

        .app-shell [class*='from-slate-950'],
        .app-shell [class*='from-slate-900'],
        .app-shell [class*='via-blue-950'],
        .app-shell [class*='via-blue-900'],
        .app-shell [class*='to-slate-950'],
        .app-shell [class*='to-slate-900'],
        .app-shell [class*='to-teal-900'] {
          background-image:
            linear-gradient(145deg, color-mix(in srgb, var(--panel-strong) 90%, transparent), color-mix(in srgb, var(--panel) 88%, transparent)),
            linear-gradient(130deg, color-mix(in srgb, var(--brand-a) 10%, transparent), color-mix(in srgb, var(--brand-b) 10%, transparent)) !important;
        }

        .app-shell [class*='bg-white/5'],
        .app-shell [class*='bg-white/10'],
        .app-shell [class*='bg-white/15'] {
          background: linear-gradient(150deg, color-mix(in srgb, var(--panel) 88%, transparent), color-mix(in srgb, var(--panel-strong) 90%, transparent)) !important;
          border-color: var(--soft-border) !important;
        }

        .app-shell [class*='shadow-2xl'],
        .app-shell [class*='shadow-xl'],
        .app-shell [class*='shadow-lg'] {
          box-shadow: var(--shadow-pop) !important;
        }

        .theme-light .text-white { color: #0f172a !important; }
        .theme-light .text-gray-300,
        .theme-light .text-gray-400,
        .theme-light .text-gray-500,
        .theme-light .text-slate-300,
        .theme-light .text-slate-400,
        .theme-light .text-blue-200 { color: var(--text-soft) !important; }

        .theme-light [class*='border-white/10'],
        .theme-light [class*='border-white/20'],
        .theme-light [class*='border-white/30'] {
          border-color: var(--soft-border) !important;
        }

        .theme-light button[class*='from-teal-500'],
        .theme-light button[class*='to-blue-500'] {
          color: #ffffff !important;
        }

        .app-shell * {
          scrollbar-width: thin;
          scrollbar-color: color-mix(in srgb, var(--brand-b) 52%, var(--brand-a) 48%) color-mix(in srgb, var(--bg-start) 60%, #0f172a 40%);
        }

        .app-shell *::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }

        .app-shell *::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: linear-gradient(180deg, color-mix(in srgb, var(--brand-a) 75%, #ffffff 25%), color-mix(in srgb, var(--brand-b) 78%, #ffffff 22%));
        }

        .app-shell *::-webkit-scrollbar-track {
          background: color-mix(in srgb, var(--bg-start) 72%, #0f172a 28%);
          border-radius: 999px;
        }

        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(28px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes fadeInRight {
          from { opacity: 0; transform: translateX(24px); }
          to { opacity: 1; transform: translateX(0); }
        }

        @keyframes pageEnter {
          from { opacity: 0; transform: translateY(14px) scale(0.99); filter: blur(4px); }
          to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }

        @keyframes modalDrop {
          from { opacity: 0; transform: translateY(-26px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        @keyframes premiumDrift {
          from { transform: translate3d(-2%, -2%, 0) rotate(0.001deg) scale(1); }
          to { transform: translate3d(2%, 1%, 0) rotate(0.001deg) scale(1.05); }
        }

        .animate-fadeInUp { animation: fadeInUp 0.72s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .animate-fadeInRight { animation: fadeInRight 0.68s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .animate-pageEnter,
        .animate-page-enter { animation: pageEnter 0.56s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .animate-modalDrop,
        .animate-modal-drop { animation: modalDrop 0.26s cubic-bezier(0.16, 1, 0.3, 1) both; }

        @media (max-width: 768px) {
          .app-shell::before {
            background-size: 42px 42px;
            opacity: 0.24;
          }

          .app-shell::after {
            opacity: 0.12;
          }

          .app-shell nav .max-w-7xl {
            max-width: calc(100% - 0.9rem);
            margin-top: 0.45rem;
            border-radius: 14px;
            padding-left: 0.9rem !important;
            padding-right: 0.9rem !important;
            padding-top: 0.72rem !important;
            padding-bottom: 0.72rem !important;
          }

          .brand-logo-sm {
            width: 52px;
            height: 52px;
          }

          .brand-logo-lg {
            width: 128px;
            height: 128px;
          }
        }
      `}</style>
    </div>
  );
};

export default DLRentApp;








