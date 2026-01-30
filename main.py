"""
WhatsApp Bot для салона красоты La Mirage Beauty
Python версия

Требования:
pip install whatsapp-web.py google-cloud-aiplatform google-auth google-api-python-client psycopg2-binary python-dotenv schedule qrcode pillow
"""

import os
import json
import re
import asyncio
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Any
import logging
from dataclasses import dataclass, asdict

# Fix for missing Go path in some environments
if os.name == 'nt':
    go_path = r"C:\Program Files\Go\bin"
    if os.path.exists(go_path) and go_path not in os.environ['PATH']:
        os.environ['PATH'] += os.pathsep + go_path

# Third-party imports
from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2 import pool
from google.cloud import aiplatform
from google.oauth2 import service_account
from googleapiclient.discovery import build
import schedule
import time
import time
import qrcode
try:
    from whatsapp_bridge import WhatsappClient
    WHATSAPP_BRIDGE_AVAILABLE = True
except ImportError:
    WHATSAPP_BRIDGE_AVAILABLE = False


# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Загрузка переменных окружения
load_dotenv()

# ===================== КОНФИГУРАЦИЯ =====================
@dataclass
class Config:
    VERTEX_PROJECT_ID: str = os.getenv('VERTEX_PROJECT_ID', 'lamirage')
    VERTEX_LOCATION: str = os.getenv('VERTEX_LOCATION', 'us-central1')
    VERTEX_KEY_FILE: str = os.getenv('VERTEX_KEY_FILE', './vertex_key.json')
    GOOGLE_CALENDAR_CREDENTIALS: str = os.getenv('GOOGLE_CALENDAR_CREDENTIALS', './credentials.json')
    CALENDAR_ID: str = os.getenv('CALENDAR_ID', 'primary')
    ADMIN_WHITELIST: List[str] = None
    SALON_NAME: str = os.getenv('SALON_NAME', 'La Mirage Beauty')
    INSTAGRAM_LINK: str = os.getenv('INSTAGRAM_LINK', '')
    SALON_ADDRESS: str = os.getenv('SALON_ADDRESS', '')
    WORKING_HOURS: str = os.getenv('WORKING_HOURS', 'Ежедневно с 10:00 до 21:00')
    NODE_ENV: str = os.getenv('NODE_ENV', 'development')
    DATABASE_URL: str = os.getenv('DATABASE_URL', 'postgresql://localhost:5432/lamiragebeauty')
    
    def __post_init__(self):
        admin_list = os.getenv('ADMIN_WHITELIST', '')
        self.ADMIN_WHITELIST = [n.strip() for n in admin_list.split(',') if n.strip()]

CONFIG = Config()

# ===================== ДАННЫЕ О САЛОНЕ =====================
MASTERS = {
    'mainMaster': 'Юна',
    'secondaryMasters': ['Гульназ', 'Жазира', 'Айгерим', 'Аружан', 'Айлин']
}

SALON_DATA = {
    'masters': [
        {
            'name': 'Юна',
            'specialty': 'главный мастер по маникюру',
            'services': ['маникюр', 'наращивание'],
            'priceCategory': 'premium'
        },
        {
            'name': 'Аружан',
            'specialty': 'мастер по маникюру',
            'services': ['маникюр', 'наращивание'],
            'priceCategory': 'standard'
        },
        {
            'name': 'Айгерим',
            'specialty': 'мастер по маникюру',
            'services': ['маникюр', 'наращивание'],
            'priceCategory': 'standard'
        },
        {
            'name': 'Гульназ',
            'specialty': 'мастер по маникюру',
            'services': ['маникюр', 'наращивание'],
            'priceCategory': 'standard'
        },
        {
            'name': 'Жазира',
            'specialty': 'мастер по маникюру',
            'services': ['маникюр', 'наращивание'],
            'priceCategory': 'standard'
        },
        {
            'name': 'Лена',
            'specialty': 'мастер по бровям, ресницам и шугарингу',
            'services': ['брови', 'ресницы', 'шугаринг', 'ламинирование'],
            'priceCategory': 'standard'
        }
    ],
    'services': [
        # УСЛУГИ ЮНЫ (МАНИКЮР)
        {'name': 'Маникюр без покрытия', 'master': 'Юна', 'price': 3000, 'duration': 60, 'category': 'маникюр'},
        {'name': 'Маникюр с укреплением', 'master': 'Юна', 'price': 7000, 'duration': 90, 'category': 'маникюр'},
        {'name': 'Наращивание ногтей типсами', 'master': 'Юна', 'price': 9000, 'duration': 120, 'category': 'маникюр'},
        {'name': 'Наращивание ногтей верхними формами', 'master': 'Юна', 'price': 10000, 'duration': 120, 'category': 'маникюр'},
        {'name': 'Снятие покрытия', 'master': 'Юна', 'price': 1000, 'duration': 30, 'category': 'маникюр'},
        {'name': 'Сложный дизайн', 'master': 'Юна', 'price': 1000, 'duration': 30, 'category': 'маникюр'},
        
        # УСЛУГИ ДРУГИХ МАСТЕРОВ (МАНИКЮР)
        {'name': 'Маникюр без покрытия', 'master': 'другие', 'price': 1000, 'duration': 60, 'category': 'маникюр'},
        {'name': 'Маникюр с укреплением', 'master': 'другие', 'price': 3500, 'duration': 90, 'category': 'маникюр'},
        {'name': 'Наращивание ногтей', 'master': 'другие', 'price': 5000, 'duration': 120, 'category': 'маникюр'},
        {'name': 'Снятие покрытия', 'master': 'другие', 'price': 500, 'duration': 30, 'category': 'маникюр'},
        {'name': 'Дизайн', 'master': 'другие', 'price': 500, 'duration': 30, 'category': 'маникюр'},
        
        # НАРАЩИВАНИЕ РЕСНИЦ (ЛЕНА)
        {'name': 'Наращивание ресниц Классика', 'master': 'Лена', 'price': 6000, 'duration': 120, 'category': 'ресницы'},
        {'name': 'Наращивание ресниц 2Д-3Д', 'master': 'Лена', 'price': 7000, 'duration': 150, 'category': 'ресницы'},
        {'name': 'Мокрый эффект до 3.5Д', 'master': 'Лена', 'price': 7000, 'duration': 150, 'category': 'ресницы'},
        {'name': 'Мокрый эффект от 4Д', 'master': 'Лена', 'price': 8000, 'duration': 180, 'category': 'ресницы'},
        {'name': 'Наращивание 4Д-5Д изгибы LM', 'master': 'Лена', 'price': 8000, 'duration': 180, 'category': 'ресницы'},
        {'name': 'Снятие ресниц (чужое/своё без наращивания)', 'master': 'Лена', 'price': 1000, 'duration': 30, 'category': 'ресницы'},
        
        # ЛАМИНИРОВАНИЕ (ЛЕНА)
        {'name': 'Ламинирование бровей (окрашивание + ботокс)', 'master': 'Лена', 'price': 5000, 'duration': 60, 'category': 'брови'},
        {'name': 'Ламинирование ресниц (окрашивание + ботокс)', 'master': 'Лена', 'price': 5000, 'duration': 60, 'category': 'ресницы'},
        {'name': 'Ламинирование бровей + ресниц', 'master': 'Лена', 'price': 8500, 'duration': 90, 'category': 'ресницы + брови'},
        
        # БРОВИ (ЛЕНА)
        {'name': 'Коррекция бровей воск/пинцет', 'master': 'Лена', 'price': 1500, 'duration': 30, 'category': 'брови'},
        {'name': 'Окрашивание бровей', 'master': 'Лена', 'price': 2000, 'duration': 30, 'category': 'брови'},
        
        # ШУГАРИНГ - КОМБО (ЛЕНА)
        {'name': 'Шугаринг Комбо 1 (глубокое бикини + подмышки + ноги до колен)', 'master': 'Лена', 'price': 6000, 'duration': 90, 'category': 'шугаринг'},
        {'name': 'Шугаринг Комбо 2 (руки полностью + ноги полностью)', 'master': 'Лена', 'price': 5000, 'duration': 90, 'category': 'шугаринг'},
        {'name': 'Шугаринг Комбо 3 (глубокое бикини + подмышки)', 'master': 'Лена', 'price': 4500, 'duration': 60, 'category': 'шугаринг'},
        {'name': 'Шугаринг Комбо 4 (глубокое бикини + подмышки + ноги полностью)', 'master': 'Лена', 'price': 7000, 'duration': 120, 'category': 'шугаринг'},
        {'name': 'Шугаринг Комбо 5 (ноги до колен + руки до локтя + глубокое бикини + подмышки)', 'master': 'Лена', 'price': 7000, 'duration': 120, 'category': 'шугаринг'},
        {'name': 'Шугаринг Комбо 6 (руки до локтя + ноги до колена)', 'master': 'Лена', 'price': 4000, 'duration': 75, 'category': 'шугаринг'},
        
        # ШУГАРИНГ - ОТДЕЛЬНЫЕ ЗОНЫ (ЛЕНА)
        {'name': 'Шугаринг лицо полностью', 'master': 'Лена', 'price': 3500, 'duration': 30, 'category': 'шугаринг'},
        {'name': 'Шугаринг лоб', 'master': 'Лена', 'price': 500, 'duration': 10, 'category': 'шугаринг'},
        {'name': 'Шугаринг усики', 'master': 'Лена', 'price': 500, 'duration': 10, 'category': 'шугаринг'},
        {'name': 'Шугаринг подбородок', 'master': 'Лена', 'price': 500, 'duration': 10, 'category': 'шугаринг'},
        {'name': 'Шугаринг бакенбарды', 'master': 'Лена', 'price': 1000, 'duration': 15, 'category': 'шугаринг'},
        {'name': 'Шугаринг затылок', 'master': 'Лена', 'price': 1000, 'duration': 15, 'category': 'шугаринг'},
        {'name': 'Шугаринг спина', 'master': 'Лена', 'price': 1500, 'duration': 30, 'category': 'шугаринг'},
        {'name': 'Шугаринг живот полностью', 'master': 'Лена', 'price': 1500, 'duration': 25, 'category': 'шугаринг'},
        {'name': 'Шугаринг линия живота', 'master': 'Лена', 'price': 500, 'duration': 10, 'category': 'шугаринг'},
        {'name': 'Шугаринг поясница', 'master': 'Лена', 'price': 1000, 'duration': 15, 'category': 'шугаринг'},
        {'name': 'Шугаринг ягодицы', 'master': 'Лена', 'price': 1000, 'duration': 20, 'category': 'шугаринг'},
        {'name': 'Шугаринг глубокое бикини', 'master': 'Лена', 'price': 4000, 'duration': 45, 'category': 'шугаринг'},
        {'name': 'Шугаринг классическое бикини', 'master': 'Лена', 'price': 3000, 'duration': 30, 'category': 'шугаринг'},
        {'name': 'Шугаринг подмышки', 'master': 'Лена', 'price': 1000, 'duration': 15, 'category': 'шугаринг'},
        {'name': 'Шугаринг ноги полностью', 'master': 'Лена', 'price': 4000, 'duration': 60, 'category': 'шугаринг'},
        {'name': 'Шугаринг ноги до колен', 'master': 'Лена', 'price': 3000, 'duration': 40, 'category': 'шугаринг'},
        {'name': 'Шугаринг руки полностью', 'master': 'Лена', 'price': 3000, 'duration': 45, 'category': 'шугаринг'},
        {'name': 'Шугаринг руки до локтя', 'master': 'Лена', 'price': 2500, 'duration': 30, 'category': 'шугаринг'},
    ],
    'materialInfo': 'Мы работаем на профессиональных материалах премиум-класса: гель-лаки CND, Kodi, базы и топы Rubber Base. Все материалы гипоаллергенны и безопасны.',
    'workingHours': CONFIG.WORKING_HOURS,
    'address': CONFIG.SALON_ADDRESS
}

