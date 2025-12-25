import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime

def run_my_sql(sql_query, params=None):
    """Универсальная функция подключения к БД"""
    db_config = {
        "dbname": "lamiragebeauty",
        "user": "postgres",
        "password": "root",  # Ваш пароль
        "host": "localhost",
        "port": "5432"
    }
    
    conn = None
    try:
        conn = psycopg2.connect(**db_config)
        conn.set_client_encoding('UTF8')
        
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql_query, params)
            if cur.description:
                return cur.fetchall()
            conn.commit()
            return "Запрос выполнен успешно"
            
    except Exception as e:
        return f"Ошибка базы данных: {e}"
    finally:
        if conn:
            conn.close()

# =====================================================
# ВАШ SQL СКРИПТ (Последние 10 активных диалогов)
# =====================================================
my_script = """
SELECT 
    user_id, 
    stage, 
    history, 
    updated_at 
FROM conversations 
WHERE jsonb_array_length(history) > 0 
ORDER BY updated_at DESC 
LIMIT 10;
"""

# =====================================================
# ВЫПОЛНЕНИЕ И КРАСИВЫЙ ВЫВОД
# =====================================================
results = run_my_sql(my_script)

if isinstance(results, list):
    print(f"\nНайдено диалогов: {len(results)}")
    
    for row in results:
        # Заголовок блока клиента
        print("\n" + "═"*60)
        print(f"📱 КЛИЕНТ: {row['user_id']}")
        print(f"📍 СТАДИЯ: {row['stage']}")
        print(f"🕒 ПОСЛЕДНЯЯ АКТИВНОСТЬ: {row['updated_at'].strftime('%d.%m.%Y %H:%M')}")
        print("─"*60)
        
        # Разбор истории сообщений
        history = row.get('history', [])
        for msg in history:
            role_icon = "👤 [КЛИЕНТ]" if msg['role'] == 'user' else "🤖 [БOT]"
            content = msg['content'].strip()
            
            # Печатаем роль и сообщение
            print(f"{role_icon}: {content}")
        
        print("═"*60)

elif isinstance(results, str):
    print(results)