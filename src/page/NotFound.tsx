import { Link } from 'react-router-dom';
import brandLogo from '../assets/image.png';

const NotFound = () => {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[radial-gradient(1200px_650px_at_10%_-10%,rgba(20,184,166,0.16),transparent_60%),radial-gradient(1000px_600px_at_100%_-20%,rgba(59,130,246,0.2),transparent_60%),linear-gradient(170deg,#060b17,#12274e)]">
      <div className="w-full max-w-2xl rounded-3xl border border-white/20 bg-white/10 backdrop-blur-xl shadow-[0_24px_70px_rgba(2,6,23,0.55)] p-8 sm:p-12 text-center">
        <div className="mx-auto mb-6 w-28 h-28 sm:w-36 sm:h-36 rounded-full p-1 border border-cyan-300/50 bg-slate-900/70 shadow-[0_0_40px_rgba(34,211,238,0.35)]">
          <img src={brandLogo} alt="DL Rent Logo" className="w-full h-full object-cover rounded-full" />
        </div>
        <p className="text-cyan-200 text-sm tracking-[0.28em] uppercase mb-3">DL Rent</p>
        <h1 className="text-white font-extrabold text-5xl sm:text-7xl leading-none mb-4">404</h1>
        <p className="text-slate-200 text-lg sm:text-xl font-semibold mb-2">Sahifa topilmadi</p>
        <p className="text-slate-300 max-w-xl mx-auto mb-8">
          Siz qidirgan sahifa mavjud emas yoki manzil o‘zgargan bo‘lishi mumkin.
        </p>
        <Link
          to="/dl-rent"
          className="inline-flex items-center justify-center rounded-xl px-6 py-3 font-semibold text-white bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-400 hover:to-blue-400 transition-transform hover:scale-[1.03] shadow-[0_16px_34px_rgba(37,99,235,0.35)]"
        >
          Bosh sahifaga qaytish
        </Link>
      </div>
    </div>
  );
};
export default NotFound;