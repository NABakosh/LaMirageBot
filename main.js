// WhatsApp Bot для салона красоты La Mirage Beauty
// npm install whatsapp-web.js qrcode-terminal @google/generative-ai googleapis dotenv pg

require("dotenv").config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { google } = require("googleapis");
const { Pool } = require("pg");
const cron = require("node-cron");

// ===================== КОНФИГУРАЦИЯ =====================
const CONFIG = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GOOGLE_CALENDAR_CREDENTIALS:
    process.env.GOOGLE_CALENDAR_CREDENTIALS || "./credentials.json",
  CALENDAR_ID: process.env.CALENDAR_ID || "primary",
  ADMIN_WHITELIST: process.env.ADMIN_WHITELIST
    ? process.env.ADMIN_WHITELIST.split(",").map((n) => n.trim())
    : [],
  SALON_NAME: process.env.SALON_NAME || "La Mirage Beauty",
  INSTAGRAM_LINK: process.env.INSTAGRAM_LINK || "",
  SALON_ADDRESS: process.env.SALON_ADDRESS || "",
  WORKING_HOURS: process.env.WORKING_HOURS || "Ежедневно с 10:00 до 21:00",
  NODE_ENV: process.env.NODE_ENV || "development",
  DATABASE_URL:
    process.env.DATABASE_URL || "postgresql://localhost:5432/lamiragebeauty",
};

// Валидация конфигурации
// Валидация конфигурации
function validateConfig() {
  const required = ["GEMINI_API_KEY", "DATABASE_URL"];
  const missing = required.filter((key) => !CONFIG[key]);

  if (missing.length > 0) {
    console.error(
      "❌ Отсутствуют обязательные переменные:",
      missing.join(", ")
    );
    process.exit(1);
  }

  console.log("\n📋 КОНФИГУРАЦИЯ БОТА:");
  console.log(`Салон: ${CONFIG.SALON_NAME}`);
  console.log(`Администраторы: ${CONFIG.ADMIN_WHITELIST.length} человек`);
  CONFIG.ADMIN_WHITELIST.forEach((admin, i) => {
    console.log(`   ${i + 1}. ${admin}`);
  });
  console.log("");

  if (CONFIG.ADMIN_WHITELIST.length === 0) {
    console.warn(
      "⚠️  ADMIN_WHITELIST пуст. Добавьте номера администраторов в .env"
    );
  }
}

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====================
// Извлечение номера телефона из WhatsApp ID (поддержка @c.us, @lid и других форматов)
// Для @lid пытается получить реальный номер через Contact API
async function extractPhoneNumber(whatsappId, message = null) {
  // Если это @lid формат и есть объект message, пытаемся получить реальный номер
  if (whatsappId.includes("@lid") && message) {
    try {
      // ВАЖНО: В новых версиях WWebJS getContact() может бросать ошибки Browser-side
      const contact = await message.getContact().catch(() => null);
      if (contact) {
        if (contact.number && contact.number !== whatsappId) {
          return contact.number.replace(/[@+\s-]/g, "");
        }
        if (
          contact.id &&
          contact.id._serialized &&
          !contact.id._serialized.includes("@lid")
        ) {
          return contact.id._serialized.replace(/@.*$/, "");
        }
      }
    } catch (error) {
      console.log(`⚠️ Не удалось получить реальный номер: ${error.message}`);
    }
  }
  // Убираем @c.us, @lid и другие суффиксы WhatsApp
  return whatsappId.replace(/@.*$/, "");
}

// ===================== ФУНКЦИИ ДЛЯ РАБОТЫ С ДАТАМИ =====================
function getToday() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTomorrow() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const year = tomorrow.getFullYear();
  const month = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const day = String(tomorrow.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateForDisplay(dateString) {
  const date = new Date(dateString);
  const options = { day: "numeric", month: "long", year: "numeric" };
  return date.toLocaleDateString("ru-RU", options);
}

function getDayOfWeek(dateString) {
  const date = new Date(dateString);
  const days = [
    "воскресенье",
    "понедельник",
    "вторник",
    "среда",
    "четверг",
    "пятница",
    "суббота",
  ];
  return days[date.getDay()];
}

function getNextDays(count = 7) {
  const dates = [];
  for (let i = 0; i < count; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const formatted = `${year}-${month}-${day}`;
    const dayName = getDayOfWeek(formatted);
    const displayDate = formatDateForDisplay(formatted);

    dates.push({
      date: formatted,
      display: displayDate,
      dayName: dayName,
      isToday: i === 0,
      isTomorrow: i === 1,
    });
  }
  return dates;
}

// ===================== ДАННЫЕ О САЛОНЕ (из main.js) =====================
const MASTERS = {
  mainMaster: "Юна",
  secondaryMasters: ["Гульназ", "Жазира", "Айгерим", "Аружан", "Айлин"],
};

const PRICES = [
  {
    master: MASTERS.mainMaster,
    маникюр: 3000,
    "гель-покрытие": 7000,
    "наращивание ногтей типсами": 9000,
    "наращивание ногтей на верхние формы": 10000,
    "снятие покрытия": 1000,
    дизайн: "от 1000",
  },
  {
    master: "другие мастера",
    маникюр: 1000,
    "гель-покрытие": 3500,
    "наращивание ногтей": 5000,
    "снятие покрытия": 500,
    дизайн: "от 500",
  },
];

// ===================== ДАННЫЕ О САЛОНЕ =====================
const SALON_DATA = {
  masters: [
    {
      name: "Юна",
      specialty: "главный мастер по маникюру",
      services: ["маникюр", "наращивание"],
      priceCategory: "premium",
    },
    {
      name: "Аружан",
      specialty: "мастер по маникюру",
      services: ["маникюр", "наращивание"],
      priceCategory: "standard",
    },
    {
      name: "Айгерим",
      specialty: "мастер по маникюру",
      services: ["маникюр", "наращивание"],
      priceCategory: "standard",
    },
    {
      name: "Гульназ",
      specialty: "мастер по маникюру",
      services: ["маникюр", "наращивание"],
      priceCategory: "standard",
    },
    {
      name: "Жазира",
      specialty: "мастер по маникюру",
      services: ["маникюр", "наращивание"],
      priceCategory: "standard",
    },
    {
      name: "Лена",
      specialty: "мастер по бровям, ресницам и шугарингу",
      services: ["брови", "ресницы", "шугаринг", "ламинирование"],
      priceCategory: "standard",
    },
  ],

  services: [
    // УСЛУГИ ЮНЫ (МАНИКЮР)
    {
      name: "Маникюр без покрытия",
      master: "Юна",
      price: 3000,
      duration: 60,
      category: "маникюр",
    },
    {
      name: "Маникюр с укреплением",
      master: "Юна",
      price: 7000,
      duration: 90,
      category: "маникюр",
    },
    {
      name: "Наращивание ногтей типсами",
      master: "Юна",
      price: 9000,
      duration: 120,
      category: "маникюр",
    },
    {
      name: "Наращивание ногтей верхними формами",
      master: "Юна",
      price: 10000,
      duration: 120,
      category: "маникюр",
    },
    {
      name: "Снятие покрытия",
      master: "Юна",
      price: 1000,
      duration: 30,
      category: "маникюр",
    },
    {
      name: "Сложный дизайн",
      master: "Юна",
      price: 1000,
      duration: 30,
      category: "маникюр",
    },

    // УСЛУГИ ДРУГИХ МАСТЕРОВ (МАНИКЮР: Аружан, Айгерим, Гульназ, Жазира)
    {
      name: "Маникюр без покрытия",
      master: "другие",
      price: 1000,
      duration: 60,
      category: "маникюр",
    },
    {
      name: "Маникюр с укреплением",
      master: "другие",
      price: 3500,
      duration: 90,
      category: "маникюр",
    },
    {
      name: "Наращивание ногтей",
      master: "другие",
      price: 5000,
      duration: 120,
      category: "маникюр",
    },
    {
      name: "Снятие покрытия",
      master: "другие",
      price: 500,
      duration: 30,
      category: "маникюр",
    },
    {
      name: "Дизайн",
      master: "другие",
      price: 500,
      duration: 30,
      category: "маникюр",
    },

    // НАРАЩИВАНИЕ РЕСНИЦ (ЛЕНА)
    {
      name: "Наращивание ресниц Классика",
      master: "Лена",
      price: 6000,
      duration: 120,
      category: "ресницы",
    },
    {
      name: "Наращивание ресниц 2Д-3Д",
      master: "Лена",
      price: 7000,
      duration: 150,
      category: "ресницы",
    },
    {
      name: "Мокрый эффект до 3.5Д",
      master: "Лена",
      price: 7000,
      duration: 150,
      category: "ресницы",
    },
    {
      name: "Мокрый эффект от 4Д",
      master: "Лена",
      price: 8000,
      duration: 180,
      category: "ресницы",
    },
    {
      name: "Наращивание 4Д-5Д изгибы LM",
      master: "Лена",
      price: 8000,
      duration: 180,
      category: "ресницы",
    },
    {
      name: "Снятие ресниц (чужое/своё без наращивания)",
      master: "Лена",
      price: 1000,
      duration: 30,
      category: "ресницы",
    },

    // ЛАМИНИРОВАНИЕ (ЛЕНА)
    {
      name: "Ламинирование бровей (окрашивание + ботокс)",
      master: "Лена",
      price: 5000,
      duration: 60,
      category: "брови",
    },
    {
      name: "Ламинирование ресниц (окрашивание + ботокс)",
      master: "Лена",
      price: 5000,
      duration: 60,
      category: "ресницы",
    },
    {
      name: "Ламинирование бровей + ресниц",
      master: "Лена",
      price: 8500,
      duration: 90,
      category: "ресницы + брови",
    },

    // БРОВИ (ЛЕНА)
    {
      name: "Коррекция бровей воск/пинцет",
      master: "Лена",
      price: 1500,
      duration: 30,
      category: "брови",
    },
    {
      name: "Окрашивание бровей",
      master: "Лена",
      price: 2000,
      duration: 30,
      category: "брови",
    },

    // ШУГАРИНГ - КОМБО (ЛЕНА)
    {
      name: "Шугаринг Комбо 1 (глубокое бикини + подмышки + ноги до колен)",
      master: "Лена",
      price: 6000,
      duration: 90,
      category: "шугаринг",
    },
    {
      name: "Шугаринг Комбо 2 (руки полностью + ноги полностью)",
      master: "Лена",
      price: 5000,
      duration: 90,
      category: "шугаринг",
    },
    {
      name: "Шугаринг Комбо 3 (глубокое бикини + подмышки)",
      master: "Лена",
      price: 4500,
      duration: 60,
      category: "шугаринг",
    },
    {
      name: "Шугаринг Комбо 4 (глубокое бикини + подмышки + ноги полностью)",
      master: "Лена",
      price: 7000,
      duration: 120,
      category: "шугаринг",
    },
    {
      name: "Шугаринг Комбо 5 (ноги до колен + руки до локтя + глубокое бикини + подмышки)",
      master: "Лена",
      price: 7000,
      duration: 120,
      category: "шугаринг",
    },
    {
      name: "Шугаринг Комбо 6 (руки до локтя + ноги до колена)",
      master: "Лена",
      price: 4000,
      duration: 75,
      category: "шугаринг",
    },

    // ШУГАРИНГ - ОТДЕЛЬНЫЕ ЗОНЫ (ЛЕНА)
    {
      name: "Шугаринг лицо полностью",
      master: "Лена",
      price: 3500,
      duration: 30,
      category: "шугаринг",
    },
    {
      name: "Шугаринг лоб",
      master: "Лена",
      price: 500,
      duration: 10,
      category: "шугаринг",
    },
    {
      name: "Шугаринг усики",
      master: "Лена",
      price: 500,
      duration: 10,
      category: "шугаринг",
    },
    {
      name: "Шугаринг подбородок",
      master: "Лена",
      price: 500,
      duration: 10,
      category: "шугаринг",
    },
    {
      name: "Шугаринг бакенбарды",
      master: "Лена",
      price: 1000,
      duration: 15,
      category: "шугаринг",
    },
    {
      name: "Шугаринг затылок",
      master: "Лена",
      price: 1000,
      duration: 15,
      category: "шугаринг",
    },
    {
      name: "Шугаринг спина",
      master: "Лена",
      price: 1500,
      duration: 30,
      category: "шугаринг",
    },
    {
      name: "Шугаринг живот полностью",
      master: "Лена",
      price: 1500,
      duration: 25,
      category: "шугаринг",
    },
    {
      name: "Шугаринг линия живота",
      master: "Лена",
      price: 500,
      duration: 10,
      category: "шугаринг",
    },
    {
      name: "Шугаринг поясница",
      master: "Лена",
      price: 1000,
      duration: 15,
      category: "шугаринг",
    },
    {
      name: "Шугаринг ягодицы",
      master: "Лена",
      price: 1000,
      duration: 20,
      category: "шугаринг",
    },
    {
      name: "Шугаринг глубокое бикини",
      master: "Лена",
      price: 4000,
      duration: 45,
      category: "шугаринг",
    },
    {
      name: "Шугаринг классическое бикини",
      master: "Лена",
      price: 3000,
      duration: 30,
      category: "шугаринг",
    },
    {
      name: "Шугаринг подмышки",
      master: "Лена",
      price: 1000,
      duration: 15,
      category: "шугаринг",
    },
    {
      name: "Шугаринг ноги полностью",
      master: "Лена",
      price: 4000,
      duration: 60,
      category: "шугаринг",
    },
    {
      name: "Шугаринг ноги до колен",
      master: "Лена",
      price: 3000,
      duration: 40,
      category: "шугаринг",
    },
    {
      name: "Шугаринг руки полностью",
      master: "Лена",
      price: 3000,
      duration: 45,
      category: "шугаринг",
    },
    {
      name: "Шугаринг руки до локтя",
      master: "Лена",
      price: 2500,
      duration: 30,
      category: "шугаринг",
    },
  ],

  materialInfo:
    "Мы работаем на профессиональных материалах премиум-класса: гель-лаки CND, Kodi, базы и топы Rubber Base. Все материалы гипоаллергенны и безопасны.",
  workingHours: CONFIG.WORKING_HOURS,
  address: CONFIG.SALON_ADDRESS,
};

// ===================== POSTGRESQL =====================
const pool = new Pool({
  connectionString: CONFIG.DATABASE_URL,
  ssl: false,
});

// Тест подключения
pool.on("connect", () => {
  console.log("✅ PostgreSQL подключен");
});

pool.on("error", (err) => {
  console.error("❌ Ошибка PostgreSQL:", err);
});
// Инициализация базы данных
async function initDatabase() {
  let client;
  try {
    // Получаем клиента из пула
    client = await pool.connect();
    console.log("🔌 Подключение к PostgreSQL установлено");

    // Создание таблицы conversations
    await client.query(`
			CREATE TABLE IF NOT EXISTS conversations (
				user_id VARCHAR(255) PRIMARY KEY,
				stage VARCHAR(50) DEFAULT 'greeting',
				history JSONB DEFAULT '[]'::jsonb,
				booking_data JSONB DEFAULT '{}'::jsonb,
				client_name VARCHAR(255),
				client_phone VARCHAR(50),
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			);
		`);
    console.log("✅ Таблица conversations создана");
    await client.query(`
  DO $$ 
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'conversations' AND column_name = 'is_admin_mode'
    ) THEN
      ALTER TABLE conversations ADD COLUMN is_admin_mode BOOLEAN DEFAULT FALSE;
    END IF;
  END $$;
`);
await client.query(`
  DO $$ 
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'conversations' AND column_name = 'admin_chat_id'
    ) THEN
      ALTER TABLE conversations ADD COLUMN admin_chat_id VARCHAR(255);
    END IF;
  END $$;
`);
console.log("✅ Столбец admin_chat_id проверен/добавлен");
    // Добавление столбца updated_at если его нет
    await client.query(`
  DO $$ 
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'conversations' AND column_name = 'updated_at'
    ) THEN
      ALTER TABLE conversations ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    END IF;
  END $$;
`);
    console.log("✅ Столбец updated_at проверен/добавлен");

    // Добавление триггера для автообновления updated_at
    await client.query(`
  CREATE OR REPLACE FUNCTION update_updated_at_column()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
  END;
  $$ language 'plpgsql';
`);

    await client.query(`
  DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
  
  CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
`);
    console.log("✅ Триггер автообновления updated_at создан");
    // Создание таблицы bookings
    await client.query(`
			CREATE TABLE IF NOT EXISTS bookings (
				id SERIAL PRIMARY KEY,
				user_id VARCHAR(255) NOT NULL,
				client_name VARCHAR(255) NOT NULL,
				client_phone VARCHAR(50) NOT NULL,
				service VARCHAR(255) NOT NULL,
				master VARCHAR(100) NOT NULL,
				price INTEGER NOT NULL,
				date DATE NOT NULL,
				time TIME NOT NULL,
				status VARCHAR(50) DEFAULT 'pending',
				reminder_sent BOOLEAN DEFAULT FALSE,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				confirmed_at TIMESTAMP,
				completed_at TIMESTAMP
			);
		`);
    console.log("✅ Таблица bookings создана");

    await client.query(`
      ALTER TABLE bookings 
      ADD COLUMN IF NOT EXISTS duration INTEGER DEFAULT 60;
    `);
    console.log("✅ Столбец duration добавлен в таблицу bookings");

    // Создание таблицы statistics
    await client.query(`
			CREATE TABLE IF NOT EXISTS statistics (
				master_name VARCHAR(100) PRIMARY KEY,
				total_bookings INT DEFAULT 0,
				confirmed_bookings INT DEFAULT 0,
				completed_bookings INT DEFAULT 0,
				revenue BIGINT DEFAULT 0,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			);
		`);
    console.log("✅ Таблица statistics создана");

    // Создание таблицы clients
    await client.query(`
			CREATE TABLE IF NOT EXISTS clients (
				phone VARCHAR(50) PRIMARY KEY,
				name VARCHAR(255),
				user_id VARCHAR(255),
				total_visits INT DEFAULT 0,
				total_spent BIGINT DEFAULT 0,
				last_visit TIMESTAMP,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			);
		`);
    console.log("✅ Таблица clients создана");

    // Создание индексов
    await client.query(`
			CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
			CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
			CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
			CREATE INDEX IF NOT EXISTS idx_bookings_reminder ON bookings(date, time, reminder_sent);
		`);
    console.log("✅ Индексы созданы");

    // Добавление мастеров в статистику
    for (const master of SALON_DATA.masters) {
      await client.query(
        `INSERT INTO statistics (master_name, total_bookings, confirmed_bookings, revenue)
				VALUES ($1, 0, 0, 0) ON CONFLICT (master_name) DO NOTHING`,
        [master.name]
      );
    }
    console.log("✅ Мастера добавлены в статистику");

    console.log("✅ База данных PostgreSQL полностью инициализирована");
  } catch (error) {
    console.error("❌ Ошибка инициализации БД:", error.message);
    console.error("Детали:", error);
    throw error;
  } finally {
    // Освобождаем клиента обратно в пул
    if (client) {
      client.release();
    }
  }
}

// ===================== СЕРВИСЫ =====================
let whatsappClient;
let genAI;
let calendar;

// Инициализация Gemini AI
function initGemini() {
  try {
    genAI = new GoogleGenerativeAI(CONFIG.GEMINI_API_KEY);
    console.log("✅ Gemini AI инициализирован");
  } catch (error) {
    console.error("❌ Ошибка инициализации Gemini:", error);
    throw error;
  }
}

// Инициализация Google Calendar (из main.js - работает лучше)
async function initGoogleCalendar() {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: CONFIG.GOOGLE_CALENDAR_CREDENTIALS,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });

    const authClient = await auth.getClient();
    calendar = google.calendar({ version: "v3", auth: authClient });

    console.log("✅ Google Calendar инициализирован через Service Account");
  } catch (err) {
    console.error("❌ Ошибка инициализации Google Calendar:", err.message);
    console.log("ℹ️  Бот будет работать без интеграции с календарем");
  }
}

// Инициализация WhatsApp
// Инициализация WhatsApp
function initWhatsApp() {
  return new Promise((resolve, reject) => {
    whatsappClient = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: true,
      },
    });

    let isReady = false;
    const readyTimeout = setTimeout(() => {
      if (!isReady) {
        console.log("⚠️  WhatsApp не готов после 60 секунд");
        console.log("💡 Возможные причины:");
        console.log("   1. Не отсканирован QR-код");
        console.log("   2. Проблемы с сетью");
        console.log("   3. Устаревшая сессия - удалите папку .wwebjs_auth");
        // Не отклоняем промис, просто предупреждаем
      }
    }, 60000);

    whatsappClient.on("qr", (qr) => {
      console.log("\n📱 Отсканируйте QR-код в WhatsApp:\n");
      qrcode.generate(qr, { small: true });
      console.log(
        "\n💡 Откройте WhatsApp -> Настройки -> Связанные устройства -> Связать устройство\n"
      );
    });

    whatsappClient.on("ready", () => {
      isReady = true;
      clearTimeout(readyTimeout);
      console.log("\n✅ WhatsApp бот запущен!");
      console.log(`📞 Салон: ${CONFIG.SALON_NAME}`);
      console.log(`👥 Администраторов: ${CONFIG.ADMIN_WHITELIST.length}\n`);
      console.log("🎉 Бот готов к работе! Можете отправлять сообщения.\n");
      resolve(whatsappClient);
    });

    whatsappClient.on("authenticated", async () => {
      console.log("✅ WhatsApp аутентификация прошла успешно");
      console.log("⏳ Ожидание готовности...");
      // Даём WhatsApp время на синхронизацию
      await new Promise((resolve) => setTimeout(resolve, 10000));
    });

    whatsappClient.on("auth_failure", (msg) => {
      clearTimeout(readyTimeout);
      console.error("❌ Ошибка аутентификации WhatsApp:", msg);
      console.log("💡 Попробуйте удалить папку .wwebjs_auth и перезапустить");
      reject(new Error(`Auth failure: ${msg}`));
    });

    whatsappClient.on("loading_screen", (percent, message) => {
      console.log(`⏳ Загрузка WhatsApp: ${percent}% - ${message}`);
    });

    whatsappClient.on("message", handleMessage);

    whatsappClient.on("disconnected", (reason) => {
      console.log("⚠️  WhatsApp отключен:", reason);
      console.log("💡 Перезапустите бота");
    });

    console.log("⏳ Инициализация WhatsApp...");
    whatsappClient.initialize();
  });
}

