"""
WhatsApp Integration Example для La Mirage Bot
Пример интеграции с WhatsApp через различные методы
"""

import asyncio
from typing import Dict, Any
from main import MessageHandler, logger

# ===================== ВАРИАНТ 1: TWILIO API (РЕКОМЕНДУЕТСЯ) =====================
class TwilioWhatsAppClient:
    """
    Интеграция с WhatsApp через Twilio API
    Требует: pip install twilio
    Регистрация: https://www.twilio.com/whatsapp
    """
    
    def __init__(self, account_sid: str, auth_token: str, whatsapp_number: str):
        from twilio.rest import Client
        
        self.client = Client(account_sid, auth_token)
        self.whatsapp_number = whatsapp_number
        logger.info("✅ Twilio WhatsApp клиент инициализирован")
    
    async def send_message(self, to: str, message: str):
        """Отправка сообщения"""
        try:
            message = self.client.messages.create(
                from_=f'whatsapp:{self.whatsapp_number}',
                body=message,
                to=f'whatsapp:{to}'
            )
            logger.info(f"✅ Сообщение отправлено через Twilio: {message.sid}")
            return message.sid
        except Exception as e:
            logger.error(f"❌ Ошибка отправки через Twilio: {e}")
            return None
    
    def setup_webhook(self, webhook_url: str):
        """
        Настройка webhook для получения входящих сообщений
        Webhook должен быть доступен публично (используйте ngrok для разработки)
        """
        logger.info(f"📡 Настройте webhook в Twilio Console: {webhook_url}")
        logger.info("   Twilio будет отправлять POST запросы на этот URL")

# ===================== ВАРИАНТ 2: WHATSAPP BUSINESS API =====================
class WhatsAppBusinessAPI:
    """
    Официальный WhatsApp Business API
    Требует регистрации бизнеса и одобрения от Meta
    Документация: https://developers.facebook.com/docs/whatsapp
    """
    
    def __init__(self, access_token: str, phone_number_id: str):
        import requests
        
        self.access_token = access_token
        self.phone_number_id = phone_number_id
        self.base_url = f"https://graph.facebook.com/v18.0/{phone_number_id}/messages"
        logger.info("✅ WhatsApp Business API клиент инициализирован")
    
    async def send_message(self, to: str, message: str):
        """Отправка сообщения"""
        import requests
        
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }
        
        data = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "text",
            "text": {"body": message}
        }
        
        try:
            response = requests.post(self.base_url, headers=headers, json=data)
            response.raise_for_status()
            logger.info(f"✅ Сообщение отправлено через WhatsApp Business API")
            return response.json()
        except Exception as e:
            logger.error(f"❌ Ошибка отправки через WhatsApp Business API: {e}")
            return None

# ===================== ВАРИАНТ 3: WEBHOOK SERVER =====================
class WhatsAppWebhookServer:
    """
    Простой webhook сервер для приема сообщений от WhatsApp
    Работает с Twilio или WhatsApp Business API
    """
    
    def __init__(self, host: str = "0.0.0.0", port: int = 5000):
        self.host = host
        self.port = port
    
    async def start(self):
        """Запуск webhook сервера"""
        from aiohttp import web
        
        app = web.Application()
        app.router.add_post('/webhook', self.handle_webhook)
        app.router.add_get('/webhook', self.verify_webhook)  # Для верификации Twilio
        
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, self.host, self.port)
        await site.start()
        
        logger.info(f"✅ Webhook сервер запущен на http://{self.host}:{self.port}/webhook")
        logger.info("💡 Для разработки используйте ngrok: ngrok http 5000")
    
    async def handle_webhook(self, request):
        """Обработка входящих сообщений"""
        from aiohttp import web
        
        try:
            data = await request.post()
            
            # Извлечение данных (формат зависит от провайдера)
            user_id = data.get('From', '').replace('whatsapp:', '')
            message_text = data.get('Body', '')
            
            if user_id and message_text:
                # Обработка сообщения через MessageHandler
                message_data = {
                    'user_id': user_id,
                    'message': message_text,
                    'from_me': False
                }
                
                await MessageHandler.handle_message(message_data)
                
                logger.info(f"📨 Получено сообщение от {user_id}: {message_text[:50]}...")
            
            return web.Response(text="OK", status=200)
            
        except Exception as e:
            logger.error(f"❌ Ошибка обработки webhook: {e}")
            return web.Response(text="Error", status=500)
    
    async def verify_webhook(self, request):
        """Верификация webhook (для Twilio)"""
        from aiohttp import web
        
        # Twilio отправляет GET запрос для верификации
        return web.Response(text="Webhook verified", status=200)

# ===================== ПРИМЕР ИСПОЛЬЗОВАНИЯ =====================
async def example_twilio_integration():
    """Пример интеграции с Twilio"""
    
    # 1. Инициализация Twilio клиента
    twilio_client = TwilioWhatsAppClient(
        account_sid="YOUR_ACCOUNT_SID",
        auth_token="YOUR_AUTH_TOKEN",
        whatsapp_number="+14155238886"  # Twilio Sandbox номер
    )
    
    # 2. Запуск webhook сервера
    webhook_server = WhatsAppWebhookServer(port=5000)
    await webhook_server.start()
    
    # 3. Настройка webhook в Twilio Console
    # Укажите URL: https://your-domain.com/webhook
    # Для разработки: используйте ngrok
    
    # 4. Отправка тестового сообщения
    await twilio_client.send_message(
        to="+77064240050",
        message="Привет! Это тестовое сообщение от La Mirage Bot 🤖"
    )
    
    logger.info("✅ Twilio интеграция настроена")
    logger.info("📱 Отправьте сообщение на WhatsApp номер Twilio для тестирования")

