// Интеллектуальный тестовый бот с Vertex AI для La Mirage
// Ведёт реальный диалог с ботом, имитируя настоящего клиента

require('dotenv').config();
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { VertexAI } = require('@google-cloud/vertexai');
const pino = require('pino');

// Настройки
const CONFIG = {
  BOT_NUMBER: '77774051062@s.whatsapp.net', // Номер основного бота
  AI_RESPONSE_DELAY: 2000, // Задержка перед ответом AI (имитация набора текста)
  MAX_MESSAGES_PER_SCENARIO: 15, // Максимум сообщений в одном сценарии
  SCENARIO_DELAY: 15000, // Задержка между сценариями
};

// Тестовые сценарии для AI
const TEST_SCENARIOS = [
  {
    name: 'Запись на завтра к Айгерим',
    goal: 'Записаться к мастеру Айгерим на завтра на маникюр с укреплением',
    targetTime: '10:00',
    personality: 'вежливый и дружелюбный клиент'
  },
  {
    name: 'Запись к Юне через 2 дня',
    goal: 'Записаться к мастеру Юна через 2 дня на наращивание ногтей типсы',
    targetTime: '14:00',
    personality: 'занятой клиент, пишет кратко'
  },
  {
    name: 'Запись на конкретную дату',
    goal: 'Записаться на 10 февраля в 16:00 к Айгерим на снятие покрытия',
    targetTime: '16:00',
    personality: 'требовательный клиент, задает много вопросов'
  },
  {
    name: 'Запись сегодня вечером',
    goal: 'Записаться сегодня вечером в 18:00 к Юне на маникюр без покрытия',
    targetTime: '18:00',
    personality: 'новый клиент, не знает всех услуг'
  },
  {
    name: 'Запись с изменением времени',
    goal: 'Записаться завтра, но сначала запросить 15:00, потом передумать и выбрать 17:00 к Айгерим',
    targetTime: '17:00',
    personality: 'нерешительный клиент'
  },
];

// Глобальные переменные
let sock = null;
let vertexAI = null;
let model = null;
let currentScenario = null;
let conversationHistory = [];
let messageCount = 0;
let isWaitingForBot = false;

// Инициализация Vertex AI
function initVertexAI() {
  console.log('🤖 Инициализация Vertex AI...');
  
  vertexAI = new VertexAI({
    project: process.env.VERTEX_PROJECT_ID,
    location: process.env.VERTEX_LOCATION || 'us-central1',
  });

  model = vertexAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 200,
    },
  });
  
  console.log('✅ Vertex AI инициализирован\n');
}

// Задержка
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Создание системного промпта для AI
function createAIPrompt(scenario, botResponse) {
  const historyText = conversationHistory
    .map(msg => `${msg.role === 'user' ? 'Вы' : 'Бот'}: ${msg.text}`)
    .join('\n');

  return `Ты - ${scenario.personality}, который общается с ботом салона красоты La Mirage в WhatsApp.

ТВОЯ ЦЕЛЬ: ${scenario.goal}

ВАЖНЫЕ ДЕТАЛИ:
- Веди себя как реальный клиент
- Отвечай естественно и кратко (1-2 предложения)
- Если бот спрашивает - отвечай на вопрос
- Если бот предлагает варианты - выбирай подходящий
- Когда бот просит подтверждение записи - согласись ("да" или "подтверждаю")
- Не пиши длинные сообщения
- Используй эмодзи иногда, но не слишком много

ИСТОРИЯ ДИАЛОГА:
${historyText}

ПОСЛЕДНЕЕ СООБЩЕНИЕ БОТА:
${botResponse}

Ответь боту как настоящий клиент. Напиши ТОЛЬКО текст своего ответа, без пояснений.`;
}

// Генерация ответа через AI
async function generateAIResponse(botMessage) {
  try {
    console.log('🧠 AI генерирует ответ...');
    
    const prompt = createAIPrompt(currentScenario, botMessage);
    const result = await model.generateContent(prompt);
    const response = result.response.candidates[0].content.parts[0].text.trim();
    
    // Убираем лишние кавычки если есть
    const cleanResponse = response.replace(/^["']|["']$/g, '');
    
    console.log(`💭 AI ответ: "${cleanResponse}"\n`);
    return cleanResponse;
    
  } catch (error) {
    console.error('❌ Ошибка генерации AI:', error.message);
    return 'да'; // Fallback на подтверждение
  }
}

// Отправка сообщения
async function sendMessage(text) {
  try {
    console.log(`📤 Отправка: "${text}"`);
    await sock.sendMessage(CONFIG.BOT_NUMBER, { text });
    
    // Добавляем в историю
    conversationHistory.push({
      role: 'user',
      text: text
    });
    
    messageCount++;
    isWaitingForBot = true;
    
  } catch (error) {
    console.error('❌ Ошибка отправки:', error.message);
  }
}

// Проверка завершения сценария
function isScenarioComplete() {
  // Проверяем последние сообщения на наличие подтверждения
  const recentMessages = conversationHistory.slice(-3);
  const hasConfirmation = recentMessages.some(msg => 
    msg.role === 'bot' && 
    (msg.text.includes('подтверждена') || 
     msg.text.includes('Ждём вас') ||
     msg.text.includes('запись создана'))
  );
  
  return hasConfirmation || messageCount >= CONFIG.MAX_MESSAGES_PER_SCENARIO;
}

// Обработка ответа бота
async function handleBotResponse(message) {
  if (!currentScenario || !isWaitingForBot) return;
  
  console.log(`💬 БОТ: "${message.substring(0, 150)}${message.length > 150 ? '...' : ''}"\n`);
  
  // Добавляем в историю
  conversationHistory.push({
    role: 'bot',
    text: message
  });
  
  isWaitingForBot = false;
  
  // Проверяем завершение
  if (isScenarioComplete()) {
    console.log('✅ Сценарий завершен!\n');
    await finishScenario();
    return;
  }
  
  // Генерируем и отправляем ответ
  await delay(CONFIG.AI_RESPONSE_DELAY);
  const aiResponse = await generateAIResponse(message);
  await sendMessage(aiResponse);
}

// Запуск сценария
async function startScenario(scenario) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🎬 СЦЕНАРИЙ ${TEST_SCENARIOS.indexOf(scenario) + 1}/${TEST_SCENARIOS.length}: ${scenario.name}`);
  console.log(`🎯 Цель: ${scenario.goal}`);
  console.log(`👤 Персонаж: ${scenario.personality}`);
  console.log(`${'='.repeat(70)}\n`);
  
  currentScenario = scenario;
  conversationHistory = [];
  messageCount = 0;
  
  // Первое сообщение - инициация разговора
  const firstMessage = await generateFirstMessage(scenario);
  await sendMessage(firstMessage);
}

// Генерация первого сообщения
async function generateFirstMessage(scenario) {
  const prompt = `Ты - ${scenario.personality}, который хочет записаться в салон красоты.

ТВОЯ ЦЕЛЬ: ${scenario.goal}

Напиши первое сообщение боту салона в WhatsApp. Будь естественным и кратким (1 предложение).
Не пиши всю информацию сразу - начни разговор.

Напиши ТОЛЬКО текст сообщения:`;

  try {
    const result = await model.generateContent(prompt);
    const response = result.response.candidates[0].content.parts[0].text.trim();
    return response.replace(/^["']|["']$/g, '');
  } catch (error) {
    console.error('❌ Ошибка генерации первого сообщения:', error.message);
    return 'Привет! Хочу записаться';
  }
}

// Завершение сценария
async function finishScenario() {
  const scenarioIndex = TEST_SCENARIOS.indexOf(currentScenario);
  
  console.log(`\n� СТАТИСТИКА СЦЕНАРИЯ:`);
  console.log(`   Сообщений отправлено: ${messageCount}`);
  console.log(`   Сообщений в истории: ${conversationHistory.length}`);
  
  // Сохраняем лог диалога
  const dialogLog = conversationHistory
    .map((msg, i) => `${i + 1}. ${msg.role === 'user' ? 'КЛИЕНТ' : 'БОТ'}: ${msg.text}`)
    .join('\n');
  
  console.log(`\n💾 Сохранен лог диалога в test-logs/scenario-${scenarioIndex + 1}.txt\n`);
  
  const fs = require('fs');
  if (!fs.existsSync('./test-logs')) {
    fs.mkdirSync('./test-logs');
  }
  fs.writeFileSync(
    `./test-logs/scenario-${scenarioIndex + 1}-${Date.now()}.txt`,
    `СЦЕНАРИЙ: ${currentScenario.name}\nЦЕЛЬ: ${currentScenario.goal}\n\n${dialogLog}`
  );
  
  currentScenario = null;
  
  // Запускаем следующий сценарий
  if (scenarioIndex < TEST_SCENARIOS.length - 1) {
    console.log(`⏳ Ожидание ${CONFIG.SCENARIO_DELAY / 1000} сек перед следующим сценарием...\n`);
    await delay(CONFIG.SCENARIO_DELAY);
    await startScenario(TEST_SCENARIOS[scenarioIndex + 1]);
  } else {
    console.log('\n🎉 ВСЕ СЦЕНАРИИ ЗАВЕРШЕНЫ!\n');
    console.log('📊 Проверьте логи в папке test-logs/');
    console.log('📅 Проверьте события в Google Calendar');
    console.log('\nДля завершения работы нажмите Ctrl+C\n');
  }
}

// Инициализация WhatsApp бота
async function startTestBot() {
  console.log('📱 Запуск тестового бота...\n');
  
  const { state, saveCreds } = await useMultiFileAuthState('./test-bot-session');
  
  sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
  });
  
  sock.ev.on('creds.update', saveCreds);
  
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      console.log('\n📱 QR КОД СГЕНЕРИРОВАН!\n');
      console.log('Отсканируйте QR код ДРУГИМ телефоном (не тем, на котором работает основной бот)\n');
      
      // Показываем QR в терминале
      const QRCode = require('qrcode-terminal');
      QRCode.generate(qr, { small: true }, (qrcode) => {
        console.log(qrcode);
        console.log('\n');
      });
    }
    
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      
      if (shouldReconnect) {
        console.log('⚠️  Соединение потеряно. Переподключение через 5 секунд...\n');
        await delay(5000);
        startTestBot();
      } else {
        console.log('❌ Вы вышли из системы. Удалите test-bot-session/ и запустите снова для нового QR кода.\n');
      }
    } else if (connection === 'open') {
      console.log('✅ Тестовый бот подключен к WhatsApp!\n');
      console.log(`📞 Отправка сообщений на: ${CONFIG.BOT_NUMBER}\n`);
      console.log('⏳ Запуск тестирования через 3 секунды...\n');
      
      await delay(3000);
      
      // Запускаем первый сценарий
      await startScenario(TEST_SCENARIOS[0]);
    }
  });
  
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message) continue;
      
      const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
      const from = msg.key.remoteJid;
      
      // Обрабатываем только сообщения от основного бота
      if (from === CONFIG.BOT_NUMBER && !msg.key.fromMe) {
        await handleBotResponse(messageText);
      }
    }
  });
}

// Обработка Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n👋 Завершение работы тестового бота...\n');
  process.exit(0);
});

// Главная функция
async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║       AI-POWERED ТЕСТОВЫЙ БОТ LA MIRAGE (VERTEX AI)         ║
╚══════════════════════════════════════════════════════════════╝

Интеллектуальный бот с Vertex AI для реалистичного тестирования.

ВОЗМОЖНОСТИ:
✅ Генерирует ответы как настоящий клиент
✅ Адаптируется к ответам бота
✅ Имитирует разные типы клиентов
✅ Автоматически завершает диалог при подтверждении
✅ Сохраняет логи всех диалогов

ПЕРЕД ЗАПУСКОМ:
1. Основной бот должен работать (npm start)
2. Укажите номер бота в CONFIG.BOT_NUMBER (текущий: ${CONFIG.BOT_NUMBER})
3. Отсканируйте QR код ДРУГИМ телефоном

`);

  // Инициализация
  initVertexAI();
  await startTestBot();
}

// Запуск
main().catch(console.error);