// ===================== ОБРАБОТКА СООБЩЕНИЙ =====================
// ===================== ВАЛИДАЦИЯ ЧЕРЕЗ GEMINI AI =====================
async function validateUserDataWithGemini(userMessage, dataType) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    let prompt = "";

    if (dataType === "name") {
      prompt = `Проанализируй сообщение пользователя и определи, является ли это настоящим именем человека.

Сообщение: "${userMessage}"

ПРАВИЛА:
1. Это должно быть настоящее имя (например: Азат, Айгуль, Марат, Диана, Анна, John)
2. НЕ принимай: вопросы ("как дела", "что"), приветствия ("привет", "здравствуй"), команды, цифры
3. Извлеки только ПЕРВОЕ слово как имя, игнорируй остальное
4. Имя должно быть минимум 2 буквы

Ответь ТОЛЬКО в формате JSON:
{
  "isValid": true/false,
  "data": "извлеченное имя или null",
  "message": "сообщение для пользователя если невалидно, или null"
}

Примеры:
"Азат" -> {"isValid": true, "data": "Азат", "message": null}
"меня зовут Диана" -> {"isValid": true, "data": "Диана", "message": null}
"как дела" -> {"isValid": false, "data": null, "message": "Пожалуйста, напишите ваше настоящее имя 😊\\n\\nНапример: Азат, Айгуль, Марат, Диана"}
"привет" -> {"isValid": false, "data": null, "message": "Пожалуйста, напишите ваше имя, а не приветствие 😊"}
"123" -> {"isValid": false, "data": null, "message": "Пожалуйста, напишите ваше имя буквами"}`;
    } else if (dataType === "phone") {
      prompt = `Проанализируй сообщение и извлеки номер телефона.

Сообщение: "${userMessage}"

ПРАВИЛА:
1. Извлеки все цифры из сообщения
2. Номер должен быть от 10 до 15 цифр
3. Убери все символы кроме цифр и плюса в начале
4. Если номер начинается с 8, замени на 7

Ответь ТОЛЬКО в формате JSON:
{
  "isValid": true/false,
  "data": "очищенный номер или null",
  "message": "сообщение для пользователя если невалидно, или null"
}

Примеры:
"+7 706 424 0050" -> {"isValid": true, "data": "77064240050", "message": null}
"77064240050" -> {"isValid": true, "data": "77064240050", "message": null}
"8 706 424 0050" -> {"isValid": true, "data": "77064240050", "message": null}
"123" -> {"isValid": false, "data": null, "message": "Пожалуйста, введите корректный номер телефона\\n\\nНапример:\\n+7 706 424 0050\\n77064240050"}
"привет" -> {"isValid": false, "data": null, "message": "Пожалуйста, введите номер телефона цифрами"}`;
    }

    const result = await model.generateContent(prompt);
    const response = result.response.text();
    const jsonMatch = response.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const validation = JSON.parse(jsonMatch[0]);
      console.log(
        `📝 Валидация ${dataType === "name" ? "имени" : "телефона"}:`,
        validation
      );
      return validation;
    }
  } catch (error) {
    console.error(`Ошибка валидации ${dataType}:`, error);
  }

  // Fallback на простую валидацию
  if (dataType === "name") {
    const cleanName = userMessage.trim().split(/\s+/)[0];
    if (cleanName.length < 2 || cleanName.startsWith("/")) {
      return {
        isValid: false,
        data: null,
        message: "Пожалуйста, напишите ваше имя (минимум 2 буквы)",
      };
    }
    return { isValid: true, data: cleanName, message: null };
  } else if (dataType === "phone") {
    const cleanPhone = userMessage.replace(/[^0-9+]/g, "").replace(/^8/, "7");
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      return {
        isValid: false,
        data: null,
        message:
          "Пожалуйста, введите корректный номер телефона\n\nНапример:\n+7 706 424 0050\n77064240050",
      };
    }
    return { isValid: true, data: cleanPhone, message: null };
  }
}

async function handleMessage(message) {
  const userId = message.from;
  const userMessage = message.body.trim();

  // Получение состояния разговора
  let conversation = await getConversation(userId);

  // Игнорируем сообщения от ботов и групп
  if (message.fromMe || message.from.includes("@g.us")) {
    return;
  }

  // ===================== ПРОВЕРКА ИСТЕЧЕНИЯ СЕССИИ =====================
  if (conversation) {
    const isExpired = await checkSessionExpiry(conversation);

    if (isExpired) {
      console.log(`⏰ Сессия истекла для ${userId}, сбрасываем тихо`);

      // Сбрасываем сессию БЕЗ уведомления (silent mode)
      await resetSession(userId, true);

      // Обнуляем conversation, чтобы обработать сообщение как новое
      conversation = null;

      // НЕ отправляем уведомление - просто обрабатываем текущее сообщение заново
    }
  }

  // Проверка команд администратора
  const isUserAdmin = (id) => {
    const cleanId = id.replace(/@.+/, "");
    return CONFIG.ADMIN_WHITELIST.some(
      (adminId) => adminId.replace(/@.+/, "") === cleanId
    );
  };

  if (isUserAdmin(userId)) {
    console.log(`👤 Admin call detected from ${userId}: ${userMessage}`);

    if (userMessage === "/admin") {
      return await sendAdminStats(message);
    }

    if (userMessage === "/dashboard") {
      return await sendDashboardLink(message);
    }

    if (userMessage.match(/^\/ok\s+\d+$/)) {
      return await confirmBooking(message, userMessage);
    }

    if (userMessage.match(/^\/no\s+\d+$/)) {
      return await rejectBooking(message, userMessage);
    }

    // Подключение к чату с клиентом
    if (userMessage.startsWith("/connect")) {
      const phoneInput = userMessage.split(" ")[1];
      if (!phoneInput)
        return await message.reply("❌ Укажите номер: /connect 7701...");
      const phoneToConnect = phoneInput.replace(/[^0-9]/g, "");

      try {
        let targetUserId = null;

        const convRes = await pool.query(
          `SELECT user_id FROM conversations 
					 WHERE client_phone LIKE $1 OR client_phone LIKE $2`,
          [`%${phoneToConnect}`, `%${phoneToConnect.slice(1)}`]
        );

        if (convRes.rows.length > 0) {
          targetUserId = convRes.rows[0].user_id;
        } else {
          const clientRes = await pool.query(
            "SELECT user_id FROM clients WHERE phone = $1",
            [phoneToConnect]
          );
          if (clientRes.rows.length > 0) {
            targetUserId = clientRes.rows[0].user_id;
          }
        }

        if (!targetUserId)
          return await message.reply(
            "❌ Клиент с таким номером не найден (или нет активного диалога)."
          );

        const updateRes = await pool.query(
          "UPDATE conversations SET is_admin_mode = TRUE, admin_chat_id = $2 WHERE user_id = $1",
          [targetUserId, userId]
        );

        if (updateRes.rowCount === 0) {
          const altUserId = targetUserId.includes("@c.us")
            ? targetUserId.replace("@c.us", "@lid")
            : targetUserId.replace("@lid", "@c.us");

          const updateRes2 = await pool.query(
            "UPDATE conversations SET is_admin_mode = TRUE, admin_chat_id = $2 WHERE user_id = $1",
            [altUserId, userId]
          );

          if (updateRes2.rowCount === 0) {
            return await message.reply(
              `❌ Ошибка: Не удалось обновить статус диалога. ID: ${targetUserId}`
            );
          }
          targetUserId = altUserId;
        }

        return await message.reply(
          `✅ Режим оператора включен для ${phoneToConnect}.\nID: ${targetUserId}\nВсе сообщения пересылаются.`
        );
      } catch (e) {
        console.error(e);
        return await message.reply("Ошибка: " + e.message);
      }
    }

    // Завершение чата
    if (userMessage === "/close") {
      try {
        const res = await pool.query(
          "SELECT user_id FROM conversations WHERE admin_chat_id = $1 AND is_admin_mode = TRUE",
          [userId]
        );

        if (res.rows.length > 0) {
          const clientUserId = res.rows[0].user_id;
          await pool.query(
            "UPDATE conversations SET is_admin_mode = FALSE, admin_chat_id = NULL WHERE user_id = $1",
            [clientUserId]
          );
          await whatsappClient.sendMessage(
            clientUserId,
            "👩‍💻 Оператор завершил диалог. Я снова с вами! Чем могу помочь?"
          );
          return await message.reply(`✅ Диалог завершен. AI снова включен.`);
        } else {
          return await message.reply("❌ У вас нет активных диалогов");
        }
      } catch (e) {
        console.error(e);
      }
    }

    // Пересылка сообщений в активном диалоге
    try {
      const res = await pool.query(
        "SELECT user_id FROM conversations WHERE admin_chat_id = $1 AND is_admin_mode = TRUE",
        [userId]
      );
      if (res.rows.length > 0) {
        const clientUserId = res.rows[0].user_id;
        await whatsappClient.sendMessage(
          clientUserId,
          `👩‍💻 Администратор: ${userMessage}`
        );
        return;
      }
    } catch (e) {
      console.error(e);
    }
  } else {
    // Проверка неправомерного использования админских команд
    if (
      userMessage.startsWith("/connect") ||
      userMessage.startsWith("/close") ||
      userMessage.match(/^\/ok\s+\d+$/) ||
      userMessage.match(/^\/no\s+\d+$/)
    ) {
      console.log(
        `⚠️ Попытка использовать админскую команду от не-админа ${userId}`
      );
      return await message.reply(
        "❌ У вас нет прав администратора. Проверьте консоль."
      );
    }
  }

  // Команда связи с оператором
  if (
    userMessage.toLowerCase().includes("оператор") ||
    userMessage.toLowerCase().includes("админ") ||
    userMessage.toLowerCase().includes("менеджер")
  ) {
    await message.reply("Передала ваш запрос менеджерам! 👩‍💻 Скоро ответим.");

    for (const adminId of CONFIG.ADMIN_WHITELIST) {
      const cleanPhone = conversation
        ? conversation.client_phone
        : userId.replace("@c.us", "");
      await whatsappClient.sendMessage(
        adminId,
        `🔔 Клиент просит оператора!\nИмя: ${conversation?.client_name}\nТелефон: ${cleanPhone}\n\nПодключиться: /connect ${cleanPhone}`
      );
    }
    return;
  }

  // Команда изменения имени
  if (userMessage.match(/^\/update_name\s+.+$/i)) {
    const newName = userMessage
      .replace(/^\/update_name\s+/i, "")
      .trim()
      .split(/\s+/)[0];

    if (conversation) {
      conversation.client_name = newName;
      if (!conversation.client_phone) {
        conversation.client_phone = await extractPhoneNumber(userId, message);
      }
      await saveConversation(conversation);
      await saveClient(conversation.client_phone, newName, userId);

      return await message.reply(
        `✅ Ваше имя обновлено: ${newName}\n\nТеперь я буду обращаться к вам так! 🤍`
      );
    }
  }

  // Команда просмотра данных
  if (userMessage === "/myinfo") {
    if (conversation) {
      let phone = conversation.client_phone;

      const isLidUser = userId.includes("@lid");
      const phoneLooksLikeLid = phone && phone.length > 13;

      if ((!phone || phoneLooksLikeLid) && isLidUser) {
        try {
          const extractedId = await extractPhoneNumber(userId, message);
          const searchId = extractedId + "@c.us";

          const result = await pool.query(
            "SELECT phone FROM clients WHERE user_id = $1",
            [searchId]
          );
          if (result.rows.length > 0 && result.rows[0].phone) {
            phone = result.rows[0].phone;
            conversation.client_phone = phone;
            await saveConversation(conversation);
          }
        } catch (e) {
          console.error("Ошибка поиска телефона в БД:", e);
        }
      }

      if (!phone) {
        phone = await extractPhoneNumber(userId, message);
      }

      return await message.reply(
        `👤 ВАШИ ДАННЫЕ:\n\n` +
          `Имя: ${conversation.client_name || "не указано"}\n` +
          `Телефон: ${phone}\n\n` +
          `Для изменения имени отправьте:\n` +
          `/update_name Ваше_Новое_Имя`
      );
    }
  }

  // Создание новой сессии
  if (!conversation) {
    conversation = {
      user_id: userId,
      stage: "asking_name_and_phone",
      history: [],
      booking_data: {},
      client_name: null,
      client_phone: await extractPhoneNumber(userId, message),
    };
    await saveConversation(conversation);

    return await message.reply(
      `Здравствуйте! ❤️\nДобро пожаловать в салон красоты ${CONFIG.SALON_NAME} ✨\n\nКак мне к вам обращаться?\nНапишите, пожалуйста, ваше имя и номер телефона 🤍\n\nНапример:\nАйгуль +7 701 234 5678\nили\nМарат 77012345678`
    );
  }

  // Запрос имени и телефона
  if (conversation.stage === "asking_name_and_phone") {
    const nameValidation = await validateUserDataWithGemini(
      userMessage,
      "name"
    );

    if (!nameValidation.isValid) {
      return await message.reply(
        `${nameValidation.message}\n\n💡 Напишите, пожалуйста, ваше имя и номер телефона\n\nНапример:\nАйгуль +7 701 234 5678\nили\nМарат 77012345678`
      );
    }

    const cleanName = nameValidation.data;
    const phoneValidation = await validateUserDataWithGemini(
      userMessage,
      "phone"
    );

    const extractedPhone = await extractPhoneNumber(userId, message);
    const isLidUser = userId.includes("@lid");

    let finalPhone = null;

    if (phoneValidation.isValid) {
      finalPhone = phoneValidation.data;
      console.log(`📞 Телефон извлечён из сообщения: ${finalPhone}`);
    } else if (!isLidUser && extractedPhone !== userId.replace(/@.*$/, "")) {
      finalPhone = extractedPhone;
      console.log(`📞 Телефон получен из WhatsApp ID: ${finalPhone}`);
    }

    if (!finalPhone) {
      conversation.client_name = cleanName;
      conversation.stage = "asking_phone_only";
      await saveConversation(conversation);

      return await message.reply(
        `Приятно познакомиться, ${cleanName}! ✨\n\nТеперь напишите, пожалуйста, ваш номер телефона 📱\n\nНапример:\n+7 701 234 5678\nили\n77012345678`
      );
    }

    conversation.client_name = cleanName;
    conversation.client_phone = finalPhone;
    conversation.stage = "conversation";
    await saveConversation(conversation);
    await saveClient(finalPhone, cleanName, userId);

    return await message.reply(
      `Отлично, ${cleanName}! Все данные сохранены ✅\n\nЯ помогу вам записаться на услугу. Расскажите, что вас интересует? Или выберите:\n\n💅 Маникюр\n👁 Брови и ресницы\n🌸 Шугаринг\n\n`
    );
  }

  // Запрос только телефона
  if (conversation.stage === "asking_phone_only") {
    const phoneValidation = await validateUserDataWithGemini(
      userMessage,
      "phone"
    );

    if (!phoneValidation.isValid) {
      return await message.reply(phoneValidation.message);
    }

    conversation.client_phone = phoneValidation.data;
    conversation.stage = "conversation";
    await saveConversation(conversation);
    await saveClient(
      conversation.client_phone,
      conversation.client_name,
      userId
    );

    return await message.reply(
      `Отлично, ${conversation.client_name}! Номер сохранен ✅\n\nТеперь расскажите, что вас интересует?\n\n💅 Маникюр\n👁 Брови и ресницы\n🌸 Шугаринг\n\nКакой мастер вам удобен и когда вы хотели бы прийти?`
    );
  }

  // Режим оператора
  if (conversation.is_admin_mode && conversation.admin_chat_id) {
    try {
      await whatsappClient.sendMessage(
        conversation.admin_chat_id,
        `👤 Клиент ${
          conversation.client_name || conversation.client_phone
        }: ${userMessage}`
      );

      conversation.history.push({
        role: "user",
        content: userMessage,
        timestamp: new Date().toISOString(),
      });

      await saveConversation(conversation);
      return;
    } catch (e) {
      console.error("Ошибка пересылки сообщения админу:", e);
    }
  }

  // Добавление в историю
  conversation.history.push({
    role: "user",
    content: userMessage,
    timestamp: new Date().toISOString(),
  });

  await saveConversation(conversation);

  // Генерация ответа
  await generateAndSendResponse(message, conversation);
}

