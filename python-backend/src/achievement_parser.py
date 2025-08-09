import os
import configparser
import game_detector
import requests
import json
from bs4 import BeautifulSoup


class AchievementParser:
    def __init__(self, config_file="../../config.json"):
        self.achievement_files = {}
        self.config = self.load_config(config_file)

        # Configuration Steam API
        self.steam_api_key = self.config.get("steam_api", {}).get("api_key")
        self.language = self.config.get("steam_api", {}).get("default_language", "fr")
        self.timeout = self.config.get("steam_api", {}).get("timeout", 10)
        self.max_retries = self.config.get("steam_api", {}).get("max_retries", 3)

        # Configuration Achievements
        self.fallback_beautify = self.config.get("achievements", {}).get("fallback_beautify", True)
        self.show_hidden = self.config.get("achievements", {}).get("show_hidden", True)
        self.sort_by_percentage = self.config.get("achievements", {}).get("sort_by_percentage", True)

        # Configuration Debug
        self.verbose = self.config.get("debug", {}).get("verbose_mode", False)
        self.show_api_calls = self.config.get("debug", {}).get("show_api_calls", False)

        if self.verbose:
            print(f"🔧 Configuration chargée - API Key: {'✅' if self.steam_api_key else '❌'}")

    def load_config(self, config_file):
        """Charge la configuration depuis le fichier JSON"""
        try:
            if os.path.exists(config_file):
                with open(config_file, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                print(f"✅ Configuration chargée depuis {config_file}")
                return config
            else:
                print(f"⚠️ Fichier {config_file} non trouvé, configuration par défaut")
                return self.get_default_config()
        except Exception as e:
            print(f"❌ Erreur chargement config: {e}")
            return self.get_default_config()

    def get_default_config(self):
        """Configuration par défaut si pas de fichier"""
        return {
            "steam_api": {"api_key": None, "default_language": "fr", "timeout": 10},
            "achievements": {"fallback_beautify": True, "show_hidden": True},
            "debug": {"verbose_mode": False, "show_api_calls": False}
        }

    def update_config(self, new_values):
        """Met à jour la configuration et la sauvegarde"""
        try:
            for section, values in new_values.items():
                if section not in self.config:
                    self.config[section] = {}
                self.config[section].update(values)

            with open("config.json", 'w', encoding='utf-8') as f:
                json.dump(self.config, f, indent=2, ensure_ascii=False)

            print("✅ Configuration mise à jour et sauvegardée")
            return True
        except Exception as e:
            print(f"❌ Erreur sauvegarde config: {e}")
            return False

    def log_debug(self, message):
        """Log de debug si activé"""
        if self.verbose:
            print(f"🔍 {message}")

    def log_api_call(self, url):
        """Log des appels API si activé"""
        if self.show_api_calls:
            print(f"🌐 API Call: {url}")

    def check_achievements_file(self, game_path, id):
        """Vérifie si un fichier achievements.ini existe dans le dossier du jeu"""
        files = os.listdir(game_path)
        if "achievements.ini" in files:
            self.achievement_files[id] = os.path.join(game_path, "achievements.ini")
            return True

    def parse_achievements(self, ini_file_path):
        """Parse un fichier achievements.ini et retourne les achievements"""
        try:
            config = configparser.ConfigParser()
            config.read(ini_file_path, encoding='utf-8')

            achievements = {}
            for section_name in config.sections():
                print(f"Section trouvée : {section_name}")

            return achievements
        except Exception as e:
            print(f"Erreur lors du parsing de {ini_file_path}: {e}")
            return {}

    def get_achievement_names_no_key(self, app_id):
        """API Steam SANS clé - GetGlobalAchievementPercentages"""
        try:
            url = f"https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid={app_id}"
            self.log_api_call(url)

            response = requests.get(url, timeout=self.timeout)
            self.log_debug(f"Response status: {response.status_code}")

            if response.status_code == 200:
                data = response.json()
                achievements = {}

                if 'achievementpercentages' in data:
                    for ach in data['achievementpercentages'].get('achievements', []):
                        ach_name = ach.get('name', '')
                        percentage = ach.get('percent', 0)

                        achievements[ach_name] = {
                            'percentage': percentage,
                            'description': ''
                        }

                self.log_debug(f"Achievements récupérés: {len(achievements)}")
                return achievements

        except Exception as e:
            print(f"❌ Erreur API Percentages: {e}")
        return {}

    def get_store_page_achievements(self, app_id):
        """Scrape la page Store Steam pour récupérer les noms d'achievements"""
        try:
            url = f"https://store.steampowered.com/app/{app_id}/?l=french"
            self.log_api_call(url)

            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }

            response = requests.get(url, headers=headers, timeout=self.timeout)
            if response.status_code == 200:
                soup = BeautifulSoup(response.content, 'html.parser')
                achievement_names = {}

                achievement_elements = soup.find_all('div', class_='achievement_list_item')
                for elem in achievement_elements:
                    title_elem = elem.find('div', class_='achievement_list_item_name')
                    if title_elem:
                        achievement_names[title_elem.get_text().strip()] = True

                self.log_debug(f"Store achievements trouvés: {len(achievement_names)}")
                return achievement_names
        except Exception as e:
            self.log_debug(f"Store scraping failed: {e}")
        return {}

    def get_achievement_names_with_key(self, app_id, api_key):
        """API Steam AVEC clé - GetSchemaForGame"""
        try:
            url = f"https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key={api_key}&appid={app_id}&l={self.language}"
            self.log_api_call(url)

            response = requests.get(url, timeout=self.timeout)
            self.log_debug(f"Schema API status: {response.status_code}")

            if response.status_code == 200:
                data = response.json()
                achievements = {}

                if 'game' in data and 'availableGameStats' in data['game']:
                    stats = data['game']['availableGameStats']
                    if 'achievements' in stats:
                        for ach in stats['achievements']:
                            ach_id = ach.get('name', '')
                            display_name = ach.get('displayName', '')
                            description = ach.get('description', '')
                            hidden = ach.get('hidden', 0)

                            achievements[ach_id] = {
                                'displayName': display_name,
                                'description': description,
                                'hidden': bool(hidden)
                            }

                self.log_debug(f"Schema achievements récupérés: {len(achievements)}")
                return achievements

        except Exception as e:
            print(f"❌ Erreur API Schema: {e}")
        return {}

    def get_best_achievements_with_key(self, app_id, api_key):
        """MÉTHODE PREMIUM - Combine Schema + Percentages avec clé API"""
        # Récupère les noms via Schema API
        schema_data = self.get_achievement_names_with_key(app_id, api_key)

        # Récupère les pourcentages via Percentages API
        percentages_data = self.get_achievement_names_no_key(app_id)

        # Combine les données
        combined = {}
        for ach_id, perc_info in percentages_data.items():
            display_name = ach_id
            description = ""

            if ach_id in schema_data:
                display_name = schema_data[ach_id]['displayName'] or ach_id
                description = schema_data[ach_id]['description']
            elif self.fallback_beautify:
                display_name = self.beautify_achievement_name(ach_id)

            combined[ach_id] = {
                'displayName': display_name,
                'description': description,
                'percentage': perc_info['percentage'],
                'source': 'PREMIUM'
            }

        self.log_debug(f"Combined premium data: {len(combined)} achievements")

        if self.sort_by_percentage:
            combined = dict(sorted(combined.items(), key=lambda x: x[1]['percentage'], reverse=True))

        return combined

    def get_best_achievements_no_key(self, app_id):
        """MÉTHODE GRATUITE - Combine Percentages + Store + Beautifier"""
        # Récupère les pourcentages
        percentages_data = self.get_achievement_names_no_key(app_id)

        # Récupère les noms via Store (fallback)
        store_names = self.get_store_page_achievements(app_id)

        # Combine intelligemment
        combined = {}
        for ach_id, perc_info in percentages_data.items():
            display_name = ach_id

            # Matching intelligent avec store names
            best_match = self.find_best_store_match(ach_id, store_names)
            if best_match:
                display_name = best_match
            elif self.fallback_beautify:
                display_name = self.beautify_achievement_name(ach_id)

            combined[ach_id] = {
                'displayName': display_name,
                'description': '',
                'percentage': perc_info['percentage'],
                'source': 'GRATUIT'
            }

        self.log_debug(f"Combined gratuit data: {len(combined)} achievements")

        if self.sort_by_percentage:
            combined = dict(sorted(combined.items(), key=lambda x: x[1]['percentage'], reverse=True))

        return combined

    def find_best_store_match(self, ach_id, store_names):
        """Matching intelligent entre achievement ID et noms du store"""
        if not store_names:
            return None

        ach_clean = ach_id.lower().replace('ach_', '').replace('achievement_', '')

        for store_name in store_names.keys():
            store_clean = store_name.lower().replace(' ', '').replace('_', '')
            if ach_clean in store_clean or store_clean in ach_clean:
                return store_name

        return None

    def beautify_achievement_name(self, ach_id):
        """Fallback intelligent pour beautifier les noms"""
        import re
        name = ach_id.replace('ACH_', '').replace('ACHIEVEMENT_', '')
        name = re.sub(r'([a-z])([A-Z])', r'\1 \2', name)
        return name.title()

    def get_best_achievements_auto(self, app_id, api_key=None):
        """MÉTHODE PRINCIPALE - S'adapte automatiquement selon la clé API"""
        final_api_key = api_key or self.steam_api_key

        if final_api_key:
            if self.verbose:
                print("🔑 CLÉ API DÉTECTÉE - Mode COMPLET activé")
            return self.get_best_achievements_with_key(app_id, final_api_key)
        else:
            if self.verbose:
                print("🆓 SANS CLÉ API - Mode GRATUIT activé")
            return self.get_best_achievements_no_key(app_id)


# ==================== TESTS ====================
if __name__ == "__main__":
    # Initialisation avec config
    test_ach = AchievementParser()

    # Le reste de tes tests
    test = game_detector.GameDetector()
    test.scan_all_locations()
    test.get_all_games_names()

    for elem in test.games_id:
        game_path = test.games_sources[elem]['path']
        test_ach.check_achievements_file(game_path, elem)

    print("Fichiers achievements trouvés:", test_ach.achievement_files)

    print("\n=== TEST AUTO-ADAPTATIF AVEC CONFIG ===")
    achievements = test_ach.get_best_achievements_auto('250900')

    for k, v in achievements.items():
        quality_icon = "🔑" if v['source'] == 'PREMIUM' else "🆓"
        print(f"{quality_icon} {k}: {v['displayName']} ({v['percentage']}%)")
