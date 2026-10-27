const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const express = require('express');
const { GoogleGenAI } = require('@google/genai');

// Inisialisasi Gemini API menggunakan Environment Variable
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ==========================================
// 1. SETUP EXPRESS (Server Web & Uptime)
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
                incomes: [],      
                transactions: []  
            };
        }
        const db = userDB[from];

        // Helper Perhitungan Saldo
        const totalPemasukan = db.incomes.reduce((acc, curr) => acc + curr.nominal, 0);
        const totalPengeluaran = db.transactions.reduce((acc, curr) => acc + curr.nominal, 0);
        const saldoSaatIni = totalPemasukan - totalPengeluaran;

        // 1. MENU & BANTUAN
        if (cleanText === '.menu' || cleanText === '.help') {
            await sock.sendMessage(from, { 
                text: `🤖 *BOT KEUANGAN by azizz* 💸\n\n` +
                      `Halo *azizz*! Siap membantu mengontrol keuanganmu agar lebih terarah ✨\n\n` +
                      `📋 *Daftar Perintah:*\n` +
                      `• ➕ \`.rc [jumlah] [keterangan]\` - Tambah saldo / pemasukan\n` +
                      `• 📝 \`.catat [jumlah] [keterangan]\` - Catat pengeluaran\n` +
                      `• 🎯 \`.budget\` - Hitung otomatis alokasi 5 pos keuangan\n` +
                      `• 💰 \`.saldo\` - Cek sisa saldo & total alokasi\n` +
                      `• 📜 \`.history\` - Lihat riwayat transaksi terakhir\n` +
                      `• 🔍 \`.cari [kata kunci]\` - Cari transaksi\n` +
                      `• ↩️ \`.undo\` - Hapus pengeluaran terakhir\n` +
                      `• 📊 \`.rekap\` - Rekap total keuangan\n` +
                      `• 🧹 \`.reset\` - Hapus semua data\n` +
                      `• 📷 *Kirim Foto Struk* - Deteksi otomatis via Gemini AI`
            });
        }

        // 2. PEMASUKAN (.rc 1000000 gajian)
        else if (cleanText.startsWith('.rc')) {
            const args = cleanText.split(' ');
            if (args.length < 3 || isNaN(args[1])) {
                await sock.sendMessage(from, { text: '⚠️ Format salah, azizz! Contoh:\n`.rc 1000000 gajian`' });
                return;
            }

            const nominal = Number(args[1]);
            const keterangan = args.slice(2).join(' ');
            const tanggal = new Date().toLocaleDateString('id-ID');

            db.incomes.push({ nominal, keterangan, tanggal });

            const newTotalInc = db.incomes.reduce((acc, curr) => acc + curr.nominal, 0);
            const newSaldo = newTotalInc - totalPengeluaran;

            await sock.sendMessage(from, { 
                text: `✅ *Pemasukan Berhasil Dicatat, azizz!*\n\n` +
                      `💵 Masuk: Rp ${nominal.toLocaleString('id-ID')}\n` +
                      `🏷️ Keterangan: ${keterangan}\n` +
                      `💰 Total Saldo Sekarang: Rp ${newSaldo.toLocaleString('id-ID')}\n\n` +
                      `💡 Ketik \`.budget\` untuk melihat alokasi 5 pos dari saldo ini!`
            });
        }

        // 3. PEMBAGIAN BUDGET (5 POS KEUANGAN AZIZZ)
        else if (cleanText === '.budget') {
            if (saldoSaatIni <= 0) {
                await sock.sendMessage(from, { 
                    text: `⚠️ *Saldo saat ini Rp ${saldoSaatIni.toLocaleString('id-ID')}*.\nIsi saldo dulu pakai \`.rc [jumlah] [keterangan]\` untuk membuat alokasi budget, azizz!` 
                });
                return;
            }

            // Alokasi Persentase
            const biayaHidup = Math.floor(saldoSaatIni * 0.30);
            const tabungan = Math.floor(saldoSaatIni * 0.25);
            const investasi = Math.floor(saldoSaatIni * 0.25);
            const uangDarurat = Math.floor(saldoSaatIni * 0.10);
            const selfReward = Math.floor(saldoSaatIni * 0.10);

            await sock.sendMessage(from, { 
                text: `🎯 *ALOKASI BUDGET SALDO AZIZZ* 📊\n\n` +
                      `💰 *Total Saldo Aktif*: Rp ${saldoSaatIni.toLocaleString('id-ID')}\n` +
                      `-----------------------------------\n` +
                      `🛍️ *Biaya Hidup (30%)*: Rp ${biayaHidup.toLocaleString('id-ID')}\n` +
                      `   └ Operasional, mandi, facewash, deodoran, dll.\n\n` +
                      `🏦 *Tabungan (25%)*: Rp ${tabungan.toLocaleString('id-ID')}\n` +
                      `   └ Fleksibel/Buffer jika jatan lain habis (wajib catat).\n\n` +
                      `📈 *Investasi (25%)*: Rp ${investasi.toLocaleString('id-ID')}\n` +
                      `   └ 🔒 *LOCKED (Haram Disentuh)* untuk aset masa depan.\n\n` +
                      `🆘 *Uang Darurat (10%)*: Rp ${uangDarurat.toLocaleString('id-ID')}\n` +
                      `   └ 🔒 *LOCKED* khusus hal mendesak tak terduga.\n\n` +
                      `🎁 *Self Reward (10%)*: Rp ${selfReward.toLocaleString('id-ID')}\n` +
                      `   └ Jatah hiburan / jajan / nongkrong.`
            });
        }

        // 4. CEK SALDO (.saldo)
        else if (cleanText === '.saldo') {
            await sock.sendMessage(from, { 
                text: `💰 *STATUS SALDO AZIZZ* 📊\n\n` +
                      `📈 Total Pemasukan: Rp ${totalPemasukan.toLocaleString('id-ID')}\n` +
                      `📉 Total Pengeluaran: Rp ${totalPengeluaran.toLocaleString('id-ID')}\n` +
                      `💵 *Sisa Saldo Bersih*: Rp ${saldoSaatIni.toLocaleString('id-ID')}\n\n` +
                      `💡 Ketik \`.budget\` untuk melihat rincian alokasi 5 pos posisinya.`
            });
        }

        // 5. CATAT PENGELUARAN (.catat 50000 sabun mandi)
        else if (cleanText.startsWith('.catat')) {
            const args = cleanText.split(' ');
            if (args.length < 3 || isNaN(args[1])) {
                await sock.sendMessage(from, { text: '⚠️ Format salah, azizz! Contoh:\n`.catat 50000 sabun mandi`' });
                return;
            }

            const nominal = Number(args[1]);
            const keterangan = args.slice(2).join(' ');
            const tanggal = new Date().toLocaleDateString('id-ID');

            db.transactions.push({ nominal, keterangan, tanggal });

            const sisaSaldoAft = saldoSaatIni - nominal;

            await sock.sendMessage(from, { 
                text: `✅ *Pengeluaran Disimpan, azizz!*\n\n` +
                      `💸 Terpakai: Rp ${nominal.toLocaleString('id-ID')}\n` +
                      `🏷️ Keterangan: ${keterangan}\n` +
                      `💰 Sisa Saldo Utama: Rp ${sisaSaldoAft.toLocaleString('id-ID')}`
            });
        }

        // 6. HISTORY TRANSAKSI (.history)
        else if (cleanText === '.history') {
            if (db.incomes.length === 0 && db.transactions.length === 0) {
                await sock.sendMessage(from, { text: '📭 Belum ada riwayat transaksi nih, azizz.' });
                return;
            }

            let textHistory = `📜 *RIWAYAT KEUANGAN AZIZZ* 📈\n\n`;
            
            if (db.incomes.length > 0) {
                textHistory += `🟢 *Pemasukan Terakhir:*\n`;
                db.incomes.slice(-5).reverse().forEach((t, i) => {
                    textHistory += `${i + 1}. [${t.tanggal}] +Rp ${t.nominal.toLocaleString('id-ID')} - ${t.keterangan}\n`;
                });
                textHistory += `\n`;
            }

            if (db.transactions.length > 0) {
                textHistory += `🔴 *Pengeluaran Terakhir:*\n`;
                db.transactions.slice(-5).reverse().forEach((t, i) => {
                    textHistory += `${i + 1}. [${t.tanggal}] -Rp ${t.nominal.toLocaleString('id-ID')} - ${t.keterangan}\n`;
                });
            }

            await sock.sendMessage(from, { text: textHistory });
        }

        // 7. CARI TRANSAKSI (.cari makan)
        else if (cleanText.startsWith('.cari')) {
            const keyword = cleanText.replace('.cari', '').trim().toLowerCase();
            if (!keyword) {
                await sock.sendMessage(from, { text: '🔍 Masukkan kata kunci pencarian ya, azizz! Contoh: `.cari sabun`' });
                return;
            }

            const resultsInc = db.incomes.filter(t => t.keterangan.toLowerCase().includes(keyword));
            const resultsOut = db.transactions.filter(t => t.keterangan.toLowerCase().includes(keyword));

            if (resultsInc.length === 0 && resultsOut.length === 0) {
                await sock.sendMessage(from, { text: `❌ Nggak ketemu transaksi dengan kata kunci "${keyword}", azizz.` });
            } else {
                let textResult = `🔍 *HASIL PENCARIAN: "${keyword}"*\n\n`;
                if (resultsInc.length > 0) {
                    textResult += `🟢 *Pemasukan:*\n`;
                    resultsInc.forEach((t, i) => {
                        textResult += `${i + 1}. [${t.tanggal}] +Rp ${t.nominal.toLocaleString('id-ID')} - ${t.keterangan}\n`;
                    });
                }
                if (resultsOut.length > 0) {
                    textResult += `\n🔴 *Pengeluaran:*\n`;
                    resultsOut.forEach((t, i) => {
                        textResult += `${i + 1}. [${t.tanggal}] -Rp ${t.nominal.toLocaleString('id-ID')} - ${t.keterangan}\n`;
                    });
                }
                await sock.sendMessage(from, { text: textResult });
            }
        }

        // 8. UNDO TRANSAKSI TERAKHIR (.undo)
        else if (cleanText === '.undo') {
            if (db.transactions.length === 0) {
                await sock.sendMessage(from, { text: '⚠️ Nggak ada pengeluaran yang bisa di-undo, azizz.' });
                return;
            }
            const removed = db.transactions.pop();
            await sock.sendMessage(from, { 
                text: `↩️ *Pengeluaran Terakhir Dihapus (Undo):*\n` +
                      `💸 Rp ${removed.nominal.toLocaleString('id-ID')} - ${removed.keterangan}`
            });
        }

        // 9. REKAPITULASI (.rekap / .report)
        else if (cleanText === '.rekap' || cleanText === '.report') {
            await sock.sendMessage(from, { 
                text: `📊 *REKAPITULASI KEUANGAN AZIZZ*\n\n` +
                      `🟢 Total Pemasukan: Rp ${totalPemasukan.toLocaleString('id-ID')}\n` +
                      `📉 Total Pengeluaran: Rp ${totalPengeluaran.toLocaleString('id-ID')}\n` +
                      `💵 Saldo Bersih: Rp ${saldoSaatIni.toLocaleString('id-ID')}\n` +
                      `📋 Total Catatan: ${db.incomes.length} masuk, ${db.transactions.length} keluar`
            });
        }

        // 10. RESET ALL (.reset)
        else if (cleanText === '.reset') {
            db.transactions = [];
            db.incomes = [];
            await sock.sendMessage(from, { text: `🧹 *Data Berhasil Direset, azizz!* Semua saldo dan riwayat kembali ke nol.` });
        }

        // 11. SCAN STRUK GEMINI AI
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
                                inlineData: { mimeType: 'image/jpeg', data: imageBase64 }
                            },
                            {
                                text: "Analisis struk belanja ini. Berikan jawaban dengan format persis seperti ini tanpa teks lain:\nNOMINAL: [hanya angka total belanjaan, contoh: 45000]\nKET: [nama tempat belanja atau ringkasan singkat barangnya, contoh: Indomaret]"
                            }
                        ]
                    });

                    aiResult = response.text ? response.text.trim() : '';
                    if (aiResult) success = true;
                } catch (error) {
                    console.log(`⚠️ Percobaan ke-${attempts} gagal, mencoba ulang...`);
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
                        text: `✅ *Struk Berhasil Dibaca AI (Masuk Pengeluaran)*:\n\n` +
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
                    text: `❌ Server Gemini AI sedang padat, azizz. Coba kirim ulang fotonya beberapa saat lagi ya!` 
                });
            }
        }
    });
}

startBot();