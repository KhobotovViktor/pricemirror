import sys
import os

# Добавляем корневую директорию в PYTHONPATH для корректного импорта модулей
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from app.main import app
