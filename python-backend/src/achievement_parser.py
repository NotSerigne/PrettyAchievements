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

    def check_achievements_file(self, game_path, app_id):
        """Check for local achievement files with caching"""
        cache_key = f"{app_id}_local_check"

        # Check cache for local achievement file info
        cached_info = self.cache_manager.get_cache("local_achievements", cache_key)
        if cached_info:
            if cached_info.get("file_exists") and cached_info.get("file_path"):
                self.achievement_files[app_id] = cached_info["file_path"]
            return cached_info.get("file_exists", False)

        # Search for achievement files
        achievement_files = ['stats.ini', 'achievements.ini', 'steam_emu.ini']
        found_file = None

        try:
            for root, dirs, files in os.walk(game_path):
                for achievement_file in achievement_files:
                    if achievement_file in files:
                        found_file = os.path.join(root, achievement_file)
                        break
                if found_file:
                    break
        except OSError as e:
            self.log_debug(f"Error scanning achievement files in {game_path}: {e}")

        # Cache the result
        cache_data = {
            "file_exists": found_file is not None,
            "file_path": found_file,
            "scan_time": time.time()
        }

        self.cache_manager.set_cache("local_achievements", cache_key, cache_data, ttl=3600)  # 1 hour

        if found_file:
            self.achievement_files[app_id] = found_file
            self.log_debug(f"Found achievement file for {app_id}: {found_file}")
            return True

        return False

    def parse_achievement_file(self, file_path):
        """Parse local achievement file"""
        achievements = {}

        try:
            config = configparser.ConfigParser()
            config.read(file_path, encoding='utf-8')

            for section in config.sections():
                if 'achievement' in section.lower():
                    for key in config[section]:
                        if key.startswith('ach_') or 'achievement' in key.lower():
                            achievements[key] = config[section][key]

        except (configparser.Error, OSError, UnicodeDecodeError) as e:
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


# TESTS DÉTAILLÉS
if __name__ == "__main__":
    import time

    # Initialize with configuration
    test_achievement_parser = AchievementParser()

    # Show cache stats
    print("\n=== CACHE STATISTICS (INITIAL) ===")
    stats = test_achievement_parser.get_cache_stats()
    if stats["enabled"]:
        print(f"Cache enabled: {stats['total_files']} files, {stats['total_size_mb']} MB")
        for cache_type, type_stats in stats["by_type"].items():
            if type_stats["files"] > 0:
                print(f"  {cache_type}: {type_stats['files']} files, {type_stats['size_mb']} MB")
    else:
        print("Cache disabled")

    # Initialize game detector for testing
    test_game_detector = game_detector.GameDetector()
    test_game_detector.scan_all_locations()
    test_game_detector.get_all_games_names()

    # Check for achievement files in detected games
    for game_id in test_game_detector.games_id:
        game_path = test_game_detector.games_sources[game_id]['path']
        test_achievement_parser.check_achievements_file(game_path, game_id)

    print("Achievement files found:", test_achievement_parser.achievement_files)

    print("\n=== DETAILED ACHIEVEMENT TEST ===")
    test_app_id = '250900'  # The Binding of Isaac: Rebirth

    # Force verbose mode for this test
    original_verbose = test_achievement_parser.verbose
    test_achievement_parser.verbose = True
    test_achievement_parser.show_api_calls = True

    print(f"\n--- Testing App ID: {test_app_id} ---")
    print(f"API Key available: {'YES' if test_achievement_parser.steam_api_key else 'NO'}")
    print(f"Local file available: {'YES' if test_app_id in test_achievement_parser.achievement_files else 'NO'}")

    if test_app_id in test_achievement_parser.achievement_files:
        print(f"Local file path: {test_achievement_parser.achievement_files[test_app_id]}")

        # Test local file parsing
        local_achievements = test_achievement_parser.parse_achievement_file(
            test_achievement_parser.achievement_files[test_app_id]
        )
        print(f"Local achievements found: {len(local_achievements)}")
        if local_achievements:
            print("Sample local achievements:")
            for i, (key, value) in enumerate(local_achievements.items()):
                if i >= 3:  # Show first 3
                    break
                print(f"  {key}: {value}")

    # First call - will cache
    print(f"\n--- FIRST CALL (should fetch and cache) ---")
    start_time = time.time()
    achievements_1 = test_achievement_parser.get_best_achievements_auto(test_app_id)
    time_1 = time.time() - start_time

    # Second call - should use cache
    print(f"\n--- SECOND CALL (should use cache) ---")
    start_time = time.time()
    achievements_2 = test_achievement_parser.get_best_achievements_auto(test_app_id)
    time_2 = time.time() - start_time

    print(f"\n--- PERFORMANCE RESULTS ---")
    print(f"First call: {time_1:.3f}s ({len(achievements_1)} achievements)")
    print(f"Second call: {time_2:.3f}s ({len(achievements_2)} achievements)")
    if time_2 > 0:
        print(f"Speed improvement: {time_1 / time_2:.1f}x faster")

    # Show achievements details
    print(f"\n--- ACHIEVEMENTS DETAILS ---")
    if achievements_2:
        print(f"Total achievements: {len(achievements_2)}")
        print("Sample achievements:")
        for i, (achievement_key, achievement_value) in enumerate(achievements_2.items()):
            if i >= 5:  # Show first 5
                break
            source_icon = "🔑" if achievement_value['source'] in ['STEAM_API', 'LOCAL_COMBINED'] else "🆓"
            print(
                f"  {source_icon} {achievement_key}: {achievement_value['displayName']} ({achievement_value['percentage']}%) - Source: {achievement_value['source']}")
    else:
        print("❌ NO achievements found - investigating...")

        # Manual investigation
        print("\n--- MANUAL INVESTIGATION ---")

        # Test gratuit method directly
        gratuit_achievements = test_achievement_parser.get_gratuit_achievements(test_app_id)
        print(f"Gratuit method result: {len(gratuit_achievements)} achievements")

        if not gratuit_achievements and test_app_id in test_achievement_parser.achievement_files:
            print("Trying to parse local file manually...")
            try:
                local_file_path = test_achievement_parser.achievement_files[test_app_id]
                with open(local_file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    print(f"File content preview (first 500 chars):")
                    print(content[:500])
                    print("...")
            except Exception as e:
                print(f"Error reading local file: {e}")

    # Cache stats after test
    print(f"\n=== CACHE STATISTICS (AFTER TEST) ===")
    stats_after = test_achievement_parser.get_cache_stats()
    if stats_after["enabled"]:
        print(f"Cache now: {stats_after['total_files']} files, {stats_after['total_size_mb']} MB")
        for cache_type, type_stats in stats_after["by_type"].items():
            if type_stats["files"] > 0:
                print(f"  {cache_type}: {type_stats['files']} files, {type_stats['size_mb']} MB")

    # Restore original verbose setting
    test_achievement_parser.verbose = original_verbose