async def example_business_api_integration():
    """Пример интеграции с WhatsApp Business API"""
    
    # 1. Инициализация Business API клиента
    business_client = WhatsAppBusinessAPI(
        access_token="YOUR_ACCESS_TOKEN",
        phone_number_id="YOUR_PHONE_NUMBER_ID"
    )
    
    # 2. Запуск webhook сервера
    webhook_server = WhatsAppWebhookServer(port=5000)
    await webhook_server.start()
    
    # 3. Настройка webhook в Meta Business Manager
    # Webhook URL: https://your-domain.com/webhook
    # Verify Token: установите свой токен
    
    # 4. Отправка тестового сообщения
    await business_client.send_message(
        to="77064240050",
        message="Привет! Это сообщение от La Mirage Bot через Business API 🤖"
    )
    
    logger.info("✅ WhatsApp Business API интеграция настроена")

# ===================== ВАРИАНТ 4: WHATSAPP BRIDGE (PYTHON LIB) =====================
class WhatsAppBridgeClient:
    """
    Интеграция через библиотеку whatsapp-bridge
    Требует: pip install whatsapp-bridge
    Работает локально через Go bridge
    """
    
    def __init__(self):
        try:
            from whatsapp_bridge import WhatsappClient
            self.client = WhatsappClient()
            self.last_check = 0
            logger.info("✅ WhatsApp Bridge клиент инициализирован")
        except ImportError:
            logger.error("❌ Библиотека whatsapp-bridge не найдена. Установите: pip install whatsapp-bridge")
            raise
    
    async def send_message(self, to: str, message: str):
        """Отправка сообщения"""
        try:
            # whatsapp-bridge требует номер без + или JID
            clean_to = to.replace('+', '').replace(' ', '')
            
            # Если это не JID, предполагаем, что это номер телефона и добавляем суффикс если нужно
            # Но библиотека сама вроде умеет, проверим. 
            # Help говорит: "phone number (with country code, e.g., "1234567890", without any '+' symbol) or a JID"
            
            result = self.client.send_message(clean_to, message)
            if result:
                logger.info(f"✅ Сообщение отправлено через Bridge: {clean_to}")
                return True
            else:
                logger.error(f"❌ Не удалось отправить сообщение через Bridge: {clean_to}")
                return False
        except Exception as e:
            logger.error(f"❌ Ошибка отправки через Bridge: {e}")
            return False

    async def start_polling(self):
        """Запуск опроса сообщений"""
        logger.info("🔄 Запуск опроса сообщений WhatsApp Bridge...")
        
        while True:
            try:
                # Получаем новые сообщения
                messages = self.client.get_new_messages()
                
                if messages:
                    for msg in messages:
                        # Структура сообщения из whatsapp-bridge (примерная, нужно адаптировать под реальный ответ)
                        # Обычно возвращает dict
                        
                        # Логируем для отладки, чтобы видеть структуру
                        logger.debug(f"📩 Raw message: {msg}")
                        
                        # Извлекаем данные
                        # Ключи могут отличаться, используем .get с фоллбэками
                        chat_id = msg.get('chat_jid', msg.get('chat', ''))
                        sender_id = msg.get('sender_jid', msg.get('sender', ''))
                        text = msg.get('text', msg.get('body', msg.get('content', '')))
                        is_group = msg.get('is_group', False)
                        from_me = msg.get('from_me', False)
                        
                        # Если нет текста или это наше сообщение - пропускаем
                        if not text or from_me:
                            continue
                            
                        # Определяем ID пользователя (если группа - то ID группы + участник, если личка - то собеседник)
                        # Для простоты пока берем chat_id как user_id для личных сообщения
                        user_id = chat_id.split('@')[0] if '@' in chat_id else chat_id
                        
                        message_data = {
                            'user_id': user_id,
                            'message': text,
                            'from_me': False,
                            'raw_data': msg
                        }
                        
                        await MessageHandler.handle_message(message_data)
                        
            except Exception as e:
                logger.error(f"❌ Ошибка в цикле опроса: {e}")
            
            # Пауза между опросами (5 секунд)
            await asyncio.sleep(5)

class WhatsAppBotIntegration:
    """
    Полная интеграция WhatsApp с основным ботом
    """
    
    def __init__(self, whatsapp_client):
        self.whatsapp_client = whatsapp_client
        self.webhook_server = WhatsAppWebhookServer()
    
    async def start(self):
        """Запуск интегрированного бота"""
        logger.info("🚀 Запуск WhatsApp бота с полной интеграцией...")
        
        # Запуск webhook сервера
        await self.webhook_server.start()
        
        # Запуск основного бота
        from main import LaMirageBot
        bot = LaMirageBot()
        await bot.start()
        
        logger.info("✅ WhatsApp бот полностью запущен и готов к работе!")
        
        # Держим сервер запущенным
        while True:
            await asyncio.sleep(1)

# ===================== ЗАПУСК =====================
if __name__ == "__main__":
    import os
    
    # Выбор метода интеграции
    integration_method = os.getenv("WHATSAPP_METHOD", "twilio")  # twilio или business_api
    
    if integration_method == "twilio":
        logger.info("📱 Используется Twilio API")
        asyncio.run(example_twilio_integration())
    elif integration_method == "business_api":
        logger.info("📱 Используется WhatsApp Business API")
        asyncio.run(example_business_api_integration())
    else:
        logger.error("❌ Неизвестный метод интеграции")
        logger.info("💡 Установите WHATSAPP_METHOD=twilio или WHATSAPP_METHOD=business_api")
