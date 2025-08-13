import logging
import os
from logging.handlers import RotatingFileHandler

LOG_DIR = os.path.join(os.path.dirname(__file__), '..', 'logs')
LOG_FILE = os.path.join(LOG_DIR, 'app.log')

# S'assure que le dossier existe
os.makedirs(LOG_DIR, exist_ok=True)

# Configuration de base du logger
logging.basicConfig(level=logging.INFO)

# Crée un handler de rotation
file_handler = RotatingFileHandler(
    LOG_FILE, maxBytes=2 * 1024 * 1024, backupCount=5, encoding='utf-8'
)
formatter = logging.Formatter('[%(asctime)s] %(levelname)s %(name)s: %(message)s')
file_handler.setFormatter(formatter)

# Ajoute le handler au root logger si ce n'est pas déjà fait
if not any(isinstance(h, RotatingFileHandler) for h in logging.getLogger().handlers):
    logging.getLogger().addHandler(file_handler)

def get_logger(name=None):
    """
    Récupère un logger configuré pour le projet.
    Utilisation :
        logger = get_logger(__name__)
        logger.info("Message")
    """
    return logging.getLogger(name)

