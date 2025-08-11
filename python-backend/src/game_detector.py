import os
import requests
import json

from pywin.scintilla.config import ConfigManager

import config_manager


class GameDetector:
    def __init__(self):
        """Initialise le scanner avec la config du fichier JSON"""

        self.config_manager = config_manager.ConfigManager()
        self.known_locations = self.config_manager.known_locations

        self.games_id = []
        self.games = {}
        self.games_sources = {}

        #print(f"🔧 GameDetector initialisé avec {len(self.known_locations)} emplacements")

    def scan_all_locations(self):
        """Scanne tous les emplacements connus pour trouver des jeux"""
        #print(f"🔍 Scan de {len(self.known_locations)} emplacements...")

        for location_name, config in self.known_locations.items():
            #print(f"\n Scanning {location_name}")
            base_path = os.path.expanduser(config["base_path"])  # Gère les ~ automatiquement

            if not os.path.exists(base_path):
                #print(f"     Base path doesn't exist: {base_path}")
                continue

            for team in config["teams"]:
                team_path = os.path.join(base_path, team)
                #print(f"    🔍 Scan de : {team}")
                self._scan_team_folder(team_path, team, location_name)

    def _scan_team_folder(self, team_path, team_name, location_name):
        """Scanne un dossier d'équipe pour trouver des jeux"""
        if os.path.exists(team_path):
            #print(f"       Found: {team_path}")
            for item in os.listdir(team_path):
                if self._is_valid_game_id(item):
                    if item not in self.games_id:
                        self.games_id.append(item)
                        self.games_sources[item] = {
                            'name': self.get_game_name(item),
                            'path': os.path.join(team_path, item),
                            'team': team_name,
                            'location': location_name
                        }
                        #print(f"        🎮 Game found -> {item} : {self.get_game_name(item)} ({team_name})")
        else:
            #print(f"      ❌ Team folder doesn't exist: {team_path}")
            return

    def _is_valid_game_id(self, folder_name):
        """Vérifie si un nom de dossier est un ID de jeu valide"""
        return folder_name.isdigit()

    def get_game_name(self, app_id):
        """Récupère le nom d'un jeu Steam à partir de son ID"""
        url = f"https://store.steampowered.com/api/appdetails?appids={app_id}"

        try:
            response = requests.get(url)
            response.raise_for_status()
            data = response.json()

            if str(app_id) in data and data[str(app_id)]['success']:
                game_data = data[str(app_id)]['data']
                self.games[app_id] = game_data['name']
                return game_data['name']
            else:
                return f"Game with id {app_id} not found"

        except requests.RequestException as e:
            return f"Error : {e}"

    def get_all_games_names(self):
        """Récupère les noms de tous les jeux dans la liste des ID"""
        for game_id in self.games_id:
            self.get_game_name(game_id)


# ==================== TESTS ====================
if __name__ == "__main__":
    test = GameDetector()

    test.config_manager.add_location("custom_location", "D:/MyGames", ["FITGIRL", "DODI"])

    test.scan_all_locations()

    print("\n📋 Liste des IDs trouvés :")
    print(test.games_id)

    test.get_all_games_names()
    print("\n Games :", test.games)
    print("\n Sources :", test.games_sources)


