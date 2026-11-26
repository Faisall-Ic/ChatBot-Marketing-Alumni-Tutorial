# Panduan & Spesifikasi Tugas — Tim App Bagian 2 (WhatsApp Gateway & Docker)

> **PERHATIAN KHUSUS UNTUK AI AGENT (ANTIGRAVITY) & DEVELOPER PARTNER:**
> Baca seluruh dokumen ini sebelum menulis atau mengubah kode apa pun.
> Patuhi **Batas File & Scope** secara ketat. **Jangan** membuat fitur di luar daftar tugas di bawah ini (seperti Mongoose models, AI Gemini, Express routes, atau frontend React Dashboard).

---

## 1. Konteks Proyek & Pembagian Tim

Proyek ini adalah **AI Chatbot Marketing WhatsApp – Alumni Tutorial (ALTO)** berbasis **Node.js (ESM)**, **Express**, **MongoDB**, **Baileys**, dan **Google Gemini API** (anggaran Rp 0).

Pembagian tugas tim (5 orang):
1. **Tim Database (2 orang):** Setup MongoDB Atlas, `connectDB()`, Mongoose Models (`Server/models/`), dan isi data awal `knowledge_base`.
2. **Tim Dashboard (1 orang):** Membuat frontend **React JS** di **repository terpisah** dan deploy terpisah (mengonsumsi REST API dari `Server/`).
3. **Tim App Bagian 1 (Partner Kamu):** Membuat Core `Server/index.js`, AI Orchestrator (`@google/genai`), logika chat & `!aktif`, dan REST API untuk Dashboard.
4. **Tim App Bagian 2 (KAMU — Dokumen Ini):** Membuat **WhatsApp Gateway (`@whiskeysockets/baileys`)**, **template `.env.example`**, update **`.gitignore`**, dan **Dockerization (`Dockerfile`, `docker-compose.yml`, `.dockerignore`)**.

---

## 2. Kondisi Repo Saat Ini (Penting!)

- Root workspace berisi `Server/` dan `.gitignore`. (Folder `Client/` sudah dipisah ke repo lain—**jangan dibuat ulang di repo ini**.)
- `Server/package.json` menggunakan **`"type": "module"` (ES Modules / `import ... from ...`)**. Gunakan sintaks ESM, bukan `require()`.
- `Server/index.js` saat ini membaca `.env` dari **root repository** (`../.env` relatif terhadap `Server/`).
- Node.js lokal versi modern (ESM native). Di Docker gunakan `node:22-alpine` (LTS) agar stabil 24/7.

---

## 3. Aturan Ketat Batas File (Anti-Melenceng)

### A. File yang BOLEH Dibuat / Diubah oleh Bagian 2
1. `Server/package.json` & `Server/package-lock.json` — **HANYA** menambah package kebutuhan Baileys & logging:
   - `@whiskeysockets/baileys`
   - `qrcode-terminal`
   - `@hapi/boom`
   - `pino`
   *(Jangan hapus `dotenv`, `express`, atau `mongoose`.)*
2. `Server/services/whatsappService.js` — modul utama WhatsApp Gateway.
3. `.env.example` (di **root** repo) — template environment variable (tanpa isi secret asli).
4. `.gitignore` (di **root** repo) — tambahkan ignore untuk folder sesi auth Baileys & log sementara.
5. `Server/Dockerfile` — image production untuk `Server/`.
6. `.dockerignore` (di **root** atau `Server/.dockerignore`) — abaikan `node_modules`, `.env`, `auth_info_baileys`, `.git`.
7. `docker-compose.yml` (di **root** repo) — orkestrasi container server dengan `restart: always` dan volume persisten untuk sesi auth Baileys.

### B. File yang DILARANG KERAS Disentuh / Dibuat oleh Bagian 2
- **JANGAN** mengubah `Server/index.js` (akan diintegrasikan oleh Bagian 1 setelah branch ini selesai).
- **JANGAN** membuat atau mengubah `Server/models/*` (milik Tim Database).
- **JANGAN** membuat `Server/routes/*`, `Server/middlewares/*`, `aiService.js`, atau `orchestratorService.js` (milik Bagian 1).
- **JANGAN** menginstall `@google/genai` atau `cors` (milik Bagian 1).
- **JANGAN** membuat folder `Client/` atau kode React apa pun.
- **JANGAN** menyimpan atau commit file `.env` asli maupun folder `auth_info_baileys/` ke Git.

---

## 4. Spesifikasi Teknis Tugas Bagian 2