// Получение разговора из БД
async function getConversation(userId) {
  try {
    const result = await pool.query(
      "SELECT * FROM conversations WHERE user_id = $1",
      [userId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error("Ошибка получения разговора:", error);
    return null;
  }
}

// Сохранение разговора в БД
// Сохранение разговора в БД
async function saveConversation(conversation) {
  try {
    await pool.query(
      `
			INSERT INTO conversations (
        user_id, 
        stage, 
        history, 
        booking_data, 
        client_name, 
        client_phone, 
        is_admin_mode, 
        admin_chat_id,
        updated_at
      )
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
			ON CONFLICT (user_id) 
			DO UPDATE SET 
				stage = $2,
				history = $3,
				booking_data = $4,
				client_name = $5,
				client_phone = $6,
				is_admin_mode = $7,
				admin_chat_id = $8,
				updated_at = CURRENT_TIMESTAMP
		`,
      [
        conversation.user_id,
        conversation.stage,
        JSON.stringify(conversation.history),
        JSON.stringify(conversation.booking_data),
        conversation.client_name,
        conversation.client_phone,
        conversation.is_admin_mode || false,
        conversation.admin_chat_id || null,
      ]
    );
  } catch (error) {
    console.error("Ошибка сохранения разговора:", error);
  }
}

// ===================== УПРАВЛЕНИЕ СЕССИЯМИ =====================
// Проверка активности сессии (30 минут)
async function checkSessionExpiry(conversation) {
  if (!conversation || !conversation.updated_at) return false;

  const now = new Date();
  const lastUpdate = new Date(conversation.updated_at);
  const diffMinutes = (now - lastUpdate) / (1000 * 60);

  // Если прошло более 30 минут
  if (diffMinutes > 30) {
    console.log(`⏰ Сессия истекла для ${conversation.user_id} (${Math.round(diffMinutes)} мин)`);
    return true;
  }

  return false;
}

// Сброс сессии (обнуление данных) БЕЗ отправки уведомления
async function resetSession(userId, silent = false) {
  try {
    await pool.query(
      `UPDATE conversations 
       SET stage = 'greeting',
           history = '[]'::jsonb,
           booking_data = '{}'::jsonb,
           is_admin_mode = FALSE,
           admin_chat_id = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [userId]
    );

    console.log(`🔄 Сессия сброшена для ${userId}${silent ? ' (тихо)' : ''}`);
    return true;
  } catch (error) {
    console.error('Ошибка сброса сессии:', error);
    return false;
  }
}

// Уведомление о завершении сессии (только когда нужно)
async function notifySessionExpired(userId) {
  try {
    await whatsappClient.sendMessage(
      userId,
      `⏰ Ваша сессия завершена из-за неактивности.\n\nЕсли хотите продолжить - просто напишите мне снова! 🤍\n\nЯ буду рада помочь вам! ✨`
    );
    console.log(`✅ Уведомление о завершении сессии отправлено: ${userId}`);
  } catch (error) {
    console.error('Ошибка отправки уведомления о сессии:', error);
  }
}
// Сброс сессии (обнуление данных)
async function resetSession(userId) {
  try {
    await pool.query(
      `UPDATE conversations 
       SET stage = 'greeting',
           history = '[]'::jsonb,
           booking_data = '{}'::jsonb,
           is_admin_mode = FALSE,
           admin_chat_id = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [userId]
    );

    console.log(`🔄 Сессия сброшена для ${userId}`);
    return true;
  } catch (error) {
    console.error("Ошибка сброса сессии:", error);
    return false;
  }
}

// Уведомление о завершении сессии
// Уведомление о завершении сессии
// Уведомление о завершении сессии
async function notifySessionExpired(userId) {
  try {
    await whatsappClient.sendMessage(
      userId,
      `⏰ Ваша сессия завершена из-за неактивности.\n\nЕсли хотите продолжить - просто напишите мне снова! 🤍\n\nЯ буду рада помочь вам! ✨`
    );
    console.log(`✅ Уведомление о завершении сессии отправлено: ${userId}`);
  } catch (error) {
    console.error("Ошибка отправки уведомления о сессии:", error);
  }
}
async function saveClient(phone, name, userId) {
  try {
    // Fix: Используем ID как есть, не форсируем суффикс, чтобы не ломать @lid
    const cleanPhone = phone.includes("@")
      ? await extractPhoneNumber(phone)
      : phone;

    // Если userId не передан, не пытаемся его угадать/создать неправильно
    // Но обычно он передается.

    await pool.query(
      `INSERT INTO clients (phone, name, user_id, created_at)
			VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
			ON CONFLICT (phone) 
			DO UPDATE SET 
				name = EXCLUDED.name,
				user_id = EXCLUDED.user_id`,
      [cleanPhone, name, userId]
    );
    console.log(`✅ Клиент сохранен/обновлен: ${name} (${cleanPhone})`);
  } catch (error) {
    console.error("Ошибка сохранения клиента:", error);
  }
}

// Отправка ссылки на dashboard
// Отправка ссылки на dashboard
async function sendDashboardLink(message) {
  await message.reply(
    `📊 Dashboard салона La Mirage Beauty\n\n🌐 Откройте в браузере:\nhttp://localhost:3000\n\nЧтобы запустить dashboard, выполните в терминале:\nnpm run dashboard`
  );
}
// Отправка приветствия
async function sendGreeting(message) {
  const greeting = `Здравствуйте!❤️
Вас приветствует салон красоты ${CONFIG.SALON_NAME} ✨
Очень рада вашему обращению!🫶

Напишите, пожалуйста:
• На какую услугу вы хотите записаться?
• К какому мастеру?
• Когда вам будет удобно прийти?

Я с радостью помогу вам с записью ✨
Спасибо, что выбираете ${CONFIG.SALON_NAME} 🤍`;

  await message.reply(greeting);
}

// Генерация ответа с Gemini AI
async function generateAndSendResponse(message, conversation) {
  try {
    
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const systemPrompt = createSystemPrompt(conversation.client_name);
    const chatHistory = conversation.history.slice(-10).map((msg) => ({
      
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }],
    }));

    const chat = model.startChat({
      history: [
        { role: "user", parts: [{ text: systemPrompt }] },
        {
          role: "model",
          parts: [
            {
              text: "Понял! Я буду работать как администратор салона La Mirage Beauty. Готов помогать клиентам!",
            },
          ],
        },
        ...chatHistory,
      ],
    });

    const result = await chat.sendMessage(message.body);
    let response = result.response.text();

    console.log(`🤖 Ответ AI (сырой): ${response.substring(0, 200)}...`);

    // ПРОВЕРКА НА ЗАПРОС ДОСТУПНОСТИ ВРЕМЕНИ
    const availabilityMatch = response.match(
      /ПРОВЕРИТЬ_ДОСТУПНОСТЬ:\s*мастер=(.+?),\s*дата=(\d{4}-\d{2}-\d{2}),\s*время=(\d{2}:\d{2})/i
    );

    if (availabilityMatch) {
      const [fullMatch, masterName, checkDate, checkTime] = availabilityMatch;

      console.log(`🔍 Обнаружена команда проверки доступности:`);
      console.log(`   Мастер: ${masterName.trim()}`);
      console.log(`   Дата: ${checkDate}`);
      console.log(`   Время: ${checkTime}`);

      // Находим длительность услуги из последних сообщений
      const recentMessages = conversation.history.slice(-3);
      let serviceDuration = 60;
      let serviceName = null;

      for (const msg of recentMessages) {
        if (msg.role === "user") {
          const messageText = msg.content.toLowerCase();
          const foundService = SALON_DATA.services.find((s) => {
            const serviceNameLower = s.name.toLowerCase();
            return (
              messageText.includes(serviceNameLower) ||
              messageText.includes(serviceNameLower.substring(0, 15))
            );
          });

          if (foundService) {
            serviceDuration = foundService.duration;
            serviceName = foundService.name;
            console.log(
              `⏱️ Определена услуга: ${serviceName}, длительность: ${serviceDuration} мин`
            );
            break;
          }
        }
      }

      // Проверяем доступность КОНКРЕТНОГО времени
      const isFree = await checkAvailability(
        masterName.trim(),
        checkDate,
        checkTime,
        serviceDuration
      );

      if (!isFree) {
        console.log(`⛔ Время ${checkTime} на ${checkDate} ЗАНЯТО!`);

        // Получаем список свободных слотов
        const availableSlots = await getAvailableSlots(
          masterName.trim(),
          checkDate
        );

        let busyMessage = `\n\n⚠️ К сожалению, время ${checkTime} на ${formatDateForDisplay(
          checkDate
        )} к мастеру ${masterName.trim()} уже занято! 😔`;

        if (availableSlots.length > 0) {
          const slotsText = availableSlots
            .slice(0, 10)
            .map((time) => `• ${time}`)
            .join("\n");
          busyMessage += `\n\nСвободные окна на эту дату:\n${slotsText}\n\nВыберите удобное время!`;
        } else {
          busyMessage += `\n\nК сожалению, на эту дату все занято. Попробуйте другой день! 🤍`;
        }

        // Удаляем команду проверки и добавляем сообщение о занятости
        response = response.replace(/ПРОВЕРИТЬ_ДОСТУПНОСТЬ:.+/i, busyMessage);

        // Сохраняем и отправляем
        conversation.history.push({
          role: "assistant",
          content: response,
          timestamp: new Date().toISOString(),
        });
        await saveConversation(conversation);

        return await message.reply(response);
      } else {
        // Время СВОБОДНО - убираем команду, продолжаем запись
        console.log(
          `✅ Время ${checkTime} СВОБОДНО! Продолжаем создание записи...`
        );
        response = response.replace(/\s*ПРОВЕРИТЬ_ДОСТУПНОСТЬ:.+/i, "");
      }
    }

    conversation.history.push({
      role: "assistant",
      content: response,
      timestamp: new Date().toISOString(),
    });

    await saveConversation(conversation);

    // Проверка намерения записаться
    const bookingIntent = await detectBookingIntent(conversation);

    if (bookingIntent.ready) {
      console.log(`📋 Все данные собраны, создаём запись...`);
      await initiateBookingConfirmation(
        message,
        conversation,
        bookingIntent.data
      );
    } else if (bookingIntent.slotBusy) {
      console.log(`⚠️ Слот занят (дублирование проверки)`);

      // Получаем свободные слоты на эту дату
      const availableSlots = await getAvailableSlots(
        bookingIntent.data.master,
        bookingIntent.data.date
      );

      let busyMessage = `⚠️ Ой! Прошу прощения, но время ${
        bookingIntent.data.time
      } на ${formatDateForDisplay(bookingIntent.data.date)} к мастеру ${
        bookingIntent.data.master
      } уже занято. 😔`;

      if (availableSlots.length > 0) {
        const slotsText = availableSlots
          .slice(0, 5)
          .map((time) => `• ${time}`)
          .join("\n");
        busyMessage += `\n\nСвободное время на эту дату:\n${slotsText}\n\nВыберите другое время!`;
      } else {
        busyMessage += `\n\nК сожалению, на эту дату все занято. Попробуйте другой день! 🤍`;
      }

      await message.reply(busyMessage);
    } else {
      // Детекция отмены
      if (await detectCancellation(conversation.user_id, message.body)) {
        await message.reply(
          "Хорошо, я отменила вашу последнюю активную запись/заявку. 👌\n\nЕсли захотите записаться снова — просто напишите!"
        );
        conversation.booking_data = {};
        await saveConversation(conversation);
        return;
      }

      // Обычный ответ
      await message.reply(response);
    }
  } catch (error) {
    console.error("Ошибка Gemini AI:", error);
    console.error("Детали ошибки:", error.stack);
    await message.reply(
      "Извините, произошла техническая ошибка. Попробуйте еще раз или позвоните нам."
    );
  }
}
// ===================== СОЗДАНИЕ СИСТЕМНОГО ПРОМПТА С ДАТАМИ =====================
function createSystemPrompt(clientName) {
  const mastersInfo = SALON_DATA.masters
    .map((m) => `${m.name} - ${m.specialty}`)
    .join("\n");

  // Группируем услуги по мастерам для более читаемого формата
  const yunaServices = SALON_DATA.services
    .filter((s) => s.master === "Юна")
    .map((s) => `  ${s.name} - ${s.price} тг`)
    .join("\n");

  const otherMastersServices = SALON_DATA.services
    .filter((s) => s.master === "другие" && s.category === "маникюр")
    .map((s) => `  ${s.name} - ${s.price} тг`)
    .join("\n");

  const lenaServices = SALON_DATA.services
    .filter((s) => s.master === "Лена")
    .map((s) => `  ${s.name} - ${s.price} тг`)
    .join("\n");

  const servicesInfo = `МАНИКЮР

Мастер Юна (главный мастер):
${yunaServices}

Мастера: Аружан, Айгерим, Гульназ, Жазира
${otherMastersServices}

БРОВИ, РЕСНИЦЫ И ШУГАРИНГ

Мастер Лена:
${lenaServices}`;

  // Получаем ближайшие даты
  const today = getToday();
  const tomorrow = getTomorrow();
  const todayDisplay = formatDateForDisplay(today);
  const tomorrowDisplay = formatDateForDisplay(tomorrow);
  const nextDays = getNextDays(5)
    .map((d) => `${d.display} (${d.dayName})`)
    .join(", ");

  return `Ты - виртуальный администратор салона красоты "${CONFIG.SALON_NAME}".

ТВОЯ РОЛЬ:
- Дружелюбный, милый и приветливый помощник
- Твоя цель: помочь клиенту выбрать услугу, показать цены, и затем помочь с записью
- Обращайся к клиенту по имени: ${clientName || "клиент"}
- Пиши естественно и тепло, используй эмодзи умеренно (✨, 💅, 🤍)
- КРИТИЧЕСКИ ВАЖНО: НИКОГДА не используй markdown форматирование - НЕ используй звездочки, жирный текст, подчеркивания
- Пиши обычным текстом без форматирования
- Общайся приветливо, но не перегружай сообщения

ИНФОРМАЦИЯ О САЛОНЕ:
Режим работы: ${SALON_DATA.workingHours}
Адрес: ${SALON_DATA.address}
Instagram: ${CONFIG.INSTAGRAM_LINK}

ТЕКУЩАЯ ДАТА:
Сегодня: ${todayDisplay}
Завтра: ${tomorrowDisplay}

НАШИ МАСТЕРА:
${mastersInfo}

УСЛУГИ И ЦЕНЫ:
${servicesInfo}

МАТЕРИАЛЫ: ${SALON_DATA.materialInfo}

ГЛАВНЫЕ ПРАВИЛА ОБЩЕНИЯ:

1. ВСЕГДА УТОЧНЯЙ КОНКРЕТНУЮ УСЛУГУ И ПОКАЗЫВАЙ ЦЕНЫ:
   
   ❌ НЕПРАВИЛЬНО:
   Клиент: "Хочу на брови сегодня в 11"
   Ты: "Отлично! Записываю вас на услугу по бровям к мастеру Лене..."
   
   ✅ ПРАВИЛЬНО:
   Клиент: "Хочу на брови сегодня в 11"
   Ты: "Отлично! У нас есть несколько услуг по бровям от мастера Лены:
   
   • Коррекция бровей (воск/пинцет) - 1500 тг
   • Окрашивание бровей - 2000 тг
   • Ламинирование бровей (окрашивание + ботокс) - 5000 тг
   
   Какая услуга вас интересует?"

2. ДЛЯ МАНИКЮРА - УТОЧНЯЙ МАСТЕРА И ПОКАЗЫВАЙ РАЗНИЦУ В ЦЕНАХ:
   
   Клиент: "Хочу маникюр"
   Ты: "Отлично! У нас работают несколько мастеров с разными ценами:
   
   Юна (главный мастер):
   • Маникюр без покрытия - 3000 тг
   • Маникюр с укреплением - 7000 тг
   • Наращивание типсами - 9000 тг
   
   Другие мастера (Аружан, Айгерим, Гульназ, Жазира):
   • Маникюр без покрытия - 1000 тг
   • Маникюр с укреплением - 3500 тг
   • Наращивание - 5000 тг
   
   К какому мастеру хотите записаться?"

3. ДЛЯ РЕСНИЦ И ШУГАРИНГА - ПОКАЗЫВАЙ ВЕСЬ СПИСОК:
   
   Клиент: "Хочу наращивание ресниц"
   Ты: "Отлично! Мастер Лена делает наращивание ресниц:
   
   • Классика - 6000 тг
   • 2Д-3Д - 7000 тг
   • Мокрый эффект до 3.5Д - 7000 тг
   • Мокрый эффект от 4Д - 8000 тг
   • 4Д-5Д изгибы LM - 8000 тг
   
   Какой эффект вам больше нравится?"

4. ТОЛЬКО ПОСЛЕ ВЫБОРА КОНКРЕТНОЙ УСЛУГИ - проверяй время:
   - Когда клиент выбрал КОНКРЕТНУЮ услугу И указал время - добавь команду:
     "ПРОВЕРИТЬ_ДОСТУПНОСТЬ: мастер={имя}, дата={YYYY-MM-DD}, время={HH:MM}"
   - НЕ проверяй время ПОКА клиент не выбрал конкретную услугу

Пример ПРАВИЛЬНОГО диалога:
Клиент: "Хочу на брови сегодня в 11"
Ты: "Отлично! У нас есть услуги по бровям:
- Коррекция бровей - 1500 тг
- Окрашивание бровей - 2000 тг
- Ламинирование бровей - 5000 тг
Что выберете?"

Клиент: "Коррекцию"
Ты: "Замечательно! Записываю вас на коррекцию бровей к мастеру Лене на сегодня, 24 декабря, в 11:00. Цена 1500 тг ✨ ПРОВЕРИТЬ_ДОСТУПНОСТЬ: мастер=Лена, дата=${today}, време=11:00"

5. НЕ СОЗДАВАЙ ЗАПИСЬ без:
   - Конкретного названия услуги
   - Точной цены
   - Имени мастера
   - Даты и времени

ПРИМЕРЫ БЛИЖАЙШИХ ДАТ:
${nextDays}

6. КОГДА ВСЕ ДАННЫЕ ГОТОВЫ:
   - Подтверди все детали записи с КОНКРЕТНОЙ услугой
   - Назови ТОЧНУЮ цену
   - Будь приветливой и радостной

Веди диалог тепло и с заботой о клиенте! ❤️`;
}