# ===================== БАЗА ДАННЫХ =====================
class DatabaseManager:
    def __init__(self, database_url: str):
        self.database_url = database_url
        self.connection_pool = None
        
    def init_pool(self):
        """Инициализация пула соединений"""
        try:
            self.connection_pool = psycopg2.pool.SimpleConnectionPool(
                1, 20,
                self.database_url,
                cursor_factory=RealDictCursor
            )
            logger.info("✅ PostgreSQL пул соединений создан")
        except Exception as e:
            logger.error(f"❌ Ошибка создания пула: {e}")
            raise
    
    def get_connection(self):
        """Получить соединение из пула"""
        return self.connection_pool.getconn()
    
    def return_connection(self, conn):
        """Вернуть соединение в пул"""
        self.connection_pool.putconn(conn)
    
    async def init_database(self):
        """Инициализация структуры базы данных"""
        conn = None
        try:
            conn = self.get_connection()
            cursor = conn.cursor()
            
            # Создание таблицы conversations
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS conversations (
                    user_id VARCHAR(255) PRIMARY KEY,
                    stage VARCHAR(50) DEFAULT 'greeting',
                    history JSONB DEFAULT '[]'::jsonb,
                    booking_data JSONB DEFAULT '{}'::jsonb,
                    client_name VARCHAR(255),
                    client_phone VARCHAR(50),
                    is_admin_mode BOOLEAN DEFAULT FALSE,
                    admin_chat_id VARCHAR(255),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            logger.info("✅ Таблица conversations создана")
            
            # Создание таблицы bookings
            cursor.execute("""
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
                    duration INTEGER DEFAULT 60,
                    status VARCHAR(50) DEFAULT 'pending',
                    reminder_sent BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    confirmed_at TIMESTAMP,
                    completed_at TIMESTAMP
                );
            """)
            logger.info("✅ Таблица bookings создана")
            
            # Создание таблицы statistics
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS statistics (
                    master_name VARCHAR(100) PRIMARY KEY,
                    total_bookings INT DEFAULT 0,
                    confirmed_bookings INT DEFAULT 0,
                    completed_bookings INT DEFAULT 0,
                    revenue BIGINT DEFAULT 0,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            logger.info("✅ Таблица statistics создана")
            
            # Создание таблицы clients
            cursor.execute("""
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
            """)
            logger.info("✅ Таблица clients создана")
            
            # Создание индексов
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
                CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
                CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
                CREATE INDEX IF NOT EXISTS idx_bookings_reminder ON bookings(date, time, reminder_sent);
            """)
            logger.info("✅ Индексы созданы")
            
            # Создание триггера для updated_at
            cursor.execute("""
                CREATE OR REPLACE FUNCTION update_updated_at_column()
                RETURNS TRIGGER AS $$
                BEGIN
                    NEW.updated_at = CURRENT_TIMESTAMP;
                    RETURN NEW;
                END;
                $$ language 'plpgsql';
            """)
            
            cursor.execute("""
                DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
                
                CREATE TRIGGER update_conversations_updated_at
                BEFORE UPDATE ON conversations
                FOR EACH ROW
                EXECUTE FUNCTION update_updated_at_column();
            """)
            logger.info("✅ Триггер автообновления updated_at создан")
            
            # Добавление мастеров в статистику
            for master in SALON_DATA['masters']:
                cursor.execute("""
                    INSERT INTO statistics (master_name, total_bookings, confirmed_bookings, revenue)
                    VALUES (%s, 0, 0, 0) ON CONFLICT (master_name) DO NOTHING
                """, (master['name'],))
            
            conn.commit()
            logger.info("✅ База данных PostgreSQL полностью инициализирована")
            
        except Exception as e:
            logger.error(f"❌ Ошибка инициализации БД: {e}")
            if conn:
                conn.rollback()
            raise
        finally:
            if conn:
                cursor.close()
                self.return_connection(conn)

# Глобальный экземпляр менеджера БД
db_manager = DatabaseManager(CONFIG.DATABASE_URL)

# ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ДАТ =====================
def get_today() -> str:
    """Получить сегодняшнюю дату в формате YYYY-MM-DD"""
    return datetime.now().strftime('%Y-%m-%d')

def get_tomorrow() -> str:
    """Получить завтрашнюю дату в формате YYYY-MM-DD"""
    return (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')

def format_date_for_display(date_string: str) -> str:
    """Форматировать дату для отображения"""
    date_obj = datetime.strptime(date_string, '%Y-%m-%d')
    months = {
        1: 'января', 2: 'февраля', 3: 'марта', 4: 'апреля',
        5: 'мая', 6: 'июня', 7: 'июля', 8: 'августа',
        9: 'сентября', 10: 'октября', 11: 'ноября', 12: 'декабря'
    }
    return f"{date_obj.day} {months[date_obj.month]} {date_obj.year} года"

def get_day_of_week(date_string: str) -> str:
    """Получить день недели"""
    date_obj = datetime.strptime(date_string, '%Y-%m-%d')
    days = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье']
    return days[date_obj.weekday()]

def get_next_days(count: int = 7) -> List[Dict[str, Any]]:
    """Получить список ближайших дней"""
    dates = []
    for i in range(count):
        date = datetime.now() + timedelta(days=i)
        formatted = date.strftime('%Y-%m-%d')
        dates.append({
            'date': formatted,
            'display': format_date_for_display(formatted),
            'dayName': get_day_of_week(formatted),
            'isToday': i == 0,
            'isTomorrow': i == 1
        })
    return dates

def extract_phone_number(whatsapp_id: str) -> str:
    """Извлечь номер телефона из WhatsApp ID"""
    # Убираем @c.us, @lid и другие суффиксы WhatsApp
    return re.sub(r'@.*$', '', whatsapp_id)

# ===================== VERTEX AI =====================
class VertexAIManager:
    def __init__(self, project_id: str, location: str, key_file: str):
        self.project_id = project_id
        self.location = location
        self.key_file = key_file
        self.model = None
        
    def init_vertex_ai(self):
        """Инициализация Vertex AI"""
        try:
            if not os.path.exists(self.key_file):
                raise FileNotFoundError(
                    f"Файл ключа не найден: {self.key_file}\n"
                    "Создайте Service Account в Google Cloud и скачайте JSON ключ"
                )
            
            os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = self.key_file
            
            aiplatform.init(
                project=self.project_id,
                location=self.location
            )
            
            from vertexai.preview.generative_models import GenerativeModel
            self.model = GenerativeModel('gemini-2.0-flash-exp')
            
            logger.info("✅ Vertex AI инициализирован (US region, обход блокировки КЗ)")
            logger.info(f"   Project: {self.project_id}")
            logger.info(f"   Location: {self.location}")
            
        except Exception as e:
            logger.error(f"❌ Ошибка инициализации Vertex AI: {e}")
            raise
    
    async def generate_content(self, prompt: str) -> str:
        """Генерация контента через Vertex AI"""
        try:
            response = self.model.generate_content(prompt)
            return response.text
        except Exception as e:
            logger.error(f"❌ Ошибка генерации контента: {e}")
            raise

# Глобальный экземпляр Vertex AI
vertex_ai = VertexAIManager(
    CONFIG.VERTEX_PROJECT_ID,
    CONFIG.VERTEX_LOCATION,
    CONFIG.VERTEX_KEY_FILE
)

# ===================== GOOGLE CALENDAR =====================
class GoogleCalendarManager:
    def __init__(self, credentials_file: str, calendar_id: str):
        self.credentials_file = credentials_file
        self.calendar_id = calendar_id
        self.service = None
        
    def init_calendar(self):
        """Инициализация Google Calendar"""
        try:
            credentials = service_account.Credentials.from_service_account_file(
                self.credentials_file,
                scopes=['https://www.googleapis.com/auth/calendar']
            )
            
            self.service = build('calendar', 'v3', credentials=credentials)
            logger.info("✅ Google Calendar инициализирован через Service Account")
            
        except Exception as e:
            logger.error(f"❌ Ошибка инициализации Google Calendar: {e}")
            logger.info("ℹ️  Бот будет работать без интеграции с календарем")
    
    async def add_event(self, booking: Dict[str, Any]):
        """Добавить событие в календарь"""
        if not self.service:
            logger.warning("⚠️ Google Calendar не настроен")
            return
        
        try:
            # Формирование времени начала и конца
            date_str = str(booking['date'])[:10]
            time_str = str(booking['time'])[:5]
            
            start_datetime = datetime.fromisoformat(f"{date_str}T{time_str}:00")
            end_datetime = start_datetime + timedelta(minutes=booking.get('duration', 90))
            
            event = {
                'summary': f"{booking['service']} - {booking['master']}",
                'description': f"Клиент: {booking['client_name']}\nТелефон: {booking['client_phone']}",
                'start': {
                    'dateTime': start_datetime.isoformat(),
                    'timeZone': 'Asia/Almaty',
                },
                'end': {
                    'dateTime': end_datetime.isoformat(),
                    'timeZone': 'Asia/Almaty',
                },
                'reminders': {
                    'useDefault': False,
                    'overrides': [
                        {'method': 'popup', 'minutes': 60},
                        {'method': 'popup', 'minutes': 1440},
                    ],
                },
            }
            
            self.service.events().insert(
                calendarId=self.calendar_id,
                body=event
            ).execute()
            
            logger.info("✅ Запись добавлена в Google Calendar")
            
        except Exception as e:
            logger.error(f"❌ Ошибка добавления в календарь: {e}")

# Глобальный экземпляр Google Calendar
calendar_manager = GoogleCalendarManager(
    CONFIG.GOOGLE_CALENDAR_CREDENTIALS,
    CONFIG.CALENDAR_ID
)

# ===================== РАБОТА С РАЗГОВОРАМИ =====================
class ConversationManager:
    @staticmethod
    async def get_conversation(user_id: str) -> Optional[Dict[str, Any]]:
        """Получить разговор из БД"""
        conn = None
        try:
            conn = db_manager.get_connection()
            cursor = conn.cursor()
            
            cursor.execute(
                "SELECT * FROM conversations WHERE user_id = %s",
                (user_id,)
            )
            result = cursor.fetchone()
            
            if result:
                # Преобразуем RealDictRow в обычный dict
                conversation = dict(result)
                # Парсим JSON поля
                conversation['history'] = json.loads(conversation['history']) if isinstance(conversation['history'], str) else conversation['history']
                conversation['booking_data'] = json.loads(conversation['booking_data']) if isinstance(conversation['booking_data'], str) else conversation['booking_data']
                return conversation
            
            return None
            
        except Exception as e:
            logger.error(f"Ошибка получения разговора: {e}")
            return None
        finally:
            if conn:
                cursor.close()
                db_manager.return_connection(conn)
    
    @staticmethod
    async def save_conversation(conversation: Dict[str, Any]):
        """Сохранить разговор в БД"""
        conn = None
        try:
            conn = db_manager.get_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO conversations (
                    user_id, stage, history, booking_data, client_name, client_phone,
                    is_admin_mode, admin_chat_id, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (user_id)
                DO UPDATE SET
                    stage = %s,
                    history = %s,
                    booking_data = %s,
                    client_name = %s,
                    client_phone = %s,
                    is_admin_mode = %s,
                    admin_chat_id = %s,
                    updated_at = CURRENT_TIMESTAMP
            """, (
                conversation['user_id'],
                conversation['stage'],
                json.dumps(conversation['history']),
                json.dumps(conversation['booking_data']),
                conversation.get('client_name'),
                conversation.get('client_phone'),
                conversation.get('is_admin_mode', False),
                conversation.get('admin_chat_id'),
                # Для UPDATE части
                conversation['stage'],
                json.dumps(conversation['history']),
                json.dumps(conversation['booking_data']),
                conversation.get('client_name'),
                conversation.get('client_phone'),
                conversation.get('is_admin_mode', False),
                conversation.get('admin_chat_id')
            ))
            
            conn.commit()
            
        except Exception as e:
            logger.error(f"Ошибка сохранения разговора: {e}")
            if conn:
                conn.rollback()
        finally:
            if conn:
                cursor.close()
                db_manager.return_connection(conn)
    
    @staticmethod
    async def check_session_expiry(conversation: Dict[str, Any]) -> bool:
        """Проверка истечения сессии (30 минут)"""
        if not conversation or not conversation.get('updated_at'):
            return False
        
        now = datetime.now()
        last_update = conversation['updated_at']
        
        if isinstance(last_update, str):
            last_update = datetime.fromisoformat(last_update)
        
        diff_minutes = (now - last_update).total_seconds() / 60
        
        if diff_minutes > 30:
            logger.info(f"⏰ Сессия истекла для {conversation['user_id']} ({int(diff_minutes)} мин)")
            return True
        
        return False
    
    @staticmethod
    async def reset_session(user_id: str, silent: bool = False):
        """Сброс сессии"""
        conn = None
        try:
            conn = db_manager.get_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                UPDATE conversations
                SET stage = 'greeting',
                    history = '[]'::jsonb,
                    booking_data = '{}'::jsonb,
                    is_admin_mode = FALSE,
                    admin_chat_id = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = %s
            """, (user_id,))
            
            conn.commit()
            logger.info(f"🔄 Сессия сброшена для {user_id}{' (тихо)' if silent else ''}")
            return True
            
        except Exception as e:
            logger.error(f"Ошибка сброса сессии: {e}")
            if conn:
                conn.rollback()
            return False
        finally:
            if conn:
                cursor.close()
                db_manager.return_connection(conn)

# ===================== РАБОТА С КЛИЕНТАМИ =====================
class ClientManager:
    @staticmethod
    async def save_client(phone: str, name: str, user_id: str):
        """Сохранить клиента в БД"""
        conn = None
        try:
            conn = db_manager.get_connection()
            cursor = conn.cursor()
            
            clean_phone = phone.replace('@', '') if '@' in phone else phone
            
            cursor.execute("""
                INSERT INTO clients (phone, name, user_id, created_at)
                VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (phone)
                DO UPDATE SET
                    name = EXCLUDED.name,
                    user_id = EXCLUDED.user_id
            """, (clean_phone, name, user_id))
            
            conn.commit()
            logger.info(f"✅ Клиент сохранен/обновлен: {name} ({clean_phone})")
            
        except Exception as e:
            logger.error(f"Ошибка сохранения клиента: {e}")
            if conn:
                conn.rollback()
        finally:
            if conn:
                cursor.close()
                db_manager.return_connection(conn)

# ===================== ВАЛИДАЦИЯ ДАННЫХ =====================
class DataValidator:
    @staticmethod
    async def validate_name(user_message: str) -> Dict[str, Any]:
        """Валидация имени через Gemini AI"""
        try:
            prompt = f"""Проанализируй сообщение пользователя и определи, является ли это настоящим именем человека.

Сообщение: "{user_message}"

ПРАВИЛА:
1. Это должно быть настоящее имя (например: Азат, Айгуль, Марат, Диана, Анна, John)
2. НЕ принимай: вопросы ("как дела", "что"), приветствия ("привет", "здравствуй"), команды, цифры
3. Извлеки только ПЕРВОЕ слово как имя, игнорируй остальное
4. Имя должно быть минимум 2 буквы

Ответь ТОЛЬКО в формате JSON:
{{
  "isValid": true/false,
  "data": "извлеченное имя или null",
  "message": "сообщение для пользователя если невалидно, или null"
}}"""

            response = await vertex_ai.generate_content(prompt)
            json_match = re.search(r'\{[\s\S]*\}', response)
            
            if json_match:
                validation = json.loads(json_match.group(0))
                logger.info(f"📝 Валидация имени: {validation}")
                return validation
                
        except Exception as e:
            logger.error(f"Ошибка валидации имени: {e}")
        
        # Fallback на простую валидацию
        clean_name = user_message.strip().split()[0]
        if len(clean_name) < 2 or clean_name.startswith('/') or clean_name.isdigit():
            return {
                'isValid': False,
                'data': None,
                'message': 'Пожалуйста, напишите ваше настоящее имя 😊'
            }
        
        return {'isValid': True, 'data': clean_name, 'message': None}
    
    @staticmethod
    async def validate_phone(user_message: str) -> Dict[str, Any]:
        """Валидация телефона через Gemini AI"""
        try:
            prompt = f"""Проанализируй сообщение и извлеки номер телефона.

Сообщение: "{user_message}"

ПРАВИЛА:
1. Извлеки все цифры из сообщения
2. Номер должен быть от 10 до 15 цифр
3. Убери все символы кроме цифр и плюса в начале
4. Если номер начинается с 8, замени на 7

Ответь ТОЛЬКО в формате JSON:
{{
  "isValid": true/false,
  "data": "очищенный номер или null",
  "message": "сообщение для пользователя если невалидно, или null"
}}"""

            response = await vertex_ai.generate_content(prompt)
            json_match = re.search(r'\{[\s\S]*\}', response)
            
            if json_match:
                validation = json.loads(json_match.group(0))
                logger.info(f"📝 Валидация телефона: {validation}")
                return validation
                
        except Exception as e:
            logger.error(f"Ошибка валидации телефона: {e}")
        
        # Fallback на простую валидацию
        clean_phone = re.sub(r'[^0-9+]', '', user_message)
        clean_phone = re.sub(r'^8', '7', clean_phone)
        
        if len(clean_phone) < 10 or len(clean_phone) > 15:
            return {
                'isValid': False,
                'data': None,
                'message': 'Пожалуйста, введите корректный номер телефона\n\nНапример:\n+7 706 424 0050\n77064240050'
            }
        
        return {'isValid': True, 'data': clean_phone, 'message': None}

# ===================== ПРОВЕРКА ДОСТУПНОСТИ =====================
class AvailabilityChecker:
    @staticmethod
    async def check_availability(master_name: str, date: str, time: str, duration_minutes: int = 60) -> bool:
        """Проверка доступности времени"""
        if not master_name or not date or not time:
            return True
        
        conn = None
        try:
            conn = db_manager.get_connection()
            cursor = conn.cursor()
            
            # Приводим время к формату HH:MM
            check_time = time[:5] if len(time) > 5 else time
            
            cursor.execute("""
                SELECT id, service, time, COALESCE(duration, 60) as duration
                FROM bookings
                WHERE status IN ('confirmed', 'pending')
                AND master = %s
                AND date = %s
                AND (time, (COALESCE(duration, 60) || ' minutes')::interval) OVERLAPS
                    (%s::time, (%s || ' minutes')::interval)
            """, (master_name, date, check_time, duration_minutes))
            
            result = cursor.fetchall()
            
            if result:
                logger.info(f"⛔ Время занято: {master_name} {date} {check_time}")
                logger.info(f"   Конфликт с записью #{result[0]['id']}: {result[0]['service']}")
                return False
            
            logger.info(f"✅ Время свободно: {master_name} {date} {check_time}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Ошибка проверки доступности: {e}")
            return False
        finally:
            if conn:
                cursor.close()
                db_manager.return_connection(conn)
    
    @staticmethod
    async def get_available_slots(master_name: str, date: str) -> List[str]:
        """Получить свободные временные окна"""
        conn = None
        try:
            conn = db_manager.get_connection()
            cursor = conn.cursor()
            
            work_start = 10
            work_end = 21
            slot_duration = 60
            
            available_slots = []
            
            for hour in range(work_start, work_end):
                slot_time = f"{hour:02d}:00"
                
                is_free = await AvailabilityChecker.check_availability(
                    master_name, date, slot_time, slot_duration
                )
                
                if is_free:
                    available_slots.append(slot_time)
            
            return available_slots
            
        except Exception as e:
            logger.error(f"❌ Ошибка получения свободных окон: {e}")
            return []
        finally:
            if conn:
                cursor.close()
                db_manager.return_connection(conn)

# ===================== СОЗДАНИЕ СИСТЕМНОГО ПРОМПТА =====================
def create_system_prompt(client_name: Optional[str] = None) -> str:
    """Создание системного промпта для AI"""
    
    masters_info = '\n'.join([f"{m['name']} - {m['specialty']}" for m in SALON_DATA['masters']])
    
    yuna_services = '\n'.join([
        f"  {s['name']} - {s['price']} тг"
        for s in SALON_DATA['services'] if s['master'] == 'Юна'
    ])
    
    other_masters_services = '\n'.join([
        f"  {s['name']} - {s['price']} тг"
        for s in SALON_DATA['services'] if s['master'] == 'другие' and s['category'] == 'маникюр'
    ])
    
    lena_services = '\n'.join([
        f"  {s['name']} - {s['price']} тг"
        for s in SALON_DATA['services'] if s['master'] == 'Лена'
    ])
    
    services_info = f"""МАНИКЮР

Мастер Юна (главный мастер):
{yuna_services}

Мастера: Аружан, Айгерим, Гульназ, Жазира
{other_masters_services}

БРОВИ, РЕСНИЦЫ И ШУГАРИНГ

Мастер Лена:
{lena_services}"""
    
    today = get_today()
    tomorrow = get_tomorrow()
    today_display = format_date_for_display(today)
    tomorrow_display = format_date_for_display(tomorrow)
    next_days = ', '.join([f"{d['display']} ({d['dayName']})" for d in get_next_days(5)])
    
    return f"""Ты - виртуальный администратор салона красоты "{CONFIG.SALON_NAME}".

ТВОЯ РОЛЬ:
- Дружелюбный, милый и приветливый помощник
- Твоя цель: помочь клиенту выбрать услугу, показать цены, и затем помочь с записью
- Обращайся к клиенту по имени: {client_name or 'клиент'}
- Пиши естественно и тепло, используй эмодзи умеренно (✨, 💅, 🤍)
- КРИТИЧЕСКИ ВАЖНО: НИКОГДА не используй markdown форматирование - НЕ используй звездочки, жирный текст, подчеркивания
- Пиши обычным текстом без форматирования
- Общайся приветливо, но не перегружай сообщения

ИНФОРМАЦИЯ О САЛОНЕ:
Режим работы: {SALON_DATA['workingHours']}
Адрес: {SALON_DATA['address']}
Instagram: {CONFIG.INSTAGRAM_LINK}

ТЕКУЩАЯ ДАТА:
Сегодня: {today_display}
Завтра: {tomorrow_display}

НАШИ МАСТЕРА:
{masters_info}

УСЛУГИ И ЦЕНЫ:
{services_info}

МАТЕРИАЛЫ: {SALON_DATA['materialInfo']}

ГЛАВНЫЕ ПРАВИЛА ОБЩЕНИЯ:

1. ВСЕГДА УТОЧНЯЙ КОНКРЕТНУЮ УСЛУГУ И ПОКАЗЫВАЙ ЦЕНЫ
2. ДЛЯ МАНИКЮРА - УТОЧНЯЙ МАСТЕРА И ПОКАЗЫВАЙ РАЗНИЦУ В ЦЕНАХ
3. ДЛЯ РЕСНИЦ И ШУГАРИНГА - ПОКАЗЫВАЙ ВЕСЬ СПИСОК
4. ТОЛЬКО ПОСЛЕ ВЫБОРА КОНКРЕТНОЙ УСЛУГИ - проверяй время:
   - Когда клиент выбрал КОНКРЕТНУЮ услугу И указал время - добавь команду:
     "ПРОВЕРИТЬ_ДОСТУПНОСТЬ: мастер={{имя}}, дата={{YYYY-MM-DD}}, время={{HH:MM}}"
   - НЕ проверяй время ПОКА клиент не выбрал конкретную услугу

5. НЕ СОЗДАВАЙ ЗАПИСЬ без:
   - Конкретного названия услуги
   - Точной цены
   - Имени мастера
   - Даты и времени

ПРИМЕРЫ БЛИЖАЙШИХ ДАТ:
{next_days}

6. КОГДА ВСЕ ДАННЫЕ ГОТОВЫ:
   - Подтверди все детали записи с КОНКРЕТНОЙ услугой
   - Назови ТОЧНУЮ цену
   - Будь приветливой и радостной

Веди диалог тепло и с заботой о клиенте! ❤️"""

# ===================== ОПРЕДЕЛЕНИЕ НАМЕРЕНИЯ ЗАПИСИ =====================
class BookingIntentDetector:
    @staticmethod
    async def detect_booking_intent(conversation: Dict[str, Any]) -> Dict[str, Any]:
        """Определение намерения записаться"""
        recent_messages = conversation['history'][-10:]
        messages_text = '\n'.join([
            f"{'Клиент' if m['role'] == 'user' else 'Бот'}: {m['content']}"
            for m in recent_messages
        ])
        
        today = get_today()
        tomorrow = get_tomorrow()
        
        try:
            services_list = '\n'.join([
                f"{s['name']} ({s['master']}) - {s['price']} тг"
                for s in SALON_DATA['services']
            ])
            
            prompt = f"""Проанализируй диалог и определи, готов ли клиент к записи.

Диалог:
{messages_text}

Имя клиента: {conversation.get('client_name')}
Телефон клиента: {conversation.get('client_phone')}

ТЕКУЩАЯ ИНФОРМАЦИЯ:
Сегодняшняя дата: {today}
Завтрашняя дата: {tomorrow}

Доступные мастера: {', '.join([m['name'] for m in SALON_DATA['masters']])}

КРИТИЧЕСКИ ВАЖНО - ready = true ТОЛЬКО ЕСЛИ:
1. Есть КОНКРЕТНОЕ название услуги (не просто "маникюр" или "брови", а "Коррекция бровей", "Маникюр с укреплением")
2. Есть ТОЧНАЯ цена в тенге (должна соответствовать конкретной услуге)
3. Есть имя мастера
4. Есть дата в формате YYYY-MM-DD
5. Есть время в формате HH:MM
6. Бот УЖЕ показал клиенту список услуг с ценами и клиент ВЫБРАЛ конкретную

ЦЕНА должна СТРОГО соответствовать выбранной услуге из этого списка:
{services_list}

ПРАВИЛА ОПРЕДЕЛЕНИЯ ДАТЫ:
- "сегодня" → {today}
- "завтра" → {tomorrow}
- Конкретное число → преобразуй в YYYY-MM-DD
- НЕ указана → null

Ответь ТОЛЬКО в формате JSON:
{{
  "ready": true/false,
  "service": "ТОЧНОЕ название услуги или null",
  "master": "имя мастера или null",
  "price": число или null,
  "date": "YYYY-MM-DD или null",
  "time": "HH:MM или null",
  "reason": "почему ready=false (если false)"
}}"""

            response = await vertex_ai.generate_content(prompt)
            json_match = re.search(r'\{[\s\S]*\}', response)
            
            if json_match:
                data = json.loads(json_match.group(0))
                
                is_ready = (
                    data.get('ready') and
                    data.get('service') and
                    data.get('master') and
                    data.get('price') and
                    data.get('date') and
                    data.get('time')
                )
                
                logger.info(f"📋 Детекция записи: ready={is_ready}, service={data.get('service')}, "
                           f"master={data.get('master')}, price={data.get('price')}, "
                           f"date={data.get('date')}, time={data.get('time')}")
                
                # Если намерение готово, проверяем доступность
                if is_ready:
                    service_obj = next(
                        (s for s in SALON_DATA['services'] 
                         if s['name'] == data['service'] or 
                         s['name'].lower() in data['service'].lower()),
                        None
                    )
                    duration = service_obj['duration'] if service_obj else 60
                    
                    is_free = await AvailabilityChecker.check_availability(
                        data['master'], data['date'], data['time'], duration
                    )
                    
                    if not is_free:
                        logger.info(f"⛔ Слот занят: {data['master']} {data['date']} {data['time']}")
                        return {'ready': False, 'data': data, 'slotBusy': True}
                
                return {'ready': is_ready, 'data': data}
                
        except Exception as e:
            logger.error(f"Ошибка определения намерения: {e}")
        
        return {'ready': False, 'data': None}

# ===================== ДЕТЕКЦИЯ ОТМЕНЫ =====================
class CancellationDetector:
    @staticmethod
    async def detect_cancellation(user_id: str, message_text: str) -> bool:
        """Детекция попытки отмены записи"""
        lower = message_text.lower().strip()
        
        cancel_keywords = [
            'отмени', 'отмена', 'передумал', 'передумала',
            'не хочу', 'удали запись', 'не приду', 'отменить', 'сброс'
        ]
        
        if any(keyword in lower for keyword in cancel_keywords):
            logger.info(f"🚫 Обнаружена попытка отмены от {user_id}: \"{message_text}\"")
            
            conn = None
            try:
                conn = db_manager.get_connection()
                cursor = conn.cursor()
                
                cursor.execute("""
                    SELECT id, status, service, date, time FROM bookings
                    WHERE user_id = %s AND status IN ('pending', 'confirmed')
                    ORDER BY created_at DESC LIMIT 1
                """, (user_id,))
                
                booking = cursor.fetchone()
                
                if booking:
                    cursor.execute(
                        "UPDATE bookings SET status = 'cancelled' WHERE id = %s",
                        (booking['id'],)
                    )
                    conn.commit()
                    
                    logger.info(f"🚫 Запись #{booking['id']} ({booking['status']}) отменена пользователем")
                    
                    # Уведомляем админов если запись была подтверждена
                    if booking['status'] == 'confirmed':
                        await AdminNotifier.notify_cancellation(booking['id'], booking)
                    
                    return True
                else:
                    logger.info(f"⚠️ У пользователя {user_id} нет активных записей для отмены")
                    await ConversationManager.reset_session(user_id, silent=True)
                    return True
                    
            except Exception as e:
                logger.error(f"Ошибка при отмене: {e}")
                if conn:
                    conn.rollback()
            finally:
                if conn:
                    cursor.close()
                    db_manager.return_connection(conn)
        
        return False

# ===================== УПРАВЛЕНИЕ ЗАПИСЯМИ =====================
class BookingManager:
    @staticmethod
    async def create_booking(message_data: Dict[str, Any], conversation: Dict[str, Any], 
                            booking_data: Dict[str, Any]) -> bool:
        """Создание записи"""
        conn = None
        try:
            # Rate limiting
            conn = db_manager.get_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT COUNT(*) as count FROM bookings
                WHERE user_id = %s AND created_at > NOW() - INTERVAL '1 hour'
            """, (message_data['user_id'],))
            
            rate_check = cursor.fetchone()
            if rate_check and int(rate_check['count']) >= 5:
                logger.info(f"⛔ Rate limit exceeded for {message_data['user_id']}")
                return False
            
            # Получаем данные клиента
            client_phone = conversation.get('client_phone') or extract_phone_number(message_data['user_id'])
            client_name = conversation.get('client_name') or 'Клиент'
            
            # Находим длительность услуги
            service_obj = next(
                (s for s in SALON_DATA['services']
                 if s['name'] == booking_data['service'] and
                 (s['master'] == booking_data['master'] or s['master'] == 'другие')),
                None
            )
            service_duration = service_obj['duration'] if service_obj else 60
            
            logger.info(f"📋 Создание записи: {booking_data['service']} ({service_duration} мин)")
            logger.info(f"👤 Мастер: {booking_data['master']}")
            logger.info(f"📅 Дата: {booking_data['date']}, Время: {booking_data['time']}")
            
            # Финальная проверка доступности
            is_free = await AvailabilityChecker.check_availability(
                booking_data['master'],
                booking_data['date'],
                booking_data['time'],
                service_duration
            )
            
            if not is_free:
                logger.info(f"⛔ Слот занят при финальной проверке")
                return False
            
            # Создаем запись
            cursor.execute("""
                INSERT INTO bookings (user_id, client_name, client_phone, service, master, 
                                     price, date, time, duration, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending')
                RETURNING id
            """, (
                message_data['user_id'],
                client_name,
                client_phone,
                booking_data['service'],
                booking_data['master'],
                booking_data['price'],
                booking_data['date'],
                booking_data['time'],
                service_duration
            ))
            
            booking_id = cursor.fetchone()['id']
            conn.commit()
            
            logger.info(f"✅ Запись #{booking_id} создана с длительностью {service_duration} мин")
            
            # Обновляем conversation
            conversation['booking_data'] = {
                **booking_data,
                'id': booking_id,
                'duration': service_duration
            }
            
            # Добавляем системное сообщение
            conversation['history'].append({
                'role': 'assistant',
                'content': f"СИСТЕМНОЕ СООБЩЕНИЕ: Запрос на запись #{booking_id} отправлен администратору.",
                'timestamp': datetime.now().isoformat()
            })
            
            await ConversationManager.save_conversation(conversation)
            
            # Уведомление админов
            await AdminNotifier.notify_new_booking(booking_id)
            
            return True
            
        except Exception as e:
            logger.error(f"Ошибка создания записи: {e}")
            if conn:
                conn.rollback()
            return False
        finally:
            if conn:
                cursor.close()
                db_manager.return_connection(conn)
    
    @staticmethod
    async def confirm_booking(booking_id: int, admin_id: str) -> Dict[str, Any]:
        """Подтверждение записи администратором"""
        conn = None
        try:
            conn = db_manager.get_connection()
            cursor = conn.cursor()
            
            cursor.execute("SELECT * FROM bookings WHERE id = %s", (booking_id,))
            booking = cursor.fetchone()
            
            if not booking:
                return {'success': False, 'message': '❌ Запись не найдена'}
            
            if booking['status'] == 'confirmed':
                return {'success': False, 'message': f"⚠️ Запись #{booking_id} уже подтверждена"}
            
            if booking['status'] == 'rejected':
                return {'success': False, 'message': f"⚠️ Запись #{booking_id} была отклонена"}
            
            cursor.execute("""
                UPDATE bookings SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP
                WHERE id = %s
            """, (booking_id,))
            
            conn.commit()
            
            # Добавление в календарь
            await calendar_manager.add_event(dict(booking))
            
            # Обновление статистики
            await StatisticsManager.update_statistics(dict(booking))
            
            logger.info(f"✅ Запись #{booking_id} подтверждена")
            
            return {
                'success': True,
                'message': f"✅ Запись #{booking_id} подтверждена\nКлиент {booking['client_name']} уведомлен",
                'booking': dict(booking)
            }
            
        except Exception as e:
            logger.error(f"Ошибка подтверждения: {e}")
            if conn:
                conn.rollback()
            return {'success': False, 'message': 'Произошла ошибка при подтверждении'}
        finally:
            if conn:
                cursor.close()
                db_manager.return_connection(conn)
    
    @staticmethod
    async def reject_booking(booking_id: int) -> Dict[str, Any]:
        """Отклонение записи"""
        conn = None
        try:
            conn = db_manager.get_connection()
            cursor = conn.cursor()
            
            cursor.execute("SELECT * FROM bookings WHERE id = %s", (booking_id,))
            booking = cursor.fetchone()
            
            if not booking:
                return {'success': False, 'message': '❌ Запись не найдена'}
            
            if booking['status'] == 'confirmed':
                return {'success': False, 'message': f"⚠️ Запись #{booking_id} уже подтверждена"}
            
            if booking['status'] == 'rejected':
                return {'success': False, 'message': f"⚠️ Запись #{booking_id} уже отклонена"}
            
            cursor.execute("UPDATE bookings SET status = 'rejected' WHERE id = %s", (booking_id,))
            conn.commit()
            
            logger.info(f"❌ Запись #{booking_id} отклонена")
            
            return {
                'success': True,
                'message': f"❌ Запись #{booking_id} отклонена\nКлиент {booking['client_name']} уведомлен",
                'booking': dict(booking)
            }
            
        except Exception as e:
            logger.error(f"Ошибка отклонения: {e}")
            if conn:
                conn.rollback()
            return {'success': False, 'message': 'Произошла ошибка при отклонении'}
        finally:
            if conn:
                cursor.close()
                db_manager.return_connection(conn)

