import json
import os


class ConfigManager:
    def __init__(self, config_file=None):

        if config_file is None:
            config_file = os.path.join(os.path.dirname(__file__), "..", "..", "config.json")

        self.config_file = config_file
        self.config = self.load_config(config_file)
        self.known_locations = self.config.get("known_locations", self.get_default_locations())

    def load_config(self, config_file):
        """Charge la configuration depuis le fichier JSON"""
        try:
            if os.path.exists(config_file):
                with open(config_file, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                print(f" Configuration chargée depuis {config_file}")
                return config
            else:
                print(f" Fichier {config_file} non trouvé, configuration par défaut utilisée")
                return self.get_default_config()
        except Exception as e:
            print(f" Erreur chargement config: {e}")
            return self.get_default_config()

    def get_default_config(self):
        """Load complete default configuration"""
        return {
            "steam_api": {
                "api_key": None,
                "default_language": "fr",
                "timeout": 10,
                "max_retries": 3
            },
            "achievements": {
                "fallback_beautify": True,
                "show_hidden": True,
                "sort_by_percentage": True
            },
            "debug": {
                "verbose_mode": False,
                "show_api_calls": False
            },
            "cache": {  # ← NOUVEAU
                "enabled": True,
                "cache_dir": "./data/cache",
                "default_ttl": 86400,  # 24 hours
                "max_cache_size": 104857600,  # 100MB
                "cleanup_on_start": True
            },
            "paths": {
                "output_dir": "./output"
            },
            "known_locations": self.get_default_locations()
        }

    def get_default_locations(self):
        """Configuration par défaut des emplacements si pas de fichier"""
        return {
            "public_docs": {
                "base_path": "C:/Users/Public/Documents/Steam",
                "teams": ["CODEX", "RUNE"]
            },
            "appdata_roaming": {
                "base_path": "~/AppData/Roaming",
                "teams": ["EMPRESS", "SmartSteamEmu", "Goldberg SteamEmu Saves", "CreamAPI"]
            },
            "appdata_local": {
                "base_path": "~/AppData/Local",
                "teams": ["SKIDROW"]
            },
            "steam_appdata": {
                "base_path": "~/AppData/Roaming/Steam",
                "teams": ["CODEX"]
            }
        }



    def add_location(self, name, base_path, teams):
        """Ajoute dynamiquement un nouvel emplacement"""
        self.known_locations[name] = {
            "base_path": base_path,
            "teams": teams
        }
        # 🔄 Met à jour aussi la config principale
        self.config["known_locations"] = self.known_locations
        print(f" Nouvel emplacement ajouté: {name}")

    # 🆕 MÉTHODES BONUS UTILES :

    def get(self, key, default=None):
        """Récupère n'importe quelle valeur de config"""
        return self.config.get(key, default)

    def get_steam_api_key(self):
        """Raccourci pour récupérer la clé API"""
        return self.config.get("steam_api", {}).get("api_key")

    def get_debug_mode(self):
        """Raccourci pour savoir si debug activé"""
        return self.config.get("debug", {}).get("verbose_mode", False)

    def save_config(self):
        """💾 Sauvegarde les modifications dans le fichier"""
        try:
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(self.config, f, indent=2, ensure_ascii=False)
            print(f"💾 Configuration sauvegardée dans {self.config_file}")
        except Exception as e:
            print(f" Erreur sauvegarde config: {e}")
