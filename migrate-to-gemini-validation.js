
const fs = require('fs');

// Read the file
const content = fs.readFileSync('main.js', 'utf8');
const lines = content.split('\r\n');

// Find and replace the asking_name section (lines 873-941)
const newAskingNameHandler = `\t// Ждем имя клиента
\tif (conversation.stage === 'asking_name') {
\t\t// Валидация имени через Gemini AI
\t\tconst nameValidation = await validateNameWithGemini(userMessage)
\t\t
\t\tif (!nameValidation.isValid) {
\t\t\treturn await message.reply(nameValidation.message)
\t\t}
\t\t
\t\tconst cleanName = nameValidation.name
\t\tconversation.client_name = cleanName
\t\t
\t\t// Проверяем, нужно ли запрашивать номер телефона (для @lid пользователей)
\t\tconst extractedPhone = await extractPhoneNumber(userId, message)
\t\tconst isLidUser = userId.includes('@lid')
\t\t
\t\tif (isLidUser && extractedPhone === userId.replace(/@.*$/, '')) {
\t\t\t// Это @lid пользователь и реальный номер не получен - запрашиваем
\t\t\tconversation.stage = 'asking_phone'
\t\t\tconversation.client_phone = null // Сбрасываем
\t\t\tawait saveConversation(conversation)
\t\t\t
\t\t\treturn await message.reply(
\t\t\t\t\`Приятно познакомиться, \${cleanName}! ✨\\n\\nДля подтверждения записи мне нужен ваш номер телефона.\\nНапишите, пожалуйста, номер в формате:\\n+7 747 122 0635 или 77471220635\`
\t\t\t)
\t\t} else {
\t\t\t// Обычный пользователь (@c.us) или удалось получить номер
\t\t\tconversation.client_phone = extractedPhone
\t\t\tconversation.stage = 'conversation'
\t\t\tawait saveConversation(conversation)
\t\t\tawait saveClient(
\t\t\t\tconversation.client_phone,
\t\t\t\tconversation.client_name,
\t\t\t\tuserId
\t\t\t)

\t\t\treturn await message.reply(
\t\t\t\t\`Приятно познакомиться, \${cleanName}! ✨\\n\\nЯ помогу вам записаться на услугу. Расскажите, что вас интересует? Или выберите:\\n\\n💅 Маникюр\\n👁 Брови и ресницы\\n🌸 Шугаринг\\n\\nКакой мастер вам удобен и когда вы хотели бы прийти?\`
\t\t\t)
\t\t}
\t}`;

const newAskingPhoneHandler = `\t// Ждем номер телефона (для @lid пользователей)
\tif (conversation.stage === 'asking_phone') {
\t\t// Валидация номера через Gemini AI
\t\tconst phoneValidation = await validatePhoneWithGemini(userMessage)
\t\t
\t\tif (!phoneValidation.isValid) {
\t\t\treturn await message.reply(phoneValidation.message)
\t\t}
\t\t
\t\tconversation.client_phone = phoneValidation.phone
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
\t}`;

// Replace lines 873-941 (asking_name)
lines.splice(873, 69, ...newAskingNameHandler.split('\n'));

// Replace lines for asking_phone (now at different position after first replacement)
const askingPhoneStart = lines.findIndex((line, idx) => idx > 870 && line.includes('// Ждем номер телефона'));
if (askingPhoneStart !== -1) {
\tlines.splice(askingPhoneStart, 25, ...newAskingPhoneHandler.split('\n'));
}

// Add validation functions before handleMessage function
const handleMessageIndex = lines.findIndex(line => line.includes('async function handleMessage(message)'));