# ===================== УВЕДОМЛЕНИЯ АДМИНИСТРАТОРОВ =====================
class AdminNotifier:
    @staticmethod
    async def notify_new_booking(booking_id: int):
        """Уведомление о новой записи"""
        conn = None
        try:
            conn = db_manager.get_connection()
            cursor = conn.cursor()
            
            cursor.execute("SELECT * FROM bookings WHERE id = %s", (booking_id,))
            booking = cursor.fetchone()
            
            if not booking:
                return
            
            formatted_date = format_date_for_display(str(booking['date'])[:10])
            formatted_time = str(booking['time'])[:5]
            
            admin_message = f"""🔔 НОВАЯ ЗАПИСЬ #{booking['id']}

👤 Клиент: {booking['client_name']}
📱 Телефон: {booking['client_phone']}

📋 Услуга: {booking['service']}
👨‍💼 Мастер: {booking['master']}
💰 Цена: {booking['price']} тг
📅 Дата: {formatted_date}
🕐 Время: {formatted_time}

✅ Подтвердить: /ok {booking['id']}
❌ Отклонить: /no {booking['id']}"""
            
            for admin_id in CONFIG.ADMIN_WHITELIST:
                try:
                    # Здесь должна быть отправка через WhatsApp
                    logger.info(f"✅ Уведомление отправлено админу: {admin_id}")
                except Exception as e:
                    logger.error(f"❌ Ошибка отправки админу {admin_id}: {e}")
                    
        except Exception as e:
            logger.error(f"Ошибка уведомления админов: {e}")
        finally:
            if conn:
                cursor.close()
                db_manager.return_connection(conn)
    
    @staticmethod
    async def notify_cancellation(booking_id: int, booking: Dict[str, Any]):
        """Уведомление об отмене"""
        for admin_id in CONFIG.ADMIN_WHITELIST:
            try:
                message = f"""⚠️ ОТМЕНА ЗАПИСИ #{booking_id}

Клиент отменил подтвержденную запись:
📋 {booking['service']}
📅 {booking['date']}
🕐 {booking['time']}"""
                # Здесь должна быть отправка через WhatsApp
                logger.info(f"Уведомление об отмене отправлено админу {admin_id}")
            except Exception as e:
                logger.error(f"Ошибка уведомления админа {admin_id}: {e}")

