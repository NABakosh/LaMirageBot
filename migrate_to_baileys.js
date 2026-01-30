// Скрипт автоматической миграции main.js с whatsapp-web.js на Baileys
// Запуск: node migrate_to_baileys.js

const fs = require('fs');
const path = require('path');

const MAIN_JS_PATH = path.join(__dirname, 'main.js');
const BACKUP_PATH = path.join(__dirname, 'main.js.backup');

console.log('🔄 Начинаю автоматическую миграцию main.js на Baileys...\n');

// Создаем дляам main.js
if (fs.existsSync(BACKUP_PATH)) {
    console.log(`⚠️  Backup уже существует: ${BACKUP_PATH}`);
    console.log('Удалите его вручную если хотите создать новый backup\n');
} else {
    fs.copyFileSync(MAIN_JS_PATH, BACKUP_PATH);
    console.log(`✅ Backup создан: ${BACKUP_PATH}\n`);
}

// Читаем файл
let content = fs.readFileSync(MAIN_JS_PATH, 'utf8');

console.log('📝 Выполняю замены...\n');

// Список всех замен
const replacements = [
    // 1. Удаляем проверку message.fromMe и message.from - она уже в initWhatsApp
    {
        from: /\/\/ Игнорируем сообщения от ботов и групп[\s\S]*?if \(message\.fromMe \|\| message\.from\.includes\('@g\.us'\)\) \{[\s\S]*?return[\s\S]*?\}/g,
        to: '// Проверка fromMe и групп теперь в initWhatsApp()',
        description: 'Удалена дубликат проверка message.fromMe (уже в initWhatsApp)'
    },
    
    // 2. Замены вызовов message.reply
    {
        from: /await message\.reply\(/g,
        to: 'await replyMessage(sock, msg, ',
        description: 'message.reply → replyMessage(sock, msg,'
    },
    
    // 3. Замены whatsappClient.sendMessage
    {
        from: /await whatsappClient\.sendMessage\(/g,
        to: 'await sendMessage(sock, ',
        description: 'whatsappClient.sendMessage → sendMessage(sock,'
    },
    {
        from: /whatsappClient\.sendMessage\(/g,
        to: 'sendMessage(sock, ',
        description: 'whatsappClient.sendMessage → sendMessage(sock,'
    },
    
    // 4. Сигнатуры функций админа
    {
        from: /async function sendAdminStats\(message\)/g,
        to: 'async function sendAdminStats(msg, sock)',
        description: 'sendAdminStats signature'
    },
    {
        from: /async function sendDashboardLink\(message\)/g,
        to: 'async function sendDashboardLink(msg, sock)',
        description: 'sendDashboardLink signature'
    },
    {
        from: /async function confirmBooking\(message,/g,
        to: 'async function confirmBooking(msg, sock,',
        description: 'confirmBooking signature'
    },
    {
        from: /async function rejectBooking\(message,/g,
        to: 'async function rejectBooking(msg, sock,',
        description: 'rejectBooking signature'
    },
    {
        from: /async function sendGreeting\(message\)/g,
        to: 'async function sendGreeting(msg, sock)',
        description: 'sendGreeting signature'
    },
    {
        from: /async function generateAndSendResponse\(message, conversation\)/g,
        to: 'async function generateAndSendResponse(msg, conversation, sock)',
        description: 'generateAndSendResponse signature'
    },
    {
        from: /async function detectCancellation\(userId, userMessage\)/g,
        to: 'async function detectCancellation(userId, userMessage, sock)',
        description: 'detectCancellation signature'
    },
    
    // 5. Вызовы админ-функций - добавляем sock
    {
        from: /return await sendAdminStats\(message\)/g,
        to: 'return await sendAdminStats(msg, sock)',
        description: 'sendAdminStats call'
    },
    {
        from: /return await sendDashboardLink\(message\)/g,
        to: 'return await sendDashboardLink(msg, sock)',
        description: 'sendDashboardLink call'
    },
    {
        from: /return await confirmBooking\(message,/g,
        to: 'return await confirmBooking(msg, sock,',
        description: 'confirmBooking call'
    },
    {
        from: /return await rejectBooking\(message,/g,
        to: 'return await rejectBooking(msg, sock,',
        description: 'rejectBooking call'
    },
    {
        from: /await sendGreeting\(message\)/g,
        to: 'await sendGreeting(msg, sock)',
        description: 'sendGre greeting call'
    },
    {
        from: /await generateAndSendResponse\(message, conversation\)/g,
        to: 'await generateAndSendResponse(msg, conversation, sock)',
        description: 'generateAndSendResponse call'
    },
    {
        from: /await detectCancellation\(conversation\.user_id, message\.body\)/g,
        to: 'await detectCancellation(conversation.user_id, userMessage, sock)',
        description: 'detectCancellation call'
    },
    
    // 6. extractPhoneNumber calls - обновляем для Baileys
    {
        from: /await extractPhoneNumber\(userId, message\)/g,
        to: 'await extractPhoneNumber(userId)',
        description: 'extractPhoneNumber call (message parameter removed)'
    },
    {
        from: /await extractPhoneNumber\(message\.from, message\)/g,
        to: 'await extractPhoneNumber(userId)',
        description: 'extractPhoneNumber call'
    },
];

// Применяем все замены
let changeCount = 0;
replacements.forEach((repl, index) => {
    const matches = content.match(repl.from);
    const count = matches ? matches.length : 0;
    
    if (count > 0) {
        content = content.replace(repl.from, repl.to);
        console.log(`  ${index + 1}. ${repl.description}: ${count} замен`);
        changeCount += count;
    }
});

// Сохраняем результат
fs.writeFileSync(MAIN_JS_PATH, content, 'utf8');

console.log(`\n✅ Миграция завершена!`);
console.log(`📊 Всего изменений: ${changeCount}`);
console.log(`\n💾 Файлы:`);
console.log(`   - Оригинал: ${BACKUP_PATH}`);
console.log(`   - Обновленный: ${MAIN_JS_PATH}`);
console.log(`\n🎯 Следующие шаги:`);
console.log(`   1. npm install`);
console.log(`   2. Удалите .wwebjs_auth и .wwebjs_cache если есть`);
console.log(`   3. npm start`);
console.log(`   4. Отсканируйте QR код\n`);