### Tugas 1: Instalasi Dependencies di `Server/`
Jalankan di dalam folder `Server/`:
```bash
npm install @whiskeysockets/baileys qrcode-terminal @hapi/boom pino
```

### Tugas 2: Modul `Server/services/whatsappService.js`

Modul ini harus mengekspor **3 named exports** berikut (atau named + helper `normalizePhone`) dengan kontrak tepat seperti di bawah agar langsung bisa dipanggil oleh Bagian 1 di `Server/index.js`:

#### Kontrak Export & Signature

1. **`getWaStatus()`** (sinkron)
   Mengembalikan object copy status koneksi WhatsApp saat ini untuk kebutuhan monitoring & QR di Dashboard React:
   ```javascript
   // Nilai status: 'disconnected' | 'connecting' | 'qr' | 'connected'
   {
     status: 'qr',         // string status terkini
     qr: '2@abc...',       // string QR mentah dari Baileys saat status === 'qr', selain itu null
     botNumber: '628xxx'   // nomor WA bot yang tersambung (digits only) saat 'connected', selain itu null
   }
   ```

2. **`sendWhatsAppMessage(phone, text)`** (async)
   - Normalisasi `phone` menjadi format JID `${normalizePhone(phone)}@s.whatsapp.net`.
   - Jika socket belum terhubung (`status !== 'connected'`), lempar Error atau log error yang jelas (jangan crash server).
   - **Simulasi Pengetikan Alami (Wajib sesuai PRD NFR):**
     1. Kirim presence `'composing'` ke JID tujuan.
     2. Tunggu jeda acak atau tetap antara **1000–2000 ms** (misal `1500 ms`).
     3. Kirim presence `'paused'` ke JID tujuan.
     4. Kirim pesan teks `await sock.sendMessage(jid, { text })`.