# ===================== СТАТИСТИКА =====================
class StatisticsManager:
    @staticmethod
    async def update_statistics(booking: Dict[str, Any]):
        """Обновление статистики"""
        conn = None
        try:
            conn = db_manager.get_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                UPDATE statistics
                SET total_bookings = total_bookings + 1,
                    confirmed_bookings = confirmed_bookings + 1,
                    revenue = revenue + %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE master_name = %s
            """, (booking['price'], booking['master']))
            
            # Обновление данных клиента
            cursor.execute("""
                UPDATE clients
                SET total_visits = total_visits + 1,
                    total_spent = total_spent + %s,
                    last_visit = CURRENT_TIMESTAMP
                WHERE phone = %s
            """, (booking['price'], booking['client_phone']))
            
            conn.commit()
            logger.info(f"✅ Статистика обновлена для {booking['master']}")
            
        except Exception as e:
            logger.error(f"Ошибка обновления статистики: {e}")
            if conn:
                conn.rollback()
        finally:
            if conn:
                cursor.close()
                db_manager.return_connection(conn)
    
    @staticmethod
    async def get_statistics() -> str:
        """Получить статистику"""
        conn = None
        try:
            conn = db_manager.get_connection()
            cursor = conn.cursor()
            
            cursor.execute("SELECT * FROM statistics ORDER BY revenue DESC")
            stats = cursor.fetchall()
            
            stats_text = "📊 СТАТИСТИКА САЛОНА\n\n"
            
            for stat in stats:
                stats_text += f"👤 {stat['master_name']}\n"
                stats_text += f"   📝 Всего записей: {stat['total_bookings']}\n"
                stats_text += f"   ✅ Подтверждено: {stat['confirmed_bookings']}\n"
                stats_text += f"   💰 Доход: {stat['revenue']:,} тг\n\n"
            
            # Общая статистика
            total_revenue = sum(int(s['revenue']) for s in stats)
            total_bookings = sum(int(s['total_bookings']) for s in stats)
            
            cursor.execute("SELECT COUNT(*) as count FROM conversations")
            conversations_count = cursor.fetchone()['count']
            
            stats_text += f"📈 ОБЩАЯ СТАТИСТИКА\n"
            stats_text += f"Всего записей: {total_bookings}\n"
            stats_text += f"Общий доход: {total_revenue:,} тг\n"
            stats_text += f"Активных диалогов: {conversations_count}"
            
            return stats_text
            
        except Exception as e:
            logger.error(f"Ошибка получения статистики: {e}")
            return "Ошибка получения статистики"
        finally:
            if conn:
                cursor.close()
                db_manager.return_connection(conn)

# ===================== ГЕНЕРАЦИЯ ОТВЕТОВ AI =====================
class AIResponseGenerator:
    @staticmethod
    async def generate_response(message_text: str, conversation: Dict[str, Any]) -> str:
        """Генерация ответа через AI"""
        try:
            system_prompt = create_system_prompt(conversation.get('client_name'))
            chat_history = conversation['history'][-10:]
            
            history_text = '\n'.join([
                f"{'Клиент' if msg['role'] == 'user' else 'Бот'}: {msg['content']}"
                for msg in chat_history
            ])
            
            full_prompt = f"""{system_prompt}

