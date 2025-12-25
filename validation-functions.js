// ===================== ВАЛИДАЦИЯ ЧЕРЕЗ GEMINI AI =====================
async function validateNameWithGemini(userMessage) {
\ttry {
\t\tconst model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' })
\t\tconst prompt = `Проанализируй сообщение пользователя и определи, является ли это настоящим именем человека.

Сообщение: "${userMessage}"

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
"как дела" -> {"isValid": false, "name": null, "message": "Пожалуйста, напишите ваше настоящее имя 😊\\n\\nНапример: Азат, Айгуль, Марат, Диана"}
"привет" -> {"isValid": false, "name": null, "message": "Пожалуйста, напишите ваше имя, а не приветствие 😊"}
"123" -> {"isValid": false, "name": null, "message": "Пожалуйста, напишите ваше имя буквами"}`

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
\t\tconst prompt = `Проанализируй сообщение и извлеки номер телефона.

Сообщение: "${userMessage}"

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
"123" -> {"isValid": false, "phone": null, "message": "Пожалуйста, введите корректный номер телефона\\n\\nНапример:\\n+7 747 122 0635\\n77471220635"}
"привет" -> {"isValid": false, "phone": null, "message": "Пожалуйста, введите номер телефона цифрами"}`

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
\tconst cleanPhone = userMessage.replace(/[^0-9+]/g, '').replace(/^8/, '7')
\tif (cleanPhone.length < 10 || cleanPhone.length > 15) {
\t\treturn {
\t\t\tisValid: false,
\t\t\tphone: null,
\t\t\tmessage: 'Пожалуйста, введите корректный номер телефона\\n\\nНапример:\\n+7 747 122 0635\\n77471220635'
\t\t}
\t}
\treturn { isValid: true, phone: cleanPhone, message: null }
}
