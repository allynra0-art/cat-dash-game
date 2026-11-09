# CAT DASH Multiplayer — Panduan pemasangan

Proyek React + Vite + Supabase. Semua orang bisa membuat kuis, membuat room, atau masuk menggunakan kode 6 digit. **Tidak ada soal bawaan**. Versi awal mendukung 1–10 pemain/room, quiz manual maksimal 50 soal, dan balapan real-time berbasis server.

## A. Siapkan Supabase
1. Buka https://supabase.com/dashboard dan buat project baru. Tunggu database siap.
2. Di **Authentication → Providers → Anonymous**, aktifkan **Allow anonymous sign-ins**. (Letak menu bisa berubah.)
3. Di **SQL Editor → New query**, salin seluruh `supabase/setup.sql`, lalu klik **Run**. Jalankan sekali. Ini membuat tabel, RLS, fungsi room dan Realtime.
4. Di **Project Settings → API Keys** (atau Connect/API), salin **Project URL** dan **publishable key / anon public key**. **JANGAN** pakai service_role atau secret key di browser.

## B. Buka di StackBlitz
**Cara yang paling sederhana:** unggah proyek ke GitHub lalu pilih Import Repository di StackBlitz; atau buat proyek React Vite baru dan salin file/folder dari ZIP sesuai strukturnya. Jangan taruh seluruh proyek dalam subfolder `src`.

1. `package.json`, `index.html`, dan `.env` di akar proyek.
2. `src/App.jsx`, `src/App.css`, `src/main.jsx`, `src/supabase.js` di folder `src`.
3. `public/assets/characters/*.png` di folder `public/assets/characters`.
4. Buat file `.env` dari `.env.example`, lalu isi:

```
VITE_SUPABASE_URL=https://PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```

5. Terminal: `npm install`, lalu `npm run dev`. Jika mengubah `.env`, restart server.
6. **Jangan gunakan plugin-react@6 dengan Vite 5**. Proyek ini sudah menggunakan `@vitejs/plugin-react@4`.

## C. Uji mabar
1. Buka game sebagai pemain A, buat kuis manual (minimal 1 soal), simpan.
2. Isi nama, pilih kucing, pilih kuis, klik **BUAT ROOM**. Catat kode 6 digit.
3. Pemain B membuka URL game yang **sama** di browser/perangkat lain. Masukkan nama, pilih kucing, klik **GABUNG ROOM**, masukkan kode.
4. Pemain A menekan **MULAI BALAPAN**.
5. Tahan `D`/panah kanan untuk lari, `Shift` untuk sprint, atau tombol tahan pada layar sentuh. Energi habis → jawab kuis. Posisi dan leaderboard diperbarui antar perangkat.

**Penting:** URL editor StackBlitz tidak selalu cocok dibagikan untuk bermain. Untuk mabar yang stabil, deploy situs ke hosting publik (mis. Netlify atau Vercel) dan bagikan URL deploy ke semua pemain.

## D. Batasan versi pertama
- Ini **prototipe multiplayer**, bukan game produksi yang telah melalui uji beban/keamanan menyeluruh.
- Kuis milik akun anonim yang tersimpan di browser; jika data browser dihapus, identitas pembuat bisa hilang. Untuk penggunaan serius, tambahkan login akun dan fitur pengelolaan kuis.
- Belum ada AI generator, timer kuis 15 detik, tombol lompat, matchmaking publik, reconnect yang matang, animasi karakter frame-by-frame, atau perlindungan spam tingkat produksi.
- Movement memakai RPC Supabase sekitar 4 kali/detik per pemain dan membaca status berkala. Pada banyak room, biaya/kuota dapat bertambah. Gunakan rate limiting dan backend game khusus bila skala besar.
- Realtime memakai perubahan Postgres plus polling cadangan. Untuk fitur produksi gunakan broadcast/presence dan validasi lebih lanjut.
- Periksa kebijakan keamanan Supabase untuk autentikasi anonim (mis. CAPTCHA/rate limit) sebelum aplikasi dipublikasikan luas.
