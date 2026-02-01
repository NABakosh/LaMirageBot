const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function sendTelegramAlert(level, message, details = {}, token, chatId) {
  if (!token || !chatId) return;

  const emoji = { critical: '🚨', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const text = `${emoji[level] || 'ℹ️'} **${level.toUpperCase()}**\n\n${message}\n\n\`\`\`json\n${JSON.stringify(details, null, 2)}\n\`\`\``;
  
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown'
      })
    });
  } catch (error) {
    console.error('❌ Ошибка отправки Telegram Alert:', error.message);
  }
}

module.exports = { sendTelegramAlert };