3. **`startWhatsApp(onIncomingMessage)`** (async)
   Parameter `onIncomingMessage` adalah callback async yang disediakan oleh **Bagian 1 (`orchestratorService`)**.

   **Perilaku wajib di dalam `startWhatsApp`:**
   - **Koneksi & Auth Persisten (FR-01):**
     - Gunakan `useMultiFileAuthState` menyimpan sesi ke folder `Server/auth_info_baileys` (resolve path memakai `import.meta.url` + `__dirname` agar aman dijalankan dari directory mana pun maupun di dalam Docker).
     - Gunakan logger `pino({ level: 'silent' })` agar log terminal tetap bersih dan QR mudah dibaca.
   - **Handling `connection.update`:**
     - Saat ada `qr`:
       - Tampilkan QR di terminal dengan `qrcode-terminal` (`qrcode.generate(qr, { small: true })`).
       - Simpan `status = 'qr'`, `qr = qr`, `botNumber = null`.
     - Saat `connection === 'connecting'`:
       - Set `status = 'connecting'`.
     - Saat `connection === 'open'`:
       - Ambil nomor bot dari `sock.user?.id` (hapus `:device` dan `@s.whatsapp.net`, misal `'628123456:1@s.whatsapp.net'` → `'628123456'`).
       - Set `status = 'connected'`, `qr = null`, `botNumber`.
     - Saat `connection === 'close'`:
       - Set `status = 'disconnected'`, `qr = null`, `botNumber = null`.
       - Cek `statusCode = lastDisconnect?.error?.output?.statusCode` memakai `DisconnectReason` dari Baileys.
       - Jika `statusCode !== DisconnectReason.loggedOut`: lakukan **auto-reconnect** dengan jeda ~3 detik (hindari spam reconnect loop tanpa jeda).
       - Jika `statusCode === DisconnectReason.loggedOut`: log peringatan jelas bahwa sesi logout dan admin harus menghapus folder `auth_info_baileys` lalu scan QR ulang.
   - **Handling `messages.upsert` (FR-02, FR-03, Resiliency NFR):**
     - Proses hanya event dengan `upsert.type === 'notify'`.
     - Bungkus pemrosesan tiap pesan dengan `try ... catch` asinkron agar error satu pesan tidak mematikan server.
     - Abaikan jika `!msg.message`.
     - Ambil `remoteJid = msg.key?.remoteJid || ''`.
     - Abaikan jika `remoteJid === 'status@broadcast'`.
     - **Filter `fromMe` (FR-02):** Abaikan 100% jika `msg.key?.fromMe === true`. *(Catatan: perintah admin `!aktif` menggunakan nomor pribadi admin, bukan nomor bot, sehingga `fromMe` aman diabaikan.)*
     - **Filter Grup (FR-02):** Abaikan 100% jika `remoteJid.endsWith('@g.us')` (hanya chat personal/japri).
     - **Normalisasi Nomor Pengirim:**
       - Jika `remoteJid` memakai `@lid` dan Baileys menyediakan `msg.key?.remoteJidAlt`, prioritaskan `remoteJidAlt` bila berakhiran `@s.whatsapp.net`; jika tidak, ekstrak digit nomor dari `remoteJid` lalu normalisasi (`08xxx` → `628xxx`).
     - **Ekstraksi Pesan Teks vs Media Non-Teks (FR-03):**
       - Unwrap pesan jika terbungkus `ephemeralMessage` / `viewOnceMessage` / `viewOnceMessageV2` bila ada.
       - Ambil teks dari `conversation` atau `extendedTextMessage?.text`.
       - Jika teks kosong/tidak ada, cek apakah pesan merupakan media non-teks (`imageMessage`, `videoMessage`, `audioMessage`, `stickerMessage`, `documentMessage`, `contactMessage`, `locationMessage`, `ptt` / voice note).
       - Jika bukan teks dan bukan media yang dikenal (misal `protocolMessage` / `reactionMessage` kosong), boleh diabaikan agar tidak membalas event sistem.
       - Jika terdeteksi media non-teks: set `isMedia = true` dan `text = ''`.
     - **Panggil Callback Orkestrator (Bagian 1):**
       ```javascript
       const response = await onIncomingMessage({
         phone,       // string digits normalized, contoh: '6281234567890'
         text,        // string isi pesan teks (atau '' jika isMedia === true)
         isMedia,     // boolean
         pushName: msg.pushName || '',
       });
       ```
     - **Eksekusi Instruksi Balasan dari Orkestrator:**
       Orkestrator akan mengembalikan `null` atau object:
       ```javascript
       // Contoh return dari onIncomingMessage:
       // {
       //   replyText: 'Halo Kak...',          // opsional: kirim ke `phone` pengirim
       //   notifyAdminText: 'Eskalasi dari...' // opsional: kirim ke ADMIN_PHONE
       // }
       ```
       - Jika `response?.replyText` ada dan tidak kosong → panggil `await sendWhatsAppMessage(phone, response.replyText)`.
       - Jika `response?.notifyAdminText` ada dan tidak kosong:
         - Baca `process.env.ADMIN_PHONE` (normalisasi dulu, misal `'085794974290'` → `'6285794974290'`).
         - Jika `ADMIN_PHONE` terisi → panggil `await sendWhatsAppMessage(adminPhone, response.notifyAdminText)`.
         - Jika `ADMIN_PHONE` kosong → `console.warn(...)` tanpa melempar crash.

4. **Helper `normalizePhone(rawPhone)`** (boleh diekspor juga)
   - Buang semua karakter non-digit (kecuali setelah membuang `:device` dan `@s.whatsapp.net` / `@lid`).
   - Jika diawali `08`, ubah awalan `0` menjadi `62` (`085794974290` → `6285794974290`).

---

### Tugas 3: File `.env.example` & Update `.gitignore`

1. Buat **`.env.example`** di **root repository** dengan isi tepat berikut:
   ```env
   # Server
   PORT=3000

   # Database (MongoDB Atlas M0 - diisi dari Tim Database)
   MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/alto_chatbot?retryWrites=true&w=majority

   # Google Gemini AI (Free Tier - ambil dari Google AI Studio)
   GEMINI_API_KEY=isi_gemini_api_key_disini
   GEMINI_MODEL=gemini-3.8-flash

   # Konfigurasi Admin & Marketing ALTO
   ADMIN_PHONE=6285794974290
   GOOGLE_FORM_URL=https://forms.gle/PLACEHOLDER_GANTI_LINK_ASLI

   # Keamanan API untuk Dashboard React (repo terpisah)
   CLIENT_URL=http://localhost:5173
   DASHBOARD_API_KEY=
   ```

2. Update **`.gitignore`** di **root repository**:
   Pastikan minimal berisi:
   ```gitignore
   node_modules/
   .env
   auth_info_baileys/
   Server/auth_info_baileys/
   ```

---

### Tugas 4: Setup Docker (`Server/Dockerfile`, `Server/.dockerignore`, `docker-compose.yml`)

Target PRD: aplikasi berjalan 24/7 di PC Lantai 1 (Rp 0) menggunakan Docker & Docker Compose dengan kebijakan `restart: always`.