// Определение намерения записаться
// ===================== ОПРЕДЕЛЕНИЕ НАМЕРЕНИЯ С УМНЫМИ ДАТАМИ =====================
async function detectBookingIntent(conversation) {
  const recentMessages = conversation.history
    .slice(-10)
    .map((m) => `${m.role === "user" ? "Клиент" : "Бот"}: ${m.content}`)
    .join("\n");

  const today = getToday();
  const tomorrow = getTomorrow();

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `Проанализируй диалог и определи, готов ли клиент к записи.

Диалог:
${recentMessages}

Имя клиента: ${conversation.client_name}
Телефон клиента: ${conversation.client_phone}

ТЕКУЩАЯ ИНФОРМАЦИЯ:
Сегодняшняя дата: ${today}
Завтрашняя дата: ${tomorrow}

Доступные мастера: ${SALON_DATA.masters.map((m) => m.name).join(", ")}

КРИТИЧЕСКИ ВАЖНО - ready = true ТОЛЬКО ЕСЛИ:
1. Есть КОНКРЕТНОЕ название услуги (не просто "маникюр" или "брови", а "Коррекция бровей", "Маникюр с укреплением")
2. Есть ТОЧНАЯ цена в тенге (должна соответствовать конкретной услуге)
3. Есть имя мастера
4. Есть дата в формате YYYY-MM-DD
5. Есть время в формате HH:MM
6. Бот УЖЕ показал клиенту список услуг с ценами и клиент ВЫБРАЛ конкретную

ПРАВИЛА ОПРЕДЕЛЕНИЯ УСЛУГИ:
- "маникюр" БЕЗ уточнения - это НЕ конкретная услуга → ready = false
- "брови" БЕЗ уточнения - это НЕ конкретная услуга → ready = false
- "Коррекция бровей" - конкретная услуга → можно ready = true (если есть остальное)
- "Маникюр с укреплением" - конкретная услуга → можно ready = true (если есть остальное)

ЕСЛИ В ДИАЛОГЕ:
- Бот только спросил "какую услугу?" - ready ДОЛЖНО БЫТЬ false
- Бот показал прайс и ждёт выбора - ready ДОЛЖНО БЫТЬ false
- Клиент сказал общее ("маникюр", "брови") без уточнения - ready ДОЛЖНО БЫТЬ false
- Бот уже сказал что время занято - ready ДОЛЖНО БЫТЬ false
- Бот уже отправил запрос администратору - ready ДОЛЖНО БЫТЬ false

ЦЕНА должна СТРОГО соответствовать выбранной услуге из этого списка:
${SALON_DATA.services
  .map((s) => `${s.name} (${s.master}) - ${s.price} тг`)
  .join("\n")}

ПРАВИЛА ОПРЕДЕЛЕНИЯ ДАТЫ:
- "сегодня" → ${today}
- "завтра" → ${tomorrow}
- Конкретное число → преобразуй в YYYY-MM-DD
- НЕ указана → null

ПРАВИЛА ОПРЕДЕЛЕНИЯ ВРЕМЕНИ:
- Извлекай ТОЧНОЕ время
- "11 утра" или "в 11:00" → "11:00"
- "14:30" → "14:30"
- НЕ указано → null

Ответь ТОЛЬКО в формате JSON:
{
  "ready": true/false,
  "service": "ТОЧНОЕ название услуги или null",
  "master": "имя мастера или null",
  "price": число или null,
  "date": "YYYY-MM-DD или null",
  "time": "HH:MM или null",
  "reason": "почему ready=false (если false)"
}

Примеры:

ПРИМЕР 1 - ready = FALSE (нет конкретной услуги):
Клиент: "Хочу на брови сегодня в 11"
Бот: "Отлично! У нас есть услуги: Коррекция - 1500 тг, Окрашивание - 2000 тг..."
→ {"ready": false, "reason": "клиент не выбрал конкретную услугу"}

ПРИМЕР 2 - ready = TRUE (все данные есть):
Клиент: "Хочу на брови сегодня в 11"
Бот: "У нас есть: Коррекция - 1500, Окрашивание - 2000. Что выберете?"
Клиент: "Коррекцию"
Бот: "Записываю на Коррекцию бровей к Лене..."
→ {"ready": true, "service": "Коррекция бровей воск/пинцет", "master": "Лена", "price": 1500, "date": "${today}", "time": "11:00"}`;

    const result = await model.generateContent(prompt);
    const response = result.response.text();

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);

      // Проверка что все данные есть
      const isReady =
        data.ready &&
        data.service &&
        data.master &&
        data.price &&
        data.date &&
        data.time;

      console.log("📋 Детекция записи:", {
        ready: isReady,
        service: data.service,
        master: data.master,
        price: data.price,
        date: data.date,
        time: data.time,
        reason: data.reason || "все данные готовы",
      });

      // Если намерение готово, ПРОВЕРЯЕМ ДОСТУПНОСТЬ В БД
      if (isReady) {
        // Поиск длительности услуги
        const serviceObj = SALON_DATA.services.find(
          (s) =>
            s.name === data.service ||
            s.name.toLowerCase().includes(data.service.toLowerCase())
        );
        const duration = serviceObj ? serviceObj.duration : 60;

        const isFree = await checkAvailability(
          data.master,
          data.date,
          data.time,
          duration
        );

        if (!isFree) {
          console.log(
            `⛔ Слот занят: ${data.master} ${data.date} ${data.time}`
          );
          return { ready: false, data: data, slotBusy: true };
        }
      }

      return { ready: isReady, data: data };
    }
  } catch (error) {
    console.error("Ошибка определения намерения:", error);
  }

  return { ready: false, data: null };
}

