const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const express = require('express');
const { GoogleGenAI } = require('@google/genai');

// Inisialisasi Gemini API menggunakan Environment Variable (aman untuk GitHub & Render)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ==========================================
// 1. SETUP EXPRESS (Server Web & UptimeRobot)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🤖 Bot WhatsApp Baileys Keuangan Aktif 24/7!');
});

app.listen(PORT, () => {
    console.log(`🚀 Web server jalan di port ${PORT}`);
});

// Database sementara (Memory Storage) per pengguna
const userDB = {};

// ==========================================
// 2. SETUP WHATSAPP SOCKET (BAILEYS)
// ==========================================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('📱 QR RECEIVED, scan pakai WhatsApp HP kamu ya, azizz!');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.log('⚠️ Koneksi terputus, mencoba menghubungkan ulang...', reason);
            startBot();
        } else if (connection === 'open') {
            console.log('🎉 Mantap! Bot WhatsApp Baileys Keuangan Full fitur terhubung.');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // ==========================================
    // 3. LOGIKA UTAMA & FITUR LENGKAP KEUANGAN
    // ==========================================
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || '';
        const from = msg.key.remoteJid;
        const isImage = !!msg.message.imageMessage;
        const cleanText = text.trim();

        // Inisialisasi data user jika belum ada
        if (!userDB[from]) {
            userDB[from] = {
                saldo: 0,
                budget: 0,
                transactions: []
            };
        }
        const db = userDB[from];

        // 1. MENU & BANTUAN
        if (cleanText === '.menu' || cleanText === '.help') {
            await sock.sendMessage(from, { 
                text: `🤖 *BOT KEUANGAN SATSET* 💸\n\n` +
                      `Halo *azizz*! Siap membantu mengontrol keuanganmu agar lebih terarah ✨\n\n` +
                      `📋 *Daftar Perintah:*\n` +
                      `• 📝 \`.catat [jumlah] [keterangan]\` - Catat pengeluaran\n` +
                      `• 🎯 \`.budget [jumlah]\` - Atur batas budget bulanan\n` +
                      `• 💰 \`.saldo\` - Cek sisa saldo & status budget\n` +
                      `• 📜 \`.history\` - Lihat riwayat transaksi terakhir\n` +
                      `• 🔍 \`.cari [kata kunci]\` - Cari transaksi\n` +
                      `• ↩️ \`.undo\` - Hapus transaksi terakhir\n` +
                      `• 📊 \`.report\` / \`.rekap\` - Rekapitulasi keuangan\n` +
                      `• 🧹 \`.reset\` - Hapus semua data\n` +
                      `• 📷 *Kirim Foto Struk* - Deteksi otomatis via Gemini AI`
            });
        }

        // 2. ATUR BUDGET (.budget 1000000)
        else if (cleanText.startsWith('.budget')) {
            const args = cleanText.split(' ');
            if (args.length < 2 || isNaN(args[1])) {
                await sock.sendMessage(from, { text: '⚠️ Format salah, azizz! Contoh yang benar:\n`.budget 1000000`' });
                return;
            }
            db.budget = Number(args[1]);
            await sock.sendMessage(from, { text: `🎯 *Budget Berhasil Diset, azizz!*\n💡 Batas pengeluaran: Rp ${db.budget.toLocaleString('id-ID')}` });
        }

        // 3. CEK SALDO / STATUS BUDGET (.saldo)
        else if (cleanText === '.saldo') {
            const totalPengeluaran = db.transactions.reduce((acc, curr) => acc + curr.nominal, 0);
            const sisaBudget = db.budget > 0 ? db.budget - totalPengeluaran : 'Belum diset';
            
            await sock.sendMessage(from, { 
                text: `💰 *STATUS KEUANGAN AZIZZ* 📊\n\n` +
                      `📉 Total Pengeluaran: Rp ${totalPengeluaran.toLocaleString('id-ID')}\n` +
                      `🎯 Budget Bulanan: ${typeof db.budget === 'number' && db.budget > 0 ? 'Rp ' + db.budget.toLocaleString('id-ID') : db.budget}\n` +
                      `💵 Sisa Budget: ${typeof sisaBudget === 'number' ? 'Rp ' + sisaBudget.toLocaleString('id-ID') : sisaBudget}`
            });
        }

        // 4. CATAT TRANSAKSI (.catat 50000 makan siang)
        else if (cleanText.startsWith('.catat')) {
            const args = cleanText.split(' ');
            if (args.length < 3 || isNaN(args[1])) {
                await sock.sendMessage(from, { text: '⚠️ Format salah, azizz! Contoh:\n`.catat 50000 makan siang`' });
                return;
            }

            const nominal = Number(args[1]);
            const keterangan = args.slice(2).join(' ');
            const tanggal = new Date().toLocaleDateString('id-ID');

            db.transactions.push({ nominal, keterangan, tanggal });

            await sock.sendMessage(from, { 
                text: `✅ *Catatan Berhasil Disimpan, azizz!*\n\n` +
                      `💵 Nominal: Rp ${nominal.toLocaleString('id-ID')}\n` +
                      `🏷️ Keterangan: ${keterangan}\n` +
                      `📅 Tanggal: ${tanggal}`
            });
        }

        // 5. HISTORY TRANSAKSI (.history)
        else if (cleanText === '.history') {
            if (db.transactions.length === 0) {
                await sock.sendMessage(from, { text: '📭 Belum ada riwayat transaksi nih, azizz.' });
                return;
            }

            let textHistory = `📜 *RIWAYAT TRANSAKSI AZIZZ* 📈\n\n`;
            const last10 = db.transactions.slice(-10).reverse();
            last10.forEach((t, i) => {
                textHistory += `${i + 1}. [${t.tanggal}] Rp ${t.nominal.toLocaleString('id-ID')} - ${t.keterangan}\n`;
            });

            await sock.sendMessage(from, { text: textHistory });
        }

        // 6. CARI TRANSAKSI (.cari makan)
        else if (cleanText.startsWith('.cari')) {
            const keyword = cleanText.replace('.cari', '').trim().toLowerCase();
            if (!keyword) {
                await sock.sendMessage(from, { text: '🔍 Masukkan kata kunci pencarian ya, azizz! Contoh: `.cari makan`' });
                return;
            }

            const results = db.transactions.filter(t => t.keterangan.toLowerCase().includes(keyword));
            if (results.length === 0) {
                await sock.sendMessage(from, { text: `❌ Nggak ketemu transaksi dengan kata kunci "${keyword}", azizz.` });
            } else {
                let textResult = `🔍 *HASIL PENCARIAN: "${keyword}"*\n\n`;
                results.forEach((t, i) => {
                    textResult += `${i + 1}. [${t.tanggal}] Rp ${t.nominal.toLocaleString('id-ID')} - ${t.keterangan}\n`;
                });
                await sock.sendMessage(from, { text: textResult });
            }
        }

        // 7. UNDO TRANSAKSI TERAKHIR (.undo)
        else if (cleanText === '.undo') {
            if (db.transactions.length === 0) {
                await sock.sendMessage(from, { text: '⚠️ Nggak ada transaksi yang bisa di-undo, azizz.' });
                return;
            }
            const removed = db.transactions.pop();
            await sock.sendMessage(from, { 
                text: `↩️ *Transaksi Terakhir Dihapus (Undo):*\n` +
                      `💸 Rp ${removed.nominal.toLocaleString('id-ID')} - ${removed.keterangan}`
            });
        }

        // 8. REPORT / REKAP (.report atau .rekap)
        else if (cleanText === '.report' || cleanText === '.rekap') {
            const total = db.transactions.reduce((acc, curr) => acc + curr.nominal, 0);
            await sock.sendMessage(from, { 
                text: `📊 *REKAPITULASI KEUANGAN AZIZZ*\n\n` +
                      `📋 Total Transaksi: ${db.transactions.length} item\n` +
                      `📉 Total Pengeluaran: Rp ${total.toLocaleString('id-ID')}\n` +
                      `✨ Semua aman terkendali!`
            });
        }

        // 9. RESET SEMUA DATA (.reset)
        else if (cleanText === '.reset') {
            db.transactions = [];
            db.budget = 0;
            await sock.sendMessage(from, { text: `🧹 *Data Berhasil Direset, azizz!* Semua riwayat dan budget dikembalikan ke nol.` });
        }

        // 10. SCAN FOTO STRUK MENGGUNAKAN GEMINI AI VISION (DENGAN AUTO-RETRY)
        else if (isImage) {
            await sock.sendMessage(from, { 
                text: `📷 *Foto Struk Diterima!*\n🧠 Sedang dianalisis oleh Gemini AI, sebentar ya, azizz...` 
            });

            let success = false;
            let aiResult = '';
            let attempts = 0;
            const maxAttempts = 3;

            while (!success && attempts < maxAttempts) {
                attempts++;
                try {
                    const buffer = await downloadMediaMessage(
                        msg,
                        'buffer',
                        {},
                        { logger: pino({ level: 'silent' }) }
                    );

                    const imageBase64 = buffer.toString('base64');

                    const response = await ai.models.generateContent({
                        model: 'gemini-2.5-flash',
                        contents: [
                            {
                                inlineData: {
                                    mimeType: 'image/jpeg',
                                    data: imageBase64
                                }
                            },
                            {
                                text: "Analisis struk belanja ini. Berikan jawaban dengan format persis seperti ini tanpa teks lain:\nNOMINAL: [hanya angka total belanjaan, contoh: 45000]\nKET: [nama tempat belanja atau ringkasan singkat barangnya, contoh: Indomaret]"
                            }
                        ]
                    });

                    aiResult = response.text ? response.text.trim() : '';
                    if (aiResult) {
                        success = true;
                    }
                } catch (error) {
                    console.log(`⚠️ Percobaan ke-${attempts} gagal (Server sibuk/503), mencoba ulang...`);
                    if (attempts >= maxAttempts) {
                        console.error('Error Gemini AI Detail:', error);
                    } else {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
            }

            if (success) {
                const nominalMatch = aiResult.match(/NOMINAL:\s*(\d+)/i);
                const ketMatch = aiResult.match(/KET:\s*(.+)/i);

                const nominal = nominalMatch ? Number(nominalMatch[1]) : 0;
                const keterangan = ketMatch ? ketMatch[1].trim() : 'Belanja via Scan AI Struk';

                if (nominal > 0) {
                    const tanggal = new Date().toLocaleDateString('id-ID');
                    db.transactions.push({ nominal, keterangan, tanggal });

                    await sock.sendMessage(from, {
                        text: `✅ *Struk Berhasil Dibaca AI, azizz!*\n\n` +
                              `💵 Total: Rp ${nominal.toLocaleString('id-ID')}\n` +
                              `🏷️ Keterangan: ${keterangan}\n` +
                              `📅 Tanggal: ${tanggal}`
                    });
                } else {
                    await sock.sendMessage(from, {
                        text: `⚠️ *AI Gagal Membaca Nominal*, azizz.\nRespon AI: ${aiResult}\nCoba catat manual pakai \`.catat [jumlah] [ket]\` ya!`
                    });
                }
            } else {
                await sock.sendMessage(from, { 
                    text: `❌ Server Gemini AI sedang padat banget (Error 503), azizz. Coba kirim ulang fotonya beberapa saat lagi ya!` 
                });
            }
        }
    });
}

startBot();