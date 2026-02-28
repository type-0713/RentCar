import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const savedLang =
  typeof window !== 'undefined' ? localStorage.getItem('dlrent_lang') : null;
const initialLang = savedLang === 'ru' ? 'ru' : 'en';

const resources = {
  en: {
    translation: {
      nav: {
        home: 'Home',
        fleet: 'Fleet',
        about: 'About',
        contact: 'Contact',
        light: 'Light',
        dark: 'Dark',
        logout: 'Logout',
        admin: 'Admin',
        user: 'User'
      },
      login: {
        welcomeBack: 'Welcome Back',
        subtitle: 'Continue with email/password or social sign-in',
        email: 'Email',
        password: 'Password',
        continue: 'Continue',
        processing: 'Processing...',
        or: 'or',
        google: 'Google',
        apple: 'Apple',
        microsoft: 'Microsoft',
        userAuth: 'User Auth',
        userAuthLine1: 'Sign in with Google, Apple or Microsoft',
        userAuthLine2: 'Email/password user auth is enabled',
        adminDemo: 'Admin Demo',
        adminEmail: 'Email',
        adminPass: 'Pass',
        adminPassWrong: 'Admin password is incorrect',
        passwordShort: 'Password must be at least 8 characters.',
        authFailed: 'Authentication failed'
      },
      home: {
        badge: 'Welcome to Premium Rentals',
        title1: 'Drive Your Dream',
        title2: 'With Confidence',
        desc: 'Experience premium car rentals with full insurance coverage, 24/7 support, and direct communication with our admin team.',
        browse: 'Browse Cars',
        contact: 'Contact Us',
        featured: 'Premium comfort & performance',
        carsAvailable: 'Cars Available',
        clientRating: 'Client Rating'
      },
      carpark: {
        title: 'Our Fleet',
        searchPlaceholder: 'Search by car name, feature or price...',
        noCars: 'No cars available at the moment',
        allBooked: 'All cars are currently booked.',
        noMatch: 'No cars matched your search.',
        clearSearch: 'Clear Search',
        bookNow: 'Book Now'
      },
      detail: {
        noAvailableCar: 'No Available Car',
        chooseAvailable: 'Please choose an available car from the fleet.',
        goToFleet: 'Go to Fleet',
        backToFleet: 'Back to Fleet',
        startingFrom: 'Starting from',
        perDayIncluded: 'Per day, insurance included',
        availableNow: 'Available now',
        reserveNow: 'Reserve Now',
        outOfStock: 'Out of Stock',
        noHiddenFees: 'No hidden fees. You can chat with admin after booking.',
        reserveTitle: 'Reserve',
        reserveDesc: 'Please enter your phone number. Admin will use this number to contact you.',
        confirmReserve: 'Confirm Reserve',
        cancel: 'Cancel'
      },
      chat: {
        noMessages: 'No messages yet. Start the conversation!',
        typeMessage: 'Type your message...',
        sending: 'Sending...',
        send: 'Send'
      },
      about: {
        title: 'About This Project'
      },
      contacts: {
        title: 'Contact Us',
        subtitle: 'Find us across Bulgaria'
      },
      admin: {
        title: 'Admin Dashboard',
        subtitle: 'Manage cars, bookings, and customer messages',
        totalCars: 'Total Cars (Units)',
        activeBookings: 'Active Bookings',
        totalMessages: 'Total Messages',
        unreadMessages: 'Unread Messages',
        carsManagement: 'Cars Management',
        addNewCar: 'Add New Car'
      }
    }
  },
  ru: {
    translation: {
      nav: {
        home: 'Главная',
        fleet: 'Автопарк',
        about: 'О проекте',
        contact: 'Контакты',
        light: 'Светлая',
        dark: 'Тёмная',
        logout: 'Выйти',
        admin: 'Админ',
        user: 'Пользователь'
      },
      login: {
        welcomeBack: 'С возвращением',
        subtitle: 'Продолжить с email/паролем или через соцвход',
        email: 'Эл. почта',
        password: 'Пароль',
        continue: 'Продолжить',
        processing: 'Обработка...',
        or: 'или',
        google: 'Google',
        apple: 'Apple',
        microsoft: 'Microsoft',
        userAuth: 'Вход пользователя',
        userAuthLine1: 'Войдите через Google, Apple или Microsoft',
        userAuthLine2: 'Вход по email/паролю включен',
        adminDemo: 'Демо админа',
        adminEmail: 'Почта',
        adminPass: 'Пароль',
        adminPassWrong: 'Неверный пароль администратора',
        passwordShort: 'Пароль должен содержать минимум 8 символов.',
        authFailed: 'Ошибка авторизации'
      },
      home: {
        badge: 'Добро пожаловать в Premium Rentals',
        title1: 'Управляй мечтой',
        title2: 'С уверенностью',
        desc: 'Премиальная аренда авто с полной страховкой, поддержкой 24/7 и прямой связью с админом.',
        browse: 'Смотреть авто',
        contact: 'Связаться',
        featured: 'Премиум комфорт и динамика',
        carsAvailable: 'машин доступно',
        clientRating: 'Рейтинг клиентов'
      },
      carpark: {
        title: 'Наш автопарк',
        searchPlaceholder: 'Поиск по названию, функции или цене...',
        noCars: 'Сейчас нет доступных машин',
        allBooked: 'Все машины сейчас забронированы.',
        noMatch: 'Поиск не дал результатов.',
        clearSearch: 'Очистить поиск',
        bookNow: 'Забронировать'
      },
      detail: {
        noAvailableCar: 'Нет доступных авто',
        chooseAvailable: 'Пожалуйста, выберите доступный автомобиль из автопарка.',
        goToFleet: 'К автопарку',
        backToFleet: 'Назад к автопарку',
        startingFrom: 'Цена от',
        perDayIncluded: 'В день, страховка включена',
        availableNow: 'Сейчас доступно',
        reserveNow: 'Забронировать',
        outOfStock: 'Нет в наличии',
        noHiddenFees: 'Без скрытых платежей. После брони можно написать админу.',
        reserveTitle: 'Бронь',
        reserveDesc: 'Введите номер телефона. Админ свяжется с вами по этому номеру.',
        confirmReserve: 'Подтвердить бронь',
        cancel: 'Отмена'
      },
      chat: {
        noMessages: 'Сообщений пока нет. Начните диалог!',
        typeMessage: 'Введите сообщение...',
        sending: 'Отправка...',
        send: 'Отправить'
      },
      about: {
        title: 'О проекте'
      },
      contacts: {
        title: 'Контакты',
        subtitle: 'Мы работаем по всей Болгарии'
      },
      admin: {
        title: 'Панель администратора',
        subtitle: 'Управление авто, бронями и сообщениями',
        totalCars: 'Всего авто (ед.)',
        activeBookings: 'Активные брони',
        totalMessages: 'Всего сообщений',
        unreadMessages: 'Непрочитанные сообщения',
        carsManagement: 'Управление авто',
        addNewCar: 'Добавить авто'
      }
    }
  }
};

i18n.use(initReactI18next).init({
  resources,
  lng: initialLang,
  supportedLngs: ['en', 'ru'],
  nonExplicitSupportedLngs: true,
  load: 'languageOnly',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
});

if (typeof window !== 'undefined') {
  i18n.on('languageChanged', (lang) => {
    localStorage.setItem('dlrent_lang', lang);
    document.documentElement.lang = lang;
  });
  document.documentElement.lang = i18n.language;
}

export default i18n;