// Проверка занятости слота через таблицу bookings
async function checkAvailability(masterName, date, time, durationMinutes = 60) {
  if (!masterName || !date || !time) return true;

  try {
    // Приводим время к формату HH:MM
    let checkTime = time;
    if (typeof time === "string" && time.length > 5) {
      checkTime = time.substring(0, 5);
    }

    // SQL для поиска пересечений с учетом длительности услуги
    // Проверяем записи со статусом 'confirmed' и 'pending'
    const result = await pool.query(
      `
      SELECT id, service, time, 
             COALESCE(duration, 60) as duration
      FROM bookings 
      WHERE status IN ('confirmed', 'pending')
      AND master = $1 
      AND date = $2
      AND (
          -- Проверяем пересечение временных интервалов
          (time, (COALESCE(duration, 60) || ' minutes')::interval) OVERLAPS 
          ($3::time, ($4 || ' minutes')::interval)
      )
      `,
      [masterName, date, checkTime, durationMinutes]
    );

    if (result.rows.length > 0) {
      console.log(`⛔ Время занято: ${masterName} ${date} ${checkTime}`);
      console.log(
        `   Конфликт с записью #${result.rows[0].id}: ${result.rows[0].service}`
      );
      return false;
    }

    console.log(`✅ Время свободно: ${masterName} ${date} ${checkTime}`);
    return true;
  } catch (error) {
    console.error("❌ Ошибка проверки доступности:", error);
    return false; // При ошибке считаем время занятым (безопаснее)
  }
}
// Получение свободных временных окон для мастера на дату
async function getAvailableSlots(masterName, date) {
  try {
    // Рабочие часы салона: 10:00 - 21:00
    const workStart = 10;
    const workEnd = 21;
    const slotDuration = 60; // Проверяем слоты по 60 минут

    // Получаем все записи мастера на эту дату
    const result = await pool.query(
      `SELECT time, COALESCE(duration, 60) as duration
       FROM bookings 
       WHERE master = $1 
       AND date = $2 
       AND status IN ('confirmed', 'pending')
       ORDER BY time`,
      [masterName, date]
    );

    const bookedSlots = result.rows;
    const availableSlots = [];

    // Проверяем каждый час с 10:00 до 21:00
    for (let hour = workStart; hour < workEnd; hour++) {
      const slotTime = `${String(hour).padStart(2, "0")}:00`;

      // Проверяем, свободен ли этот слот
      const isSlotFree = await checkAvailability(
        masterName,
        date,
        slotTime,
        slotDuration
      );

      if (isSlotFree) {
        availableSlots.push(slotTime);
      }
    }

    return availableSlots;
  } catch (error) {
    console.error("❌ Ошибка получения свободных окон:", error);
    return [];
  }
}
// Инициация подтверждения записи
async function initiateBookingConfirmation(message, conversation, bookingData) {
  // 1. Rate Limiting: Проверка на спам (не более 5 записей в час)
  try {
    const rateLimitCheck = await pool.query(
      `SELECT COUNT(*) FROM bookings 
			WHERE user_id = $1 
			AND created_at > NOW() - INTERVAL '1 hour'`,
      [message.from]
    );

    if (parseInt(rateLimitCheck.rows[0].count) >= 5) {
      console.log(`⛔ Rate limit exceeded for ${message.from}`);
      return await message.reply(
        "⚠️ Вы создали слишком много заявок за последний час. Пожалуйста, подождите немного."
      );
    }
  } catch (e) {
    console.error("Ошибка rate limit:", e);
  }

  // Используем сохраненный телефон из разговора, если есть
  const clientPhone =
    conversation.client_phone ||
    (await extractPhoneNumber(message.from, message));

  // Используем имя из conversation, если нет - пытаемся получить из БД
  let clientName = conversation.client_name;
  if (!clientName || clientName === "Клиент") {
    // Попытка получить имя из таблицы clients
    try {
      const result = await pool.query(
        "SELECT name FROM clients WHERE phone = $1",
        [clientPhone]
      );
      if (result.rows.length > 0 && result.rows[0].name) {
        clientName = result.rows[0].name;
      } else {
        clientName = "Клиент";
      }
    } catch (error) {
      console.error("Ошибка получения имени клиента:", error);
      clientName = "Клиент";
    }
  }

  try {
    // Находим длительность услуги из SALON_DATA
    const serviceObj = SALON_DATA.services.find(
      (s) =>
        s.name === bookingData.service &&
        (s.master === bookingData.master || s.master === "другие")
    );
    const serviceDuration = serviceObj ? serviceObj.duration : 60;

    console.log(
      `📋 Создание записи: ${bookingData.service} (${serviceDuration} мин)`
    );
    console.log(`👤 Мастер: ${bookingData.master}`);
    console.log(`📅 Дата: ${bookingData.date}, Время: ${bookingData.time}`);

    // Финальная проверка доступности перед созданием записи
    const isFree = await checkAvailability(
      bookingData.master,
      bookingData.date,
      bookingData.time,
      serviceDuration
    );

    if (!isFree) {
      console.log(
        `⛔ Слот занят при финальной проверке: ${bookingData.master} ${bookingData.date} ${bookingData.time}`
      );

      // Предлагаем альтернативные варианты
      const availableSlots = await getAvailableSlots(
        bookingData.master,
        bookingData.date
      );

      let alternativeMessage = `⚠️ Извините, время ${
        bookingData.time
      } на ${formatDateForDisplay(bookingData.date)} к мастеру ${
        bookingData.master
      } уже занято! 😔`;

      if (availableSlots.length > 0) {
        const slotsText = availableSlots
          .slice(0, 5)
          .map((time) => `• ${time}`)
          .join("\n");
        alternativeMessage += `\n\n✨ Доступное время на эту дату:\n${slotsText}\n\nВыберите другое время!`;
      } else {
        alternativeMessage += `\n\nК сожалению, на эту дату все занято. Попробуйте выбрать другой день! 🤍`;
      }

      return await message.reply(alternativeMessage);
    }

    // Создаем запись с длительностью
    const result = await pool.query(
      `INSERT INTO bookings (user_id, client_name, client_phone, service, master, price, date, time, duration, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
      RETURNING id`,
      [
        message.from,
        clientName,
        clientPhone,
        bookingData.service,
        bookingData.master,
        bookingData.price,
        bookingData.date,
        bookingData.time,
        serviceDuration,
      ]
    );

    const bookingId = result.rows[0].id;
    console.log(
      `✅ Запись #${bookingId} создана с длительностью ${serviceDuration} мин`
    );

    conversation.booking_data = {
      ...bookingData,
      id: bookingId,
      duration: serviceDuration,
    };

    // Добавляем системное сообщение в историю, чтобы предотвратить повторное создание
    conversation.history.push({
      role: "assistant",
      content: `СИСТЕМНОЕ СООБЩЕНИЕ: Запрос на запись #${bookingId} отправлен администратору. Не создавай новую запись по тем же данным.`,
      timestamp: new Date().toISOString(),
    });

    await saveConversation(conversation);

    // Уведомление клиента
    // Уведомление клиента (КРАТКОЕ)
    // Уведомление клиента
    await message.reply(
      `Отлично, ${clientName}! Я отправила ваш запрос администратору ✨\n\nДетали записи:\n📋 Услуга: ${
        bookingData.service
      }\n👤 Мастер: ${bookingData.master}\n💰 Цена: ${
        bookingData.price
      } тг\n⏱️ Длительность: ${serviceDuration} мин\n📅 Дата: ${formatDateForDisplay(
        bookingData.date
      )}\n🕐 Время: ${
        bookingData.time
      }\n\nВ ближайшее время с вами свяжется администратор! 🤍`
    );

    // Уведомление админов
    await notifyAdmins(bookingId);

    console.log(`✅ Создана запись #${bookingId} для ${clientName}`);
  } catch (error) {
    console.error("Ошибка создания записи:", error);
    console.error("Детали ошибки:", error.stack);
    await message.reply(
      "Произошла ошибка при создании записи. Пожалуйста, попробуйте еще раз или свяжитесь с администратором."
    );
  }
}

// Уведомление администраторов
// Уведомление администраторов
async function notifyAdmins(bookingId) {
  try {
    const result = await pool.query("SELECT * FROM bookings WHERE id = $1", [
      bookingId,
    ]);
    const booking = result.rows[0];

    if (!booking) return;

    // Форматирование даты
    const dateObj =
      typeof booking.date === "string"
        ? new Date(booking.date + "T00:00:00")
        : booking.date;
    const formattedDate = dateObj.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    // Форматирование времени (убираем секунды)
    let formattedTime = booking.time;
    if (typeof booking.time === "object") {
      // Если это объект Time из PostgreSQL
      const hours = String(booking.time.hours || 0).padStart(2, "0");
      const minutes = String(booking.time.minutes || 0).padStart(2, "0");
      formattedTime = `${hours}:${minutes}`;
    } else if (typeof booking.time === "string") {
      // Если это строка "14:00:00"
      formattedTime = booking.time.substring(0, 5);
    }

    const adminMessage = `🔔 НОВАЯ ЗАПИСЬ #${booking.id}

👤 Клиент: ${booking.client_name}
📱 Телефон: ${booking.client_phone}

📋 Услуга: ${booking.service}
👨‍💼 Мастер: ${booking.master}
💰 Цена: ${booking.price} тг
📅 Дата: ${formattedDate}
🕐 Время: ${formattedTime}

✅ Подтвердить: /ok ${booking.id}
❌ Отклонить: /no ${booking.id}`;

    for (const adminId of CONFIG.ADMIN_WHITELIST) {
      try {
        await whatsappClient.sendMessage(adminId, adminMessage);
        console.log(`✅ Уведомление отправлено админу: ${adminId}`);
      } catch (error) {
        console.error(`❌ Ошибка отправки админу ${adminId}:`, error);
      }
    }
  } catch (error) {
    console.error("Ошибка уведомления админов:", error);
  }
}

// Функция детекции отмены
// Функция детекции отмены
async function detectCancellation(userId, messageText) {
  const lower = messageText.toLowerCase().trim();
  
  // Ключевые слова отмены
  const cancelKeywords = [
    "отмени",
    "отмена",
    "передумал",
    "передумала",
    "не хочу",
    "удали запись",
    "не приду",
    "отменить",
    "сброс"
  ];

  if (cancelKeywords.some((w) => lower.includes(w))) {
    console.log(`🚫 Обнаружена попытка отмены от ${userId}: "${messageText}"`);
    
    try {
      // Ищем активные записи (pending или confirmed)
      const res = await pool.query(
        `SELECT id, status, service, date, time FROM bookings 
         WHERE user_id = $1 AND status IN ('pending', 'confirmed')
         ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );

      if (res.rows.length > 0) {
        const booking = res.rows[0];
        
        // Отменяем запись
        await pool.query(
          "UPDATE bookings SET status = 'cancelled' WHERE id = $1",
          [booking.id]
        );
        
        console.log(`🚫 Запись #${booking.id} (${booking.status}) отменена пользователем`);
        
        // Уведомляем админов если запись была подтверждена
        if (booking.status === 'confirmed') {
          await notifyAdminsCancellation(booking.id, booking);
        }
        
        return true;
      } else {
        console.log(`⚠️ У пользователя ${userId} нет активных записей для отмены`);
        // Сбрасываем сессию на всякий случай
        await resetSession(userId, true);
        return true; // Возвращаем true чтобы показать что обработали намерение
      }
    } catch (e) {
      console.error("Ошибка при отмене:", e);
    }
  }
  return false;
}

// Уведомление об отмене (улучшенное)
async function notifyAdminsCancellation(bookingId, booking) {
  for (const adminId of CONFIG.ADMIN_WHITELIST) {
    try {
      await whatsappClient.sendMessage(
        adminId,
        `⚠️ ОТМЕНА ЗАПИСИ #${bookingId}\n\nКлиент отменил подтвержденную запись:\n📋 ${booking.service}\n📅 ${booking.date}\n🕐 ${booking.time}`
      );
    } catch (e) {
      console.error(`Ошибка уведомления админа ${adminId}:`, e);
    }
  }
}

// Уведомление об отмене
async function notifyAdminsCancellation(bookingId) {
  for (const adminId of CONFIG.ADMIN_WHITELIST) {
    try {
      await whatsappClient.sendMessage(
        adminId,
        `⚠️ Клиент отменил запись #${bookingId}!`
      );
    } catch (e) {}
  }
}

// Обработка ответа администратора
async function confirmBooking(message, command) {
  const bookingId = command.split(" ")[1];

  try {
    const result = await pool.query("SELECT * FROM bookings WHERE id = $1", [
      bookingId,
    ]);
    const booking = result.rows[0];

    if (!booking) {
      return await message.reply("❌ Запись не найдена");
    }

    if (booking.status === "confirmed") {
      return await message.reply(`⚠️ Запись #${bookingId} уже подтверждена`);
    }

    if (booking.status === "rejected") {
      return await message.reply(`⚠️ Запись #${bookingId} была отклонена`);
    }

    await pool.query(
      "UPDATE bookings SET status = $1, confirmed_at = CURRENT_TIMESTAMP WHERE id = $2",
      ["confirmed", bookingId]
    );

    // Сразу отвечаем админу, чтобы не ждать остальные операции
    await message.reply(
      `✅ Запись #${bookingId} подтверждена\nКлиент ${booking.client_name} уведомлен`
    );

    // Добавление в календарь
    await addToCalendar(booking);

    // Обновление статистики
    await updateStatistics(booking);

    // Форматирование даты для сообщения
    const dateObj =
      typeof booking.date === "string"
        ? new Date(booking.date + "T00:00:00")
        : booking.date;
    const formattedDate = dateObj.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    // Форматирование времени
    let formattedTime = String(booking.time);
    if (typeof booking.time === "object") {
      const hours = String(booking.time.hours || 0).padStart(2, "0");
      const minutes = String(booking.time.minutes || 0).padStart(2, "0");
      formattedTime = `${hours}:${minutes}`;
    } else {
      formattedTime = formattedTime.substring(0, 5);
    }

    await whatsappClient.sendMessage(
      booking.user_id,
      `✅ Ваша запись подтверждена!\n\n📋 ${booking.service}\n👤 Мастер: ${booking.master}\n💰 ${booking.price} тг\n📅 ${formattedDate}\n🕐 ${formattedTime}\n\nЖдем вас в ${CONFIG.SALON_NAME}! ✨`
    );

    // Добавляем системное сообщение в историю, чтобы бот знал, что запись создана
    try {
      const conversation = await getConversation(booking.user_id);
      if (conversation) {
        conversation.history.push({
          role: "assistant",
          content: `СИСТЕМНОЕ СООБЩЕНИЕ: Запись #${bookingId} успешно создана. Ожидание новой команды.`,
          timestamp: new Date().toISOString(),
        });
        await saveConversation(conversation);
      }
    } catch (e) {
      console.error("Ошибка обновления истории после подтверждения:", e);
    }
  } catch (error) {
    console.error("Ошибка подтверждения:", error);
    await message.reply("Произошла ошибка при подтверждении");
  }
}

async function rejectBooking(message, command) {
  const bookingId = command.split(" ")[1];

  try {
    const result = await pool.query("SELECT * FROM bookings WHERE id = $1", [
      bookingId,
    ]);
    const booking = result.rows[0];

    if (!booking) {
      return await message.reply("❌ Запись не найдена");
    }

    if (booking.status === "confirmed") {
      return await message.reply(`⚠️ Запись #${bookingId} уже подтверждена`);
    }

    if (booking.status === "rejected") {
      return await message.reply(`⚠️ Запись #${bookingId} уже отклонена`);
    }

    await pool.query("UPDATE bookings SET status = $1 WHERE id = $2", [
      "rejected",
      bookingId,
    ]);

    // Сразу отвечаем админу
    await message.reply(
      `❌ Запись #${bookingId} отклонена\nКлиент ${booking.client_name} уведомлен`
    );

    // Уведомление клиента
    // Уведомление клиента
    await whatsappClient.sendMessage(
      booking.user_id,
      `К сожалению, не можем подтвердить запись на это время 😔\n\nПожалуйста, выберите другое время! Напишите нам снова 🤍`
    );
  } catch (error) {
    console.error("Ошибка отклонения:", error);
    await message.reply("Произошла ошибка при отклонении");
  }
}

// Добавление в Google Calendar
async function addToCalendar(booking) {
  if (!calendar) {
    console.log("⚠️ Google Calendar не настроен");
    return;
  }

  try {
    // Нормализация даты (YYYY-MM-DD)
    let dateStr = "";
    if (booking.date instanceof Date) {
      const year = booking.date.getFullYear();
      const month = String(booking.date.getMonth() + 1).padStart(2, "0");
      const day = String(booking.date.getDate()).padStart(2, "0");
      dateStr = `${year}-${month}-${day}`;
    } else {
      // Если строка, предполагаем YYYY-MM-DD, берем первые 10 символов
      dateStr = String(booking.date).substring(0, 10);
    }

    // Нормализация времени (HH:MM)
    let timeStr = "";
    if (typeof booking.time === "object") {
      const hours = String(booking.time.hours || 0).padStart(2, "0");
      const minutes = String(booking.time.minutes || 0).padStart(2, "0");
      timeStr = `${hours}:${minutes}`;
    } else {
      timeStr = String(booking.time).substring(0, 5);
    }

    const startDate = new Date(`${dateStr}T${timeStr}:00`);
    const endDate = new Date(startDate.getTime() + 90 * 60000);

    const event = {
      summary: `${booking.service} - ${booking.master}`,
      description: `Клиент: ${
        booking.client_name || booking.user_id
      }\nТелефон: ${booking.client_phone}`,
      start: {
        dateTime: startDate.toISOString(),
        timeZone: "Asia/Almaty",
      },
      end: {
        dateTime: endDate.toISOString(),
        timeZone: "Asia/Almaty",
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "popup", minutes: 60 },
          { method: "popup", minutes: 1440 },
        ],
      },
    };

    await calendar.events.insert({
      calendarId: CONFIG.CALENDAR_ID,
      resource: event,
    });

    console.log("✅ Запись добавлена в Google Calendar");
  } catch (error) {
    console.error("❌ Ошибка добавления в календарь:", error);
  }
}

// Обновление статистики
async function updateStatistics(booking) {
  try {
    await pool.query(
      `UPDATE statistics
			SET total_bookings = total_bookings + 1,
				confirmed_bookings = confirmed_bookings + 1,
				revenue = revenue + $1,
				updated_at = CURRENT_TIMESTAMP
			WHERE master_name = $2`,
      [booking.price, booking.master]
    );

    // Обновление данных клиента
    await pool.query(
      `UPDATE clients
			SET total_visits = total_visits + 1,
				total_spent = total_spent + $1,
				last_visit = CURRENT_TIMESTAMP
			WHERE phone = $2`,
      [booking.price, booking.client_phone]
    );

    console.log(`✅ Статистика обновлена для ${booking.master}`);
  } catch (error) {
    console.error("Ошибка обновления статистики:", error);
  }
}

// Отправка статистики
async function sendAdminStats(message) {
  try {
    const result = await pool.query(
      "SELECT * FROM statistics ORDER BY revenue DESC"
    );
    let statsText = `📊 СТАТИСТИКА САЛОНА\n\n`;

    result.rows.forEach((stats) => {
      statsText += `👤 ${stats.master_name}\n`;
      statsText += `   📝 Всего записей: ${stats.total_bookings}\n`;
      statsText += `   ✅ Подтверждено: ${stats.confirmed_bookings}\n`;
      statsText += `   💰 Доход: ${stats.revenue.toLocaleString()} тг\n\n`;
    });

    // Общая статистика
    const totalRevenue = result.rows.reduce(
      (sum, s) => sum + parseInt(s.revenue),
      0
    );
    const totalBookings = result.rows.reduce(
      (sum, s) => sum + parseInt(s.total_bookings),
      0
    );

    const conversationsCount = await pool.query(
      "SELECT COUNT(*) FROM conversations"
    );

    statsText += `📈 ОБЩАЯ СТАТИСТИКА\n`;
    statsText += `Всего записей: ${totalBookings}\n`;
    statsText += `Общий доход: ${totalRevenue.toLocaleString()} тг\n`;
    statsText += `Активных диалогов: ${conversationsCount.rows[0].count}`;

    await message.reply(statsText);
  } catch (error) {
    console.error("Ошибка получения статистики:", error);
    await message.reply("Ошибка получения статистики");
  }
}
function startReminderScheduler() {
  const cron = require("node-cron");

  cron.schedule("*/30 * * * *", async () => {
    try {
      const now = new Date();
      const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

      const result = await pool.query(
        `SELECT * FROM bookings 
				WHERE status = 'confirmed' 
				AND reminder_sent = FALSE 
				AND date = $1 
				AND time BETWEEN $2 AND $3`,
        [
          oneHourLater.toISOString().split("T")[0],
          now.toTimeString().split(" ")[0].substring(0, 5),
          oneHourLater.toTimeString().split(" ")[0].substring(0, 5),
        ]
      );

      console.log(
        `⏰ Проверка напоминаний: найдено ${result.rows.length} записей`
      );

      for (const booking of result.rows) {
        try {
          await whatsappClient.sendMessage(
            booking.user_id,
            `⏰ НАПОМИНАНИЕ О ЗАПИСИ\n\nЗдравствуйте, ${booking.client_name}!\n\nНапоминаем, что сегодня в ${booking.time} у вас запись:\n\n📋 ${booking.service}\n👤 Мастер: ${booking.master}\n📍 Адрес: ${CONFIG.SALON_ADDRESS}\n\nЖдём вас! ✨`
          );

          await pool.query(
            "UPDATE bookings SET reminder_sent = TRUE WHERE id = $1",
            [booking.id]
          );

          console.log(`✅ Напоминание отправлено: ${booking.client_name}`);
        } catch (error) {
          console.error(
            `Ошибка отправки напоминания для ${booking.id}:`,
            error
          );
        }
      }
    } catch (error) {
      console.error("Ошибка в системе напоминаний:", error);
    }
  });

  console.log("✅ Система напоминаний запущена (проверка каждые 30 минут)");
}
// ===================== ПЛАНИРОВЩИК ОЧИСТКИ СЕССИЙ =====================
function startSessionCleanup() {
  const cron = require("node-cron");

  // Проверка каждые 15 минут
  cron.schedule("*/15 * * * *", async () => {
    try {
      console.log("🧹 Проверка истекших сессий (фоновая очистка)...");

      // Находим все сессии старше 30 минут которые НЕ в стадии greeting
      const expiredSessions = await pool.query(
        `SELECT user_id, client_name, updated_at, stage
         FROM conversations 
         WHERE updated_at < NOW() - INTERVAL '30 minutes'
         AND stage != 'greeting'`
      );

      if (expiredSessions.rows.length > 0) {
        console.log(`⏰ Найдено ${expiredSessions.rows.length} истекших сессий для фоновой очистки`);

        for (const session of expiredSessions.rows) {
          // Только сбрасываем без уведомления (фоновая очистка)
          await resetSession(session.user_id, true);
          
          console.log(`✅ Фоновая очистка сессии: ${session.client_name || session.user_id} (неактивна ${Math.round((Date.now() - new Date(session.updated_at)) / (1000 * 60))} мин)`);
        }
      } else {
        console.log("✅ Истекших сессий не найдено");
      }
    } catch (error) {
      console.error("❌ Ошибка фоновой очистки сессий:", error);
    }
  });

  console.log("✅ Планировщик фоновой очистки сессий запущен (проверка каждые 15 минут)");
}
// ===================== ЗАПУСК БОТА =====================
async function startBot() {
  console.log("🚀 Запуск бота La Mirage...");

  validateConfig();
  await initDatabase();
  initGemini();
  await initGoogleCalendar();
  await initWhatsApp();

  // Запуск системы напоминаний
  startSessionCleanup();
}

if (CONFIG.NODE_ENV !== "test" && require.main === module) {
  startBot().catch(console.error);
}

process.on("SIGINT", async () => {
  console.log("\n👋 Остановка бота...");
  if (whatsappClient) {
    await whatsappClient.destroy();
  }
  await pool.end();
  process.exit(0);
});

module.exports = {
  CONFIG,
  SALON_DATA,
  MASTERS,
  PRICES,
  initDatabase,
  startBot,
  checkAvailability,
  getAvailableSlots,
  checkSessionExpiry, // НОВОЕ
  resetSession, // НОВОЕ
  notifySessionExpired, // НОВОЕ
};
