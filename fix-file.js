const fs = require('fs');

// Read the file
const content = fs.readFileSync('main.js', 'utf8');
const lines = content.split('\r\n');

// Remove line 943 (index 942) which contains the duplicate closing bracket  
lines.splice(942, 1);

// Insert the asking_phone handler before line 945 (now 944 after deletion)
const phoneHandler = `
\t// Ждем номер телефона (для @lid пользователей)
\tif (conversation.stage === 'asking_phone') {
\t\t// Очищаем номер от лишних символов
\t\tconst cleanPhone = userMessage.replace(/[^0-9+]/g, '')
\t\t
\t\t// Валидация номера
\t\tif (cleanPhone.length < 10 || cleanPhone.length > 15) {
\t\t\treturn await message.reply(
\t\t\t\t'Пожалуйста, введите корректный номер телефона\\n\\nНапример:\\n+7 747 122 0635\\n77471220635'
\t\t\t)
\t\t}
\t\t
\t\tconversation.client_phone = cleanPhone
\t\tconversation.stage = 'conversation'
\t\tawait saveConversation(conversation)
\t\tawait saveClient(
\t\t\tconversation.client_phone,
\t\t\tconversation.client_name,
\t\t\tuserId
\t\t)
\t\t
\t\treturn await message.reply(
\t\t\t\`Отлично, \${conversation.client_name}! Номер сохранен ✅\\n\\nТеперь расскажите, что вас интересует?\\n\\n💅 Маникюр\\n👁 Брови и ресницы\\n🌸 Шугаринг\\n\\nКакой мастер вам удобен и когда вы хотели бы прийти?\`
\t\t)
\t}
`;

// Insert at position 942 (previously line 943, now one earlier after deletion)
lines.splice(942, 0, ...phoneHandler.trim().split('\n'));

// Write back
fs.writeFileSync('main.js', lines.join('\r\n'), 'utf8');

console.log('✅ File fixed successfully');
console.log('- Removed duplicate closing bracket at line 943');
console.log('- Added asking_phone stage handler');