const validationFunctions = \`
// ===================== ВАЛИДАЦИЯ ЧЕРЕЗ GEMINI AI =====================
async function validateNameWithGemini(userMessage) {
\ttry {
\t\tconst model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' })
\t\tconst prompt = \\\`Проанализируй сообщение пользователя и определи, является ли это настоящим именем человека.

Сообщение: "\${userMessage}"

ПРАВИЛА:
1. Это должно быть настоящее имя (например: Азат, Айгуль, Марат, Диана, Анна, John)
2. НЕ принимай: вопросы ("как дела", "что"), приветствия ("привет", "здравствуй"), команды, цифры
3. Извлеки только ПЕРВОЕ слово как имя, игнорируй остальное
4. Имя должно быть минимум 2 буквы

Ответь ТОЛЬКО в формате JSON:
{
  "isValid": true/false,
  "name": "извлеченное имя или null",
  "message": "сообщение для пользователя если невалидно, или null"
}

Примеры:
"Азат" -> {"isValid": true, "name": "Азат", "message": null}
"меня зовут Диана" -> {"isValid": true, "name": "Диана", "message": null}
"как дела" -> {"isValid": false, "name": null, "message": "Пожалуйста, напишите ваше настоящее имя 😊\\\\n\\\\nНапример: Азат, Айгуль, Марат, Диана"}
"привет" -> {"isValid": false, "name": null, "message": "Пожалуйста, напишите ваше имя, а не приветствие 😊"}
"123" -> {"isValid": false, "name": null, "message": "Пожалуйста, напишите ваше имя буквами"}
\\\`

\t\tconst result = await model.generateContent(prompt)
\t\tconst response = result.response.text()
\t\tconst jsonMatch = response.match(/\\{[\\s\\S]*\\}/)
\t\t
\t\tif (jsonMatch) {
\t\t\tconst validation = JSON.parse(jsonMatch[0])
\t\t\tconsole.log('📝 Валидация имени:', validation)
\t\t\treturn validation
\t\t}
\t} catch (error) {
\t\tconsole.error('Ошибка валидации имени:', error)
\t}
\t
\t// Fallback на простую валидацию
\tconst cleanName = userMessage.trim().split(/\\s+/)[0]
\tif (cleanName.length < 2 || cleanName.startsWith('/')) {
\t\treturn {
\t\t\tisValid: false,
\t\t\tname: null,
\t\t\tmessage: 'Пожалуйста, напишите ваше имя (минимум 2 буквы)'
\t\t}
\t}
\treturn { isValid: true, name: cleanName, message: null }
}

async function validatePhoneWithGemini(userMessage) {
\ttry {
\t\tconst model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' })
\t\tconst prompt = \\\`Проанализируй сообщение и извлеки номер телефона.

Сообщение: "\${userMessage}"

ПРАВИЛА:
1. Извлеки все цифры из сообщения
2. Номер должен быть от 10 до 15 цифр
3. Убери все символы кроме цифр и плюса в начале
4. Если номер начинается с 8, замени на 7

Ответь ТОЛЬКО в формате JSON:
{
  "isValid": true/false,
  "phone": "очищенный номер или null",
  "message": "сообщение для пользователя если невалидно, или null"
}

Примеры:
"+7 747 122 0635" -> {"isValid": true, "phone": "77471220635", "message": null}
"77471220635" -> {"isValid": true, "phone": "77471220635", "message": null}
"8 747 122 0635" -> {"isValid": true, "phone": "77471220635", "message": null}
"123" -> {"isValid": false, "phone": null, "message": "Пожалуйста, введите корректный номер телефона\\\\n\\\\nНапример:\\\\n+7 747 122 0635\\\\n77471220635"}
"привет" -> {"isValid": false, "phone": null, "message": "Пожалуйста, введите номер телефона цифрами"}
\\\`

\t\tconst result = await model.generateContent(prompt)
\t\tconst response = result.response.text()
\t\tconst jsonMatch = response.match(/\\{[\\s\\S]*\\}/)
\t\t
\t\tif (jsonMatch) {
\t\t\tconst validation = JSON.parse(jsonMatch[0])
\t\t\tconsole.log('📞 Валидация телефона:', validation)
\t\t\treturn validation
\t\t}
\t} catch (error) {
\t\tconsole.error('Ошибка валидации телефона:', error)
\t}
\t
\t// Fallback на простую валидацию
\tconst cleanPhone = userMessage.replace(/[^0-9+]/g, '')
\tif (cleanPhone.length < 10 || cleanPhone.length > 15) {
\t\treturn {
\t\t\tisValid: false,
\t\t\tphone: null,
\t\t\tmessage: 'Пожалуйста, введите корректный номер телефона\\\\n\\\\nНапример:\\\\n+7 747 122 0635\\\\n77471220635'
\t\t}
\t}
\treturn { isValid: true, phone: cleanPhone, message: null }
}
\`;

lines.splice(handleMessageIndex, 0, ...validationFunctions.split('\n'));

// Write back
fs.writeFileSync('main.js', lines.join('\r\n'), 'utf8');

console.log('✅ Validation moved to Gemini AI');
console.log('- Added validateNameWithGemini()');
console.log('- Added validatePhoneWithGemini()');
console.log('- Updated asking_name handler');
console.log('- Updated asking_phone handler');