ИСТОРИЯ ДИАЛОГА:
{history_text}

НОВОЕ СООБЩЕНИЕ КЛИЕНТА:
{message_text}

ТВОЙ ОТВЕТ:"""
            
            response = await vertex_ai.generate_content(full_prompt)
            
            logger.info(f"🤖 Ответ AI (первые 200 символов): {response[:200]}...")
            
            # Проверка на команду проверки доступности
            availability_match = re.search(
                r'ПРОВЕРИТЬ_ДОСТУПНОСТЬ:\s*мастер=(.+?),\s*дата=(\d{4}-\d{2}-\d{2}),\s*время=(\d{2}:\d{2})',
                response,
                re.IGNORECASE
            )
            
            if availability_match:
                master_name, check_date, check_time = availability_match.groups()
                
                logger.info(f"🔍 Обнаружена команда проверки доступности:")
                logger.info(f"   Мастер: {master_name.strip()}")
                logger.info(f"   Дата: {check_date}")
                logger.info(f"   Время: {check_time}")
                
                # Находим длительность услуги
                recent_messages = conversation['history'][-3:]
                service_duration = 60
                
                for msg in recent_messages:
                    if msg['role'] == 'user':
                        message_lower = msg['content'].lower()
                        found_service = next(
                            (s for s in SALON_DATA['services']
                             if s['name'].lower() in message_lower),
                            None
                        )
                        if found_service:
                            service_duration = found_service['duration']
                            break
                
                is_free = await AvailabilityChecker.check_availability(
                    master_name.strip(), check_date, check_time, service_duration
                )
                
                if not is_free:
                    logger.info(f"⛔ Время {check_time} на {check_date} ЗАНЯТО!")
                    
                    available_slots = await AvailabilityChecker.get_available_slots(
                        master_name.strip(), check_date
                    )
                    
                    busy_message = f"\n\n⚠️ К сожалению, время {check_time} на {format_date_for_display(check_date)} к мастеру {master_name.strip()} уже занято! 😔"
                    
                    if available_slots:
                        slots_text = '\n'.join([f"• {time}" for time in available_slots[:10]])
                        busy_message += f"\n\nСвободные окна на эту дату:\n{slots_text}\n\nВыберите удобное время!"
                    else:
                        busy_message += "\n\nК сожалению, на эту дату все занято. Попробуйте другой день! 🤍"
                    
                    response = re.sub(r'ПРОВЕРИТЬ_ДОСТУПНОСТЬ:.+', busy_message, response, flags=re.IGNORECASE)
                else:
                    logger.info(f"✅ Время {check_time} СВОБОДНО!")
                    response = re.sub(r'\s*ПРОВЕРИТЬ_ДОСТУПНОСТЬ:.+', '', response, flags=re.IGNORECASE)
            
            return response
            
        except Exception as e:
            logger.error(f"Ошибка Gemini AI: {e}")
            return "Извините, произошла техническая ошибка. Попробуйте еще раз или позвоните нам."

# ===================== ОБРАБОТЧИК СООБЩЕНИЙ =====================
class MessageHandler:
    @staticmethod
    def is_admin(user_id: str) -> bool:
        """Проверка является ли пользователь администратором"""
        clean_id = re.sub(r'@.+', '', user_id)
        return any(re.sub(r'@.+', '', admin_id) == clean_id for admin_id in CONFIG.ADMIN_WHITELIST)
    
    @staticmethod
    async def handle_message(message_data: Dict[str, Any]):
        """Основной обработчик сообщений"""
        user_id = message_data['user_id']
        user_message = message_data['message'].strip()
        
        # Игнорируем сообщения от ботов и групп
        if message_data.get('from_me') or '@g.us' in user_id:
            return
        
        # Получение состояния разговора
        conversation = await ConversationManager.get_conversation(user_id)
        
        # Проверка истечения сессии
        if conversation:
            is_expired = await ConversationManager.check_session_expiry(conversation)
            if is_expired:
                logger.info(f"⏰ Сессия истекла для {user_id}, сбрасываем тихо")
                await ConversationManager.reset_session(user_id, silent=True)
                conversation = None
        
        # Обработка админских команд
        if MessageHandler.is_admin(user_id):
            logger.info(f"👤 Admin call detected from {user_id}: {user_message}")
            
            if user_message == '/admin':
                stats = await StatisticsManager.get_statistics()
                # Отправка статистики админу
                logger.info(f"Отправка статистики админу {user_id}")
                return
            
            if user_message == '/dashboard':
                # Отправка ссылки на дашборд
                logger.info(f"Отправка ссылки на дашборд админу {user_id}")
                return
            
            if re.match(r'^/ok\s+\d+$', user_message):
                booking_id = int(user_message.split()[1])
                result = await BookingManager.confirm_booking(booking_id, user_id)
                # Отправка результата админу
                logger.info(f"Подтверждение записи #{booking_id}: {result['message']}")
                return
            
            if re.match(r'^/no\s+\d+$', user_message):
                booking_id = int(user_message.split()[1])
                result = await BookingManager.reject_booking(booking_id)
                # Отправка результата админу
                logger.info(f"Отклонение записи #{booking_id}: {result['message']}")
                return
            
            if user_message.startswith('/connect'):
                # Подключение к чату клиента
                logger.info(f"Админ {user_id} подключается к чату клиента")
                return
            
            if user_message == '/close':
                # Завершение чата
                logger.info(f"Админ {user_id} завершает режим оператора")
                return
        
        # Команда связи с оператором
        if any(keyword in user_message.lower() for keyword in ['оператор', 'админ', 'менеджер']):
            logger.info(f"Клиент {user_id} запрашивает оператора")
            # Уведомление админов
            return
        
        # Команда изменения имени
        if re.match(r'^/update_name\s+.+$', user_message, re.IGNORECASE):
            new_name = re.sub(r'^/update_name\s+', '', user_message, flags=re.IGNORECASE).strip().split()[0]
            if conversation:
                conversation['client_name'] = new_name
                if not conversation.get('client_phone'):
                    conversation['client_phone'] = extract_phone_number(user_id)
                await ConversationManager.save_conversation(conversation)
                await ClientManager.save_client(conversation['client_phone'], new_name, user_id)
                logger.info(f"✅ Имя обновлено: {new_name}")
            return
        
        # Команда просмотра данных
        if user_message == '/myinfo':
            if conversation:
                phone = conversation.get('client_phone') or extract_phone_number(user_id)
                logger.info(f"Отправка информации о клиенте: {conversation.get('client_name')}")
            return
        
        # Создание новой сессии
        if not conversation:
            # Проверяем существующего клиента
            conn = None
            try:
                conn = db_manager.get_connection()
                cursor = conn.cursor()
                
                cursor.execute("SELECT name, phone FROM clients WHERE user_id = %s", (user_id,))
                existing_client = cursor.fetchone()
                
                if existing_client and existing_client['name'] and existing_client['phone']:
                    conversation = {
                        'user_id': user_id,
                        'stage': 'conversation',
                        'history': [],
                        'booking_data': {},
                        'client_name': existing_client['name'],
                        'client_phone': existing_client['phone']
                    }
                    await ConversationManager.save_conversation(conversation)
                    logger.info(f"🔄 Восстановлена сессия для {existing_client['name']}")
                else:
                    # Новый клиент
                    conversation = {
                        'user_id': user_id,
                        'stage': 'asking_name_and_phone',
                        'history': [],
                        'booking_data': {},
                        'client_name': None,
                        'client_phone': extract_phone_number(user_id)
                    }
                    await ConversationManager.save_conversation(conversation)
                    logger.info(f"Новый клиент: {user_id}")
                    
            finally:
                if conn:
                    cursor.close()
                    db_manager.return_connection(conn)
            
            # Отправка приветственного сообщения
            if conversation['stage'] == 'asking_name_and_phone':
                greeting = (
                    f"Здравствуйте! 👋\n\n"
                    f"Добро пожаловать в {CONFIG.SALON_NAME}!\n\n"
                    f"Как вас зовут?"
                )
                await whatsapp_manager.send_message(user_id, greeting)
            elif conversation['stage'] == 'conversation':
                welcome_back = (
                    f"С возвращением! 👋\n\n"
                    f"Чем могу помочь сегодня?"
                )
                await whatsapp_manager.send_message(user_id, welcome_back)
            return
        
        # Запрос имени и телефона
        if conversation['stage'] == 'asking_name_and_phone':
            name_validation = await DataValidator.validate_name(user_message)
            
            if not name_validation['isValid']:
                error_msg = name_validation.get('message', 'Пожалуйста, напишите ваше настоящее имя 😊')
                await whatsapp_manager.send_message(user_id, error_msg)
                logger.info(f"Невалидное имя от {user_id}")
                return
            
            clean_name = name_validation['data']
            phone_validation = await DataValidator.validate_phone(user_message)
            
            extracted_phone = extract_phone_number(user_id)
            final_phone = None
            
            if phone_validation['isValid']:
                final_phone = phone_validation['data']
            elif '@lid' not in user_id:
                final_phone = extracted_phone
            
            if not final_phone:
                conversation['client_name'] = clean_name
                conversation['stage'] = 'asking_phone_only'
                await ConversationManager.save_conversation(conversation)
                
                phone_request = (
                    f"Приятно познакомиться, {clean_name}! 😊\n\n"
                    f"Укажите, пожалуйста, ваш номер телефона."
                )
                await whatsapp_manager.send_message(user_id, phone_request)
                return
            
            conversation['client_name'] = clean_name
            conversation['client_phone'] = final_phone
            conversation['stage'] = 'conversation'
            await ConversationManager.save_conversation(conversation)
            await ClientManager.save_client(final_phone, clean_name, user_id)
            
            logger.info(f"✅ Клиент зарегистрирован: {clean_name} ({final_phone})")
            
            # Приветственное сообщение
            welcome = (
                f"Приятно познакомиться, {clean_name}! 😊\n\n"
                f"Расскажите, какая услуга вас интересует?"
            )
            await whatsapp_manager.send_message(user_id, welcome)
            return
        
        # Запрос только телефона
        if conversation['stage'] == 'asking_phone_only':
            phone_validation = await DataValidator.validate_phone(user_message)
            
            if not phone_validation['isValid']:
                error_msg = phone_validation.get('message', 'Пожалуйста, укажите корректный номер телефона')
                await whatsapp_manager.send_message(user_id, error_msg)
                logger.info(f"Невалидный телефон от {user_id}")
                return
            
            conversation['client_phone'] = phone_validation['data']
            conversation['stage'] = 'conversation'
            await ConversationManager.save_conversation(conversation)
            await ClientManager.save_client(
                conversation['client_phone'],
                conversation['client_name'],
                user_id
            )
            logger.info(f"✅ Телефон сохранен: {phone_validation['data']}")
            
            # Отправка приветственного сообщения
            welcome_msg = (
                f"Отлично, {conversation['client_name']}! 😊\n\n"
                f"Теперь расскажите, какая услуга вас интересует?\n\n"
                f"Мы предлагаем:\n"
                f"💅 Маникюр и наращивание\n"
                f"👁 Брови и ресницы\n"
                f"✨ Шугаринг\n\n"
                f"Или просто напишите, что вам нужно!"
            )
            await whatsapp_manager.send_message(user_id, welcome_msg)
            return
        
        # Режим оператора
        if conversation.get('is_admin_mode') and conversation.get('admin_chat_id'):
            # Пересылка сообщения админу
            conversation['history'].append({
                'role': 'user',
                'content': user_message,
                'timestamp': datetime.now().isoformat()
            })
            await ConversationManager.save_conversation(conversation)
            logger.info(f"Сообщение переслано админу {conversation['admin_chat_id']}")
            return
        
        # Добавление в историю
        conversation['history'].append({
            'role': 'user',
            'content': user_message,
            'timestamp': datetime.now().isoformat()
        })
        
        await ConversationManager.save_conversation(conversation)
        
        # Генерация ответа AI
        response = await AIResponseGenerator.generate_response(user_message, conversation)
        
        # Отправка ответа пользователю
        await whatsapp_manager.send_message(user_id, response)
        
        conversation['history'].append({
            'role': 'assistant',
            'content': response,
            'timestamp': datetime.now().isoformat()
        })
        
        await ConversationManager.save_conversation(conversation)
        
        # Проверка намерения записаться
        booking_intent = await BookingIntentDetector.detect_booking_intent(conversation)
        
        if booking_intent['ready']:
            logger.info(f"📋 Все данные собраны, создаём запись...")
            success = await BookingManager.create_booking(
                message_data,
                conversation,
                booking_intent['data']
            )
            if success:
                logger.info(f"✅ Запись успешно создана")
        elif booking_intent.get('slotBusy'):
            logger.info(f"⚠️ Слот занят")
            # Отправка сообщения о занятости
        else:
            # Детекция отмены
            if await CancellationDetector.detect_cancellation(user_id, user_message):
                logger.info(f"Запись отменена пользователем {user_id}")
                return
            
            # Обычный ответ
            logger.info(f"Отправка ответа клиенту {user_id}")

# ===================== WHATSAPP CLIENT =====================
class WhatsAppManager:
    """
    WhatsApp Manager supporting multiple integration methods:
    1. whatsapp-bridge (Local Go bridge) - Recommended for personal numbers
    2. Stub (Console output) - Default if no method selected
    """
    def __init__(self):
        self.client = None
        self.is_ready = False
        self.method = os.getenv('WHATSAPP_METHOD', 'stub')
        self.polling_task = None
        
    async def init_whatsapp(self):
        """Инициализация WhatsApp клиента"""
        try:
            logger.info(f"📱 Инициализация WhatsApp клиента (метод: {self.method})...")
            
            if self.method == 'bridge':
                if not WHATSAPP_BRIDGE_AVAILABLE:
                    logger.error("❌ Библиотека whatsapp-bridge не установлена. Выполните: pip install whatsapp-bridge")
                    self.method = 'stub'
                else:
                    self.client = WhatsappClient()
                    self.is_ready = True
                    logger.info("✅ WhatsApp Bridge инициализирован")
                    
                    # Запуск опроса сообщений
                    self.polling_task = asyncio.create_task(self.poll_messages())
                    logger.info("🔄 Опрос сообщений запущен")
                    return

            # Fallback to stub
            logger.warning("⚠️ WhatsApp клиент работает в режиме консоли (stub mode)")
            self.is_ready = True
            logger.info("✅ WhatsApp stub инициализирован")
            
        except Exception as e:
            logger.error(f"❌ Ошибка инициализации WhatsApp: {e}")
            raise
    
    async def poll_messages(self):
        """Опрос сообщений для bridge метода"""
        logger.info("🚀 Старт цикла опроса WhatsApp messages...")
        while True:
            try:
                if self.client:
                    messages = self.client.get_new_messages()
                    if messages:
                        for msg in messages:
                            # Извлечение данных
                            # Обычно ключи: chat_jid, sender_jid, text, is_group, from_me
                            # Адаптируем под структуру MessageHandler
                            
                            chat_id = msg.get('chat_jid', msg.get('chat', ''))
                            text = msg.get('text', msg.get('body', msg.get('content', '')))
                            from_me = msg.get('from_me', False)
                            
                            if not text or from_me:
                                continue
                                
                            # Если есть @, берем часть до @ как user_id
                            user_id = chat_id.split('@')[0] if '@' in chat_id else chat_id
                            
                            message_data = {
                                'user_id': user_id,
                                'message': text,
                                'from_me': False,
                                'raw_data': msg
                            }
                            
                            # Обработка сообщения
                            await MessageHandler.handle_message(message_data)
                            
            except Exception as e:
                logger.error(f"❌ Ошибка в цикле опроса: {e}")
                
            await asyncio.sleep(2)  # Пауза 2 секунды

    async def send_message(self, to: str, message: str):
        """Отправка сообщения"""
        if not self.is_ready:
            logger.warning("⚠️ WhatsApp клиент не готов")
            return False
        
        try:
            if self.method == 'bridge' and self.client:
                clean_to = to.replace('+', '').replace(' ', '')
                # whatsapp-bridge expects number or JID
                result = self.client.send_message(clean_to, message)
                if result:
                    logger.info(f"✅ Сообщение отправлено: {clean_to}")
                    return True
                else:
                    logger.error(f"❌ Ошибка отправки: {clean_to}")
                    return False
            
            # Stub mode
            logger.info("")
            logger.info("=" * 60)
            logger.info(f"📤 STUB ОТПРАВКА СООБЩЕНИЯ")
            logger.info(f"Кому: {to}")
            logger.info(f"Текст:\n{message}")
            logger.info("=" * 60)
            return True
            
        except Exception as e:
            logger.error(f"❌ Ошибка отправки сообщения: {e}")
            return False
    
    async def stop(self):
        """Остановка клиента"""
        if self.polling_task:
            self.polling_task.cancel()
        try:
            logger.info("✅ WhatsApp клиент остановлен")
        except Exception as e:
            logger.error(f"Ошибка остановки WhatsApp: {e}")

# Глобальный экземпляр WhatsApp менеджера
whatsapp_manager = WhatsAppManager()

# ===================== ОСНОВНОЙ КЛАСС БОТА =====================
class LaMirageBot:
    def __init__(self):
        self.whatsapp_client = None
        self.is_ready = False
        
    async def start(self):
        """Запуск бота"""
        logger.info("🚀 Запуск бота La Mirage...")
        
        self.validate_config()
        
        # Инициализация компонентов
        db_manager.init_pool()
        await db_manager.init_database()
        
        vertex_ai.init_vertex_ai()
        calendar_manager.init_calendar()
        
        # Инициализация WhatsApp клиента
        await whatsapp_manager.init_whatsapp()
        
        # Запуск планировщиков
        self.start_schedulers()
        
        logger.info("✅ Бот готов к работе!")
    
    def validate_config(self):
        """Валидация конфигурации"""
        required = ['VERTEX_PROJECT_ID', 'VERTEX_KEY_FILE', 'DATABASE_URL']
        missing = [key for key in required if not getattr(CONFIG, key)]
        
        if missing:
            logger.error(f"❌ Отсутствуют обязательные переменные: {', '.join(missing)}")
            raise ValueError("Неполная конфигурация")
        
        logger.info("\n📋 КОНФИГУРАЦИЯ БОТА:")
        logger.info(f"Салон: {CONFIG.SALON_NAME}")
        logger.info(f"Администраторов: {len(CONFIG.ADMIN_WHITELIST)} человек")
        for i, admin in enumerate(CONFIG.ADMIN_WHITELIST, 1):
            logger.info(f"   {i}. {admin}")
        logger.info("")
        
        if not CONFIG.ADMIN_WHITELIST:
            logger.warning("⚠️ ADMIN_WHITELIST пуст. Добавьте номера администраторов в .env")
    
    def start_schedulers(self):
        """Запуск планировщиков задач"""
        # Планировщик очистки сессий (каждые 15 минут)
        schedule.every(15).minutes.do(lambda: asyncio.create_task(self.cleanup_sessions()))
        
        # Планировщик напоминаний (каждые 30 минут)
        schedule.every(30).minutes.do(lambda: asyncio.create_task(self.send_reminders()))
        
        logger.info("✅ Планировщики запущены")
    
    async def cleanup_sessions(self):
        """Фоновая очистка истекших сессий"""
        conn = None
        try:
            logger.info("🧹 Проверка истекших сессий (фоновая очистка)...")
            
            conn = db_manager.get_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT user_id, client_name, updated_at, stage
                FROM conversations
                WHERE updated_at < NOW() - INTERVAL '30 minutes'
                AND stage != 'greeting'
            """)
            
            expired_sessions = cursor.fetchall()
            
            if expired_sessions:
                logger.info(f"⏰ Найдено {len(expired_sessions)} истекших сессий для фоновой очистки")
                
                for session in expired_sessions:
                    await ConversationManager.reset_session(session['user_id'], silent=True)
                    
                    minutes_inactive = int((datetime.now() - session['updated_at']).total_seconds() / 60)
                    logger.info(
                        f"✅ Фоновая очистка сессии: {session.get('client_name') or session['user_id']} "
                        f"(неактивна {minutes_inactive} мин)"
                    )
            else:
                logger.info("✅ Истекших сессий не найдено")
                
        except Exception as e:
            logger.error(f"❌ Ошибка фоновой очистки сессий: {e}")
        finally:
            if conn:
                cursor.close()
                db_manager.return_connection(conn)
    
    async def send_reminders(self):
        """Отправка напоминаний о записях"""
        conn = None
        try:
            now = datetime.now()
            one_hour_later = now + timedelta(hours=1)
            
            conn = db_manager.get_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT * FROM bookings
                WHERE status = 'confirmed'
                AND reminder_sent = FALSE
                AND date = %s
                AND time BETWEEN %s AND %s
            """, (
                one_hour_later.strftime('%Y-%m-%d'),
                now.strftime('%H:%M'),
                one_hour_later.strftime('%H:%M')
            ))
            
            bookings = cursor.fetchall()
            
            logger.info(f"⏰ Проверка напоминаний: найдено {len(bookings)} записей")
            
            for booking in bookings:
                try:
                    # Отправка напоминания через WhatsApp
                    reminder_text = (
                        f"⏰ Напоминание о записи!\n\n"
                        f"Услуга: {booking['service']}\n"
                        f"Мастер: {booking['master']}\n"
                        f"Время: {booking['time'][:5]}\n\n"
                        f"Ждём вас в {CONFIG.SALON_NAME}! 💅"
                    )
                    
                    await whatsapp_manager.send_message(booking['user_id'], reminder_text)
                    logger.info(f"✅ Напоминание отправлено: {booking['client_name']}")
                    
                    cursor.execute(
                        "UPDATE bookings SET reminder_sent = TRUE WHERE id = %s",
                        (booking['id'],)
                    )
                    conn.commit()
                    
                except Exception as e:
                    logger.error(f"Ошибка отправки напоминания для {booking['id']}: {e}")
                    
        except Exception as e:
            logger.error(f"Ошибка в системе напоминаний: {e}")
        finally:
            if conn:
                cursor.close()
                db_manager.return_connection(conn)

# ===================== ТОЧКА ВХОДА =====================
async def main():
    """Главная функция"""
    bot = LaMirageBot()
    await bot.start()
    
    # Запуск планировщика в фоновом режиме
    while True:
        schedule.run_pending()
        await asyncio.sleep(1)

# ===================== GRACEFUL SHUTDOWN =====================
def signal_handler(signum, frame):
    """Обработчик сигналов для graceful shutdown"""
    logger.info("\n👋 Получен сигнал остановки...")
    logger.info("Закрываю соединения...")
    
    # Закрытие пула БД
    if db_manager.connection_pool:
        db_manager.connection_pool.closeall()
        logger.info("✅ Пул БД закрыт")
    
    logger.info("✅ Бот остановлен")
    exit(0)

# ===================== ЭКСПОРТ МОДУЛЕЙ =====================
# Для использования в других модулях или тестах
__all__ = [
    # Конфигурация
    'CONFIG',
    'SALON_DATA',
    'MASTERS',
    
    # Менеджеры
    'DatabaseManager',
    'VertexAIManager',
    'GoogleCalendarManager',
    'ConversationManager',
    'ClientManager',
    'BookingManager',
    'StatisticsManager',
    
    # Детекторы и валидаторы
    'DataValidator',
    'BookingIntentDetector',
    'CancellationDetector',
    
    # Проверка доступности
    'AvailabilityChecker',
    
    # Обработчики
    'MessageHandler',
    'AIResponseGenerator',
    'AdminNotifier',
    
    # Утилиты
    'get_today',
    'get_tomorrow',
    'format_date_for_display',
    'get_day_of_week',
    'get_next_days',
    'extract_phone_number',
    'create_system_prompt',
    
    # Основной класс
    'LaMirageBot',
]

if __name__ == "__main__":
    import signal
    
    # Регистрация обработчиков сигналов
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        logger.info("=" * 60)
        logger.info("🚀 ЗАПУСК БОТА LA MIRAGE BEAUTY")
        logger.info("=" * 60)
        
        asyncio.run(main())
        
    except KeyboardInterrupt:
        logger.info("\n👋 Остановка бота (Ctrl+C)...")
    except Exception as e:
        logger.error(f"❌ Критическая ошибка: {e}")
        logger.error(f"Трассировка: {e.__traceback__}")
        exit(1)