1. **`Server/.dockerignore`**:
   ```dockerignore
   node_modules
   npm-debug.log
   auth_info_baileys
   .env
   ```

2. **`Server/Dockerfile`**:
   - Base image: `node:22-alpine`
   - `WORKDIR /app`
   - Copy `package*.json`, jalankan `npm ci --omit=dev`
   - Copy seluruh file `Server/`
   - Buat folder `auth_info_baileys` jika perlu
   - `EXPOSE 3000`
   - `CMD ["npm", "start"]`

3. **`docker-compose.yml`** di **root repository**:
   - Service `app` (atau `alto-server`):
     - `build: ./Server`
     - `container_name: alto-chatbot-server`
     - `restart: always`
     - `ports: - "3000:3000"`
     - `env_file: - .env`
     - `volumes: - ./Server/auth_info_baileys:/app/auth_info_baileys` *(wajib agar sesi login WA tidak hilang saat container restart/rebuild!)*

*(Catatan: Di PC developer saat ini Node.js sudah ada tetapi Docker Desktop/Engine mungkin belum terinstall. Pastikan konfigurasi file Docker bersih dan valid sesuai standar Docker Compose v2 tanpa perintah deprecated `version:`.)*

---

## 5. Alur Git & Pengujian Mandiri (Tanpa Mengubah `Server/index.js`)

### Alur Git
1. Pastikan branch `main` terbaru sudah ditarik:
   ```bash
   git checkout main
   git pull origin main
   ```
2. Buat branch khusus untuk tugas Bagian 2:
   ```bash
   git checkout -b feat/wa-gateway-docker
   ```
3. Kerjakan seluruh file sesuai **Bagian 3A** di atas.
4. Cek `git status` dan pastikan **tidak ada file di luar daftar 3A** yang ikut berubah/terbuat (khususnya `Server/index.js`, `Server/models/`, `.env`, `auth_info_baileys/`).
5. Commit dan push ke branch `feat/wa-gateway-docker`:
   ```bash
   git add .
   git commit -m "feat(server): tambah whatsapp gateway baileys dan konfigurasi docker"
   git push -u origin feat/wa-gateway-docker
   ```

### Cara Uji Mandiri `whatsappService.js`
Karena `Server/index.js` belum boleh diubah oleh Bagian 2, lakukan smoke test langsung di folder `Server/` dengan script command sementara (jangan di-commit):

1. Uji sintaks modul ESM:
   ```bash
   node --check services/whatsappService.js
   ```
2. Uji koneksi QR & penerimaan pesan memakai nomor WA testing (bukan nomor resmi kantor) dengan mock callback:
   ```bash
   node -e "import('./services/whatsappService.js').then(({ startWhatsApp, getWaStatus }) => startWhatsApp(async (payload) => { console.log('MASUK:', payload, 'STATUS:', getWaStatus()); return { replyText: payload.isMedia ? 'Mock: media tidak didukung' : 'Mock balasan: ' + payload.text }; }))"
   ```
   **Checklist Lolos Uji:**
   - [ ] QR Code muncul di terminal dan `getWaStatus().status` berubah dari `'qr'` → `'connected'` setelah scan.
   - [ ] Folder `Server/auth_info_baileys/` terbentuk, dan saat command dihentikan lalu dijalankan ulang, bot langsung `'connected'` **tanpa** scan QR ulang.
   - [ ] Mengirim pesan dari nomor pribadi lain mendapat balasan dengan indikator *typing* 1–2 detik.
   - [ ] Pesan di grup WhatsApp (`@g.us`) dan pesan dari nomor bot sendiri (`fromMe`) **diabaikan** (tidak muncul log `MASUK:`).
   - [ ] Mengirim stiker/foto menghasilkan `isMedia: true` dan `text: ''`.
   - [ ] `git status` bersih dari `.env` dan `auth_info_baileys/`.

---

## 6. Catatan Integrasi untuk Bagian 1 (Setelah Branch Ini Selesai)
Setelah `feat/wa-gateway-docker` di-push/merge, Bagian 1 akan:
1. Menghubungkan `startWhatsApp(orchestratorService.handleIncomingMessage)` di `Server/index.js`.
2. Mengekspos `getWaStatus()` pada endpoint `GET /api/wa/status` untuk Dashboard React.
3. Menghubungkan `ADMIN_PHONE` + `GOOGLE_FORM_URL` + `DASHBOARD_API_KEY` + `CLIENT_URL` ke Express & Gemini AI.
