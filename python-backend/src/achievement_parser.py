import os
import configparser
import game_detector
import requests
import json
from bs4 import BeautifulSoup
from config_manager import ConfigManager
from cache_manager import CacheManager


class AchievementParser:
    def __init__(self, config_file=None):
        self.achievement_files = {}

        if config_file is None:
            config_file = os.path.join(os.path.dirname(__file__), "..", "..", "config.json")

        # Initialize configuration manager
        self.config_manager = ConfigManager(config_file)

        # Initialize cache manager
        self.cache_manager = CacheManager(self.config_manager)

        # Load Steam API configuration
        steam_api_config = self.config_manager.get("steam_api", {})
        self.steam_api_key = steam_api_config.get("api_key")
        self.language = steam_api_config.get("default_language", "fr")
        self.timeout = steam_api_config.get("timeout", 10)
        self.max_retries = steam_api_config.get("max_retries", 3)

        # Load achievements configuration
        achievements_config = self.config_manager.get("achievements", {})
        self.fallback_beautify = achievements_config.get("fallback_beautify", True)
        self.show_hidden = achievements_config.get("show_hidden", True)
        self.sort_by_percentage = achievements_config.get("sort_by_percentage", True)

        # Load debug configuration
        debug_config = self.config_manager.get("debug", {})
        self.verbose = debug_config.get("verbose_mode", False)
        self.show_api_calls = debug_config.get("show_api_calls", False)

        # Cleanup expired cache on startup if configured
        cache_config = self.config_manager.get("cache", {})
        if cache_config.get("cleanup_on_start", True):
            expired_count = self.cache_manager.cleanup_expired()
            if expired_count > 0 and self.verbose:
                print(f"Cleaned up {expired_count} expired cache entries on startup")

        if self.verbose:
            print(f"Configuration loaded - API Key: {'Available' if self.steam_api_key else 'Not configured'}")
            cache_stats = self.cache_manager.get_cache_stats()
            if cache_stats["enabled"]:
                print(f"Cache: {cache_stats['total_files']} files, {cache_stats['total_size_mb']} MB")

    def log_debug(self, message):
        """Log debug information if verbose mode is enabled"""
        if self.verbose:
            print(f"DEBUG: {message}")

    def make_steam_request(self, url, params):
        """Make HTTP request to Steam API with retry logic and caching"""
        # Generate cache key from URL and params
        cache_key = f"{url}?{'&'.join([f'{k}={v}' for k, v in params.items()])}"
        cache_key_hash = str(hash(cache_key))

        # Try to get from cache first
        cached_data = self.cache_manager.get_cache("steam_store", cache_key_hash)
        if cached_data:
            self.log_debug(f"Cache HIT for Steam request: {url}")
            return cached_data

        self.log_debug(f"Cache MISS for Steam request: {url}")

        # Make actual HTTP request
        for attempt in range(self.max_retries):
            try:
                if self.show_api_calls:
                    print(f"API Call [{attempt + 1}/{self.max_retries}]: {url}")

                response = requests.get(url, params=params, timeout=self.timeout)
                response.raise_for_status()

                data = response.json()

                # Cache successful response (TTL: 1 hour for API calls)
                self.cache_manager.set_cache("steam_store", cache_key_hash, data, ttl=3600)

                return data

            except requests.RequestException as e:
                self.log_debug(f"Request attempt {attempt + 1} failed: {e}")
                if attempt == self.max_retries - 1:
                    return None

        return None

    def get_steam_achievements_with_key(self, app_id, api_key):
        """Fetch achievements from Steam API with caching"""
        # Check cache first
        cached_achievements = self.cache_manager.get_cache("achievements", f"{app_id}_steam")
        if cached_achievements:
            self.log_debug(f"Loading Steam achievements for {app_id} from cache")
            return cached_achievements

        self.log_debug(f"Fetching Steam achievements for {app_id} from API")

        url = "http://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v0002/"
        params = {
            'appid': app_id,
            'key': api_key,
            'l': self.language
        }

        data = self.make_steam_request(url, params)
        if not data or 'game' not in data:
            return {}

        achievements_data = {}
        for ach in data['game'].get('availableGameStats', {}).get('achievements', []):
            achievements_data[ach['name']] = {
                'displayName': ach.get('displayName', ach['name']),
                'description': ach.get('description', ''),
                'hidden': ach.get('hidden', 0),
                'icon': ach.get('icon', ''),
                'icongray': ach.get('icongray', ''),
                'percentage': 0,
                'source': 'STEAM_API'
            }

        # Get achievement percentages
        perc_url = "http://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/"
        perc_params = {'gameid': app_id}

        perc_data = self.make_steam_request(perc_url, perc_params)
        if perc_data and 'achievementpercentages' in perc_data:
            for ach in perc_data['achievementpercentages'].get('achievements', []):
                ach_name = ach['name']
                if ach_name in achievements_data:
                    achievements_data[ach_name]['percentage'] = round(float(ach['percent']), 2)

        # Cache achievements data (TTL: 24 hours)
        self.cache_manager.set_cache("achievements", f"{app_id}_steam", achievements_data, ttl=86400)

        self.log_debug(f"Fetched and cached {len(achievements_data)} Steam achievements for {app_id}")
        return achievements_data

    def get_gratuit_achievements(self, app_id):
        """Get achievements from gratuit sources with caching"""
        # Check cache first
        cached_achievements = self.cache_manager.get_cache("achievements", f"{app_id}_gratuit")
        if cached_achievements:
            self.log_debug(f"Loading gratuit achievements for {app_id} from cache")
            return cached_achievements

        self.log_debug(f"Fetching gratuit achievements for {app_id}")

        combined = {}

        # Try SteamDB API (free alternative)
        try:
            steamdb_url = f"https://steamdb.info/app/{app_id}/stats/"
            response = requests.get(steamdb_url, timeout=self.timeout)
            if response.status_code == 200:
                soup = BeautifulSoup(response.content, 'html.parser')

                # Parse achievement data from HTML
                achievement_rows = soup.find_all('tr', class_='app')
                for row in achievement_rows:
                    name_cell = row.find('td', class_='span6')
                    perc_cell = row.find('td', class_='span2')

                    if name_cell and perc_cell:
                        ach_name = name_cell.get('data-sort', '').strip()
                        percentage_text = perc_cell.text.strip()

                        try:
                            percentage = float(percentage_text.replace('%', ''))
                        except (ValueError, AttributeError):
                            percentage = 0.0

                        if ach_name:
                            display_name = name_cell.text.strip() or self.beautify_achievement_name(ach_name)
                            combined[ach_name] = {
                                'displayName': display_name,
                                'description': '',
                                'hidden': 0,
                                'icon': '',
                                'icongray': '',
                                'percentage': percentage,
                                'source': 'STEAMDB'
                            }

                self.log_debug(f"SteamDB: Found {len(combined)} achievements")

        except requests.RequestException as e:
            self.log_debug(f"SteamDB request failed: {e}")

        # Fallback: Check local achievement file
        if app_id in self.achievement_files:
            local_achievements = self.parse_achievement_file(self.achievement_files[app_id])

            for ach_id in local_achievements:
                if ach_id not in combined:
                    combined[ach_id] = {
                        'displayName': self.beautify_achievement_name(ach_id) if self.fallback_beautify else ach_id,
                        'description': '',
                        'hidden': 0,
                        'icon': '',
                        'icongray': '',
                        'percentage': 0.0,
                        'source': 'LOCAL_FILE'
                    }

            self.log_debug(f"Local file: Added {len(local_achievements)} achievements")

        # Sort by percentage if configured
        if self.sort_by_percentage and combined:
            combined = dict(sorted(combined.items(), key=lambda x: x[1]['percentage'], reverse=True))

        # Cache gratuit achievements (TTL: 6 hours, less than premium)
        self.cache_manager.set_cache("achievements", f"{app_id}_gratuit", combined, ttl=21600)

        self.log_debug(f"Fetched and cached {len(combined)} gratuit achievements for {app_id}")
        return combined

    def check_achievements_file(self, game_path, game_id):
        """
        Check if achievement file exists for a game and register it in self.achievement_files
        Supports both achievements.ini and achievements.json files

        Args:
            game_path (str): Path to the game directory
            game_id (str): Game ID (app_id)

        Returns:
            bool: True if achievement file found and registered, False otherwise
        """
        if not game_path or not os.path.exists(game_path):
            if self.verbose:
                print(f"Game path does not exist: {game_path}")
            return False

        game_id_str = str(game_id)
        possible_files = ['achievements.ini', 'achievements.json']

        for filename in possible_files:
            file_path = os.path.join(game_path, filename)
            if os.path.exists(file_path):
                # Vérifier que le fichier n'est pas vide et est lisible
                try:
                    if os.path.getsize(file_path) == 0:
                        if self.verbose:
                            print(f"Achievement file is empty: {file_path}")
                        continue

                    # Test de lecture rapide pour vérifier que le fichier est valide
                    if filename.endswith('.json'):
                        with open(file_path, 'r', encoding='utf-8') as f:
                            json.load(f)  # Test parsing JSON
                    elif filename.endswith('.ini'):
                        config = configparser.ConfigParser()
                        config.read(file_path, encoding='utf-8')
                        # Vérifier qu'il y a au moins une section
                        if not config.sections():
                            if self.verbose:
                                print(f"INI file has no sections: {file_path}")
                            continue

                    # Si on arrive ici, le fichier est valide
                    self.achievement_files[game_id_str] = file_path
                    if self.verbose:
                        print(f"✅ Found valid achievement file for {game_id}: {file_path}")
                    return True

                except (json.JSONDecodeError, configparser.Error, UnicodeDecodeError, OSError) as e:
                    if self.verbose:
                        print(f"❌ Invalid achievement file {file_path}: {e}")
                    continue

        if self.verbose:
            print(f"❌ No valid achievement files found for {game_id} in {game_path}")
        return False

    def parse_achievement_file(self, file_path):
        """Parse local achievement file (supports .json and .ini, et sections numériques)"""
        achievements = {}
        try:
            if file_path.endswith('.json'):
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                for ach_id, ach_data in data.items():
                    # On ignore les achievements non complétés
                    if not ach_data.get('earned', False):
                        continue
                    achievements[ach_id] = {
                        'earned': True,
                        'earned_time': ach_data.get('earned_time', 0)
                    }
            elif file_path.endswith('.ini'):
                config = configparser.ConfigParser()
                config.read(file_path, encoding='utf-8')
                for section in config.sections():
                    if section == 'SteamAchievements':
                        continue  # On ignore la section globale
                    # Si la section est un nombre, on considère que c'est un achievement
                    if section.isdigit() or section.lower().startswith('ach') or 'achievement' in section.lower():
                        achieved = config[section].get('Achieved')
                        unlock_time = config[section].get('UnlockTime', 0)
                        if achieved is not None:
                            achievements[section] = {
                                'earned': achieved == '1',
                                'earned_time': int(unlock_time)
                            }
        except (configparser.Error, OSError, UnicodeDecodeError, json.JSONDecodeError) as e:
            self.log_debug(f"Error parsing achievement file {file_path}: {e}")
        return achievements

    def get_best_achievements_with_key(self, app_id, api_key):
        """Get premium achievements using Steam API key"""
        steam_achievements = self.get_steam_achievements_with_key(app_id, api_key)

        # Combine with local achievements if available
        if app_id in self.achievement_files:
            local_achievements = self.parse_achievement_file(self.achievement_files[app_id])

            for local_ach in local_achievements:
                if local_ach not in steam_achievements:
                    steam_achievements[local_ach] = {
                        'displayName': self.beautify_achievement_name(
                            local_ach) if self.fallback_beautify else local_ach,
                        'description': '',
                        'hidden': 0,
                        'icon': '',
                        'icongray': '',
                        'percentage': 0,
                        'source': 'LOCAL_COMBINED'
                    }

        if self.sort_by_percentage:
            steam_achievements = dict(
                sorted(steam_achievements.items(), key=lambda x: x[1]['percentage'], reverse=True))

        return steam_achievements

    def get_best_achievements_no_key(self, app_id):
        """Get achievements without Steam API key (gratuit mode)"""
        return self.get_gratuit_achievements(app_id)

    def find_best_store_match(self, ach_id, store_names):
        """Intelligent matching between achievement ID and store names"""
        if not store_names:
            return None

        ach_clean = ach_id.lower().replace('ach_', '').replace('achievement_', '')

        for store_name in store_names.keys():
            store_clean = store_name.lower().replace(' ', '').replace('_', '')
            if ach_clean in store_clean or store_clean in ach_clean:
                return store_name

        return None

    def beautify_achievement_name(self, ach_id):
        """Intelligent fallback for beautifying names"""
        import re
        name = ach_id.replace('ACH_', '').replace('ACHIEVEMENT_', '')
        name = re.sub(r'([a-z])([A-Z])', r'\1 \2', name)
        return name.title()

    def get_best_achievements_auto(self, app_id, api_key=None):
        """Main method - auto-adapts based on API key availability"""
        final_api_key = api_key or self.steam_api_key

        if final_api_key:
            if self.verbose:
                print("Using Steam API key - Premium mode enabled")
            return self.get_best_achievements_with_key(app_id, final_api_key)
        else:
            if self.verbose:
                print("No API key - Free mode enabled")
            return self.get_best_achievements_no_key(app_id)

    def clear_cache(self, cache_type=None):
        """Clear cache entries"""
        if cache_type:
            return self.cache_manager.clear_cache_type(cache_type)
        else:
            # Clear all achievement-related caches
            total_cleared = 0
            for cache_type in ["achievements", "local_achievements", "steam_store"]:
                total_cleared += self.cache_manager.clear_cache_type(cache_type)
            return total_cleared

    def get_cache_stats(self):
        """Get cache statistics"""
        return self.cache_manager.get_cache_stats()

    def get_obtained_achievements_count(self, ini_path):
        """Récupère le nombre d'achievements obtenus depuis un fichier achievements.ini"""
        if not os.path.exists(ini_path):
            if self.verbose:
                print(f"Fichier non trouvé : {ini_path}")
            return None
        config = configparser.ConfigParser()
        try:
            config.read(ini_path, encoding='utf-8')
            if 'SteamAchievements' in config:
                count_str = config['SteamAchievements'].get('Count')
                if count_str is not None:
                    try:
                        return int(count_str)
                    except ValueError:
                        if self.verbose:
                            print(f"Valeur Count invalide dans {ini_path} : {count_str}")
                        return None
            if self.verbose:
                print(f"Section [SteamAchievements] ou clé Count absente dans {ini_path}")
        except Exception as e:
            if self.verbose:
                print(f"Erreur lecture INI {ini_path} : {e}")
        return None

    def get_local_achievements_count(self, app_id):
        """
        Récupère le nombre d'achievements obtenus à partir du fichier achievements.ini
        en utilisant les chemins connus de la config.
        TODO : Gerer les achievements.json
        """
        import configparser
        import re
        import os

        config = self.config_manager
        known_locations = config.known_locations if hasattr(config, 'known_locations') else config.get('known_locations', {})
        possible_files = []
        for loc in known_locations.values():
            base_path = os.path.expanduser(loc['base_path'])
            for team in loc['teams']:
                for fname in ["achievements.ini"]:
                    candidate = os.path.join(base_path, team, app_id, fname)
                    if os.path.exists(candidate):
                        possible_files.append(candidate)
        if not possible_files:
            return 0
        ini_path = possible_files[0]
        parser = configparser.ConfigParser()
        parser.read(ini_path, encoding="utf-8")
        if 'SteamAchievements' in parser:
            count = parser['SteamAchievements'].get('Count')
            if count and re.match(r"^\d+$", count):
                return int(count)
        return 0

    @staticmethod
    def get_rarity_level(percentage):
        """Détermine la rareté d'un achievement selon son pourcentage de déblocage"""
        if percentage >= 50:
            return 'common'
        elif percentage >= 25:
            return 'uncommon'
        elif percentage >= 10:
            return 'rare'
        elif percentage >= 5:
            return 'very_rare'
        else:
            return 'ultra_rare'

    def get_local_achievements_rarity_breakdown(self, app_id):
        """
        Retourne un dictionnaire avec le nombre d'achievements obtenus par rareté pour un jeu donné.
        Exemple de retour : {'common': 2, 'uncommon': 1, ...}
        """
        rarity_stats = {'common': 0, 'uncommon': 0, 'rare': 0, 'very_rare': 0, 'ultra_rare': 0}
        achievements = self.get_best_achievements_auto(app_id)
        if not achievements:
            return rarity_stats
        # Récupère les clés des achievements obtenus localement (non normalisées, car dans achievements.ini ce sont souvent des IDs numériques)
        local_keys = set()
        if app_id in self.achievement_files:
            file_path = self.achievement_files[app_id]
            local_achievements = self.parse_achievement_file(file_path)
            if not local_achievements:
                # Si le parsing n'a rien donné, essaye de lire la section [SteamAchievements] (cas des fichiers achievements.ini)
                config = configparser.ConfigParser()
                config.read(file_path, encoding='utf-8')
                if 'SteamAchievements' in config:
                    for key in config['SteamAchievements']:
                        if key.isdigit():
                            local_keys.add(key)
            else:
                local_keys = set(local_achievements.keys())
            print("DEBUG: Local achievements found:", local_keys)
        # Compte la rareté pour chaque succès obtenu
        for ach_key, ach_data in achievements.items():
            if ach_key in local_keys:
                percentage = ach_data.get('percentage', 0)
                rarity = self.get_rarity_level(percentage)
                rarity_stats[rarity] += 1
        return rarity_stats

