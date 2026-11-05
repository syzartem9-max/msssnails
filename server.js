require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Database = require('better-sqlite3');
const { Bot, InlineKeyboard, GrammyError, HttpError } = require('grammy');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_LOGIN = process.env.ADMIN_LOGIN || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Artemkin3003!';
const WEBAPP_URL = process.env.WEBAPP_URL || `http://localhost:${PORT}`;
const PAYMENT_PHONE = process.env.PAYMENT_PHONE || '+79226466607';
const PAYMENT_NAME = process.env.PAYMENT_NAME || 'Варвара Сергеевна С';
const PAYMENT_BANK = process.env.PAYMENT_BANK || 'Сбербанк';
const PREPAYMENT = parseInt(process.env.PREPAYMENT_AMOUNT || '300');
const ADMIN_TG_ID = process.env.ADMIN_TG_ID || null; // твой Telegram ID для уведомлений

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN не указан в .env');
  process.exit(1);
}

// === База данных ===
const dbPath = path.join(__dirname, 'data', 'msnails.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS slots (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    status TEXT DEFAULT 'available', -- available | pending | booked | cancelled
    client_name TEXT,
    client_username TEXT,
    client_phone TEXT,
    client_tg_id TEXT,
    service TEXT,
    comment TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Предзаполняем текущие записи (занятые слоты)
const existingBookings = [
  { date: '2026-11-06', time: '15:00' },
  { date: '2026-11-08', time: '12:00' },
  { date: '2026-11-10', time: '12:00' },
  { date: '2026-11-11', time: '12:00' },
  { date: '2026-11-11', time: '15:00' },
  { date: '2026-11-13', time: '12:00' },
  { date: '2026-11-13', time: '15:00' },
];

const insertSlot = db.prepare(`
  INSERT OR IGNORE INTO slots (id, date, time, status)
  VALUES (?, ?, ?, 'booked')
`);

existingBookings.forEach(b => {
  insertSlot.run(uuidv4(), b.date, b.time);
});

// === Прайс ===
const PRICE_LIST = {
  extension: [
    { id: 'ext_1_2', name: 'Наращивание длина 1–2', price: 2000 },
    { id: 'ext_3_4', name: 'Наращивание длина 3–4', price: 2300 },
    { id: 'ext_5_6', name: 'Наращивание длина 5–6', price: 2600 },
  ],
  natural: [
    { id: 'gel', name: 'Покрытие гелем', price: 1500 },
    { id: 'model', name: 'Моделирование', price: 1800 },
  ],
  design: [
    { id: 'light', name: 'Дизайн Light', price: 200 },
    { id: 'medium', name: 'Дизайн Medium', price: 400 },
    { id: 'hard', name: 'Дизайн Hard', price: 600 },
    { id: 'french', name: 'Френч', price: 500 },
    { id: 'special', name: 'Втирка / кошачий глаз / битое стекло / аэрограф / сухоцветы', price: 300 },
  ],
  extra: [
    { id: 'remove_combo', name: 'Снятие + комбинированный маникюр', price: 1200 },
    { id: 'combo', name: 'Комбинированный маникюр', price: 1000 },
    { id: 'remove_other', name: 'Снятие работы другого мастера', price: 300 },
    { id: 'remove_my', name: 'Снятие моей работы без дальнейшей процедуры', price: 300 },
  ]
};

// === Middleware ===
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Простая проверка админ-сессии
function checkAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const session = db.prepare('SELECT * FROM admin_sessions WHERE token = ?').get(token);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// === API ===

// Получить прайс
app.get('/api/price', (req, res) => {
  res.json(PRICE_LIST);
});

// Получить доступные слоты (только available)
app.get('/api/slots', (req, res) => {
  const slots = db.prepare(`
    SELECT id, date, time FROM slots 
    WHERE status = 'available' 
    AND date >= date('now')
    ORDER BY date, time
  `).all();
  res.json(slots);
});

// Все слоты для админа
app.get('/api/admin/slots', checkAdmin, (req, res) => {
  const slots = db.prepare(`
    SELECT * FROM slots 
    WHERE date >= date('now', '-7 days')
    ORDER BY date, time
  `).all();
  res.json(slots);
});

// Создать слот (админ)
app.post('/api/admin/slots', checkAdmin, (req, res) => {
  const { date, time } = req.body;
  if (!date || !time) return res.status(400).json({ error: 'date and time required' });

  const exists = db.prepare('SELECT id FROM slots WHERE date = ? AND time = ?').get(date, time);
  if (exists) return res.status(400).json({ error: 'Слот уже существует' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO slots (id, date, time, status) VALUES (?, ?, ?, 'available')
  `).run(id, date, time);

  res.json({ id, date, time, status: 'available' });
});

// Удалить / отменить слот
app.delete('/api/admin/slots/:id', checkAdmin, (req, res) => {
  db.prepare('DELETE FROM slots WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Изменить статус слота (подтвердить оплату и т.д.)
app.patch('/api/admin/slots/:id', checkAdmin, (req, res) => {
  const { status, client_name, client_username, client_phone, service, comment } = req.body;
  const allowed = ['available', 'pending', 'booked', 'cancelled'];
  if (status && !allowed.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const updates = [];
  const values = [];

  if (status) { updates.push('status = ?'); values.push(status); }
  if (client_name !== undefined) { updates.push('client_name = ?'); values.push(client_name); }
  if (client_username !== undefined) { updates.push('client_username = ?'); values.push(client_username); }
  if (client_phone !== undefined) { updates.push('client_phone = ?'); values.push(client_phone); }
  if (service !== undefined) { updates.push('service = ?'); values.push(service); }
  if (comment !== undefined) { updates.push('comment = ?'); values.push(comment); }

  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);

  db.prepare(`UPDATE slots SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ ok: true });
});

// Создать заявку на запись (клиент)
app.post('/api/book', (req, res) => {
  const { slot_id, client_name, client_username, client_phone, service, comment, tg_id } = req.body;

  if (!slot_id || !client_name || !client_phone) {
    return res.status(400).json({ error: 'Заполните все обязательные поля' });
  }

  const slot = db.prepare('SELECT * FROM slots WHERE id = ?').get(slot_id);
  if (!slot) return res.status(404).json({ error: 'Слот не найден' });
  if (slot.status !== 'available') return res.status(400).json({ error: 'Слот уже занят' });

  db.prepare(`
    UPDATE slots SET 
      status = 'pending',
      client_name = ?,
      client_username = ?,
      client_phone = ?,
      client_tg_id = ?,
      service = ?,
      comment = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(client_name, client_username || '', client_phone, tg_id || '', service || '', comment || '', slot_id);

  // Уведомление админу в бот
  notifyAdminNewBooking({
    date: slot.date,
    time: slot.time,
    name: client_name,
    username: client_username,
    phone: client_phone,
    service,
    comment
  });

  res.json({ ok: true, message: 'Заявка создана. Оплатите предоплату и нажмите «Я оплатил»' });
});

// Клиент нажал «Я оплатил»
app.post('/api/paid', (req, res) => {
  const { slot_id, tg_id } = req.body;
  const slot = db.prepare('SELECT * FROM slots WHERE id = ?').get(slot_id);
  if (!slot) return res.status(404).json({ error: 'Слот не найден' });

  // Статус остаётся pending, админ подтвердит
  notifyAdminPaymentClaimed(slot);

  res.json({ ok: true, message: 'Спасибо! Админ проверит оплату и подтвердит запись.' });
});

// Генерация QR для оплаты
app.get('/api/qr', async (req, res) => {
  const username = req.query.username || 'username';
  const text = `Перевод ${PREPAYMENT} ₽\nСбербанк: ${PAYMENT_PHONE}\n${PAYMENT_NAME}\n\nВ комментарии укажите: @${username.replace('@', '')}`;

  try {
    const qr = await QRCode.toDataURL(text, {
      width: 300,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    });
    res.json({ qr, phone: PAYMENT_PHONE, name: PAYMENT_NAME, bank: PAYMENT_BANK, amount: PREPAYMENT });
  } catch (e) {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

// Логин админа
app.post('/api/admin/login', (req, res) => {
  const { login, password } = req.body;
  if (login === ADMIN_LOGIN && password === ADMIN_PASSWORD) {
    const token = uuidv4();
    db.prepare('INSERT INTO admin_sessions (token) VALUES (?)').run(token);
    // Чистим старые сессии (старше 7 дней)
    db.prepare("DELETE FROM admin_sessions WHERE created_at < datetime('now', '-7 days')").run();
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Неверный логин или пароль' });
  }
});

// === Telegram Bot ===
const bot = new Bot(BOT_TOKEN);

bot.command('start', async (ctx) => {
  const keyboard = new InlineKeyboard()
    .webApp('💅 Записаться на маникюр', WEBAPP_URL);

  await ctx.reply(
    `Привет! ✨\n\nЭто бот записи в *MS_NAILS*.\n\nНажми кнопку ниже, чтобы открыть приложение и выбрать удобное время.`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
});

bot.command('admin', async (ctx) => {
  await ctx.reply(
    `Админ-панель доступна внутри Mini App.\n\nОткрой приложение → внизу «Админ» → введи логин и пароль.`
  );
});

async function notifyAdminNewBooking(data) {
  console.log('📩 Новая заявка:', data);
  if (!ADMIN_TG_ID) return;
  try {
    const text = `📩 *Новая заявка на запись*\n\n📅 ${data.date} в ${data.time}\n👤 ${data.name}\n📞 ${data.phone}\n${data.username ? '@' + data.username.replace('@','') + '\n' : ''}${data.service ? '💅 ' + data.service + '\n' : ''}${data.comment ? '💬 ' + data.comment : ''}`;
    await bot.api.sendMessage(ADMIN_TG_ID, text, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('Не удалось отправить уведомление админу:', e.message);
  }
}

async function notifyAdminPaymentClaimed(slot) {
  console.log('💳 Клиент заявил оплату:', slot);
  if (!ADMIN_TG_ID) return;
  try {
    const text = `💳 *Клиент нажал «Я оплатил»*\n\n📅 ${slot.date} в ${slot.time}\n👤 ${slot.client_name}\n📞 ${slot.client_phone}\n${slot.client_username ? '@' + slot.client_username.replace('@','') : ''}\n\nПроверь перевод и подтверди в админ-панели.`;
    await bot.api.sendMessage(ADMIN_TG_ID, text, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('Не удалось отправить уведомление админу:', e.message);
  }
}

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Error while handling update ${ctx.update.update_id}:`);
  const e = err.error;
  if (e instanceof GrammyError) {
    console.error('Grammy error:', e.description);
  } else if (e instanceof HttpError) {
    console.error('HTTP error:', e);
  } else {
    console.error('Unknown error:', e);
  }
});

// Запуск
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Mini App URL: ${WEBAPP_URL}`);
});

bot.start({
  onStart: (info) => console.log(`🤖 Bot @${info.username} started`)
});
