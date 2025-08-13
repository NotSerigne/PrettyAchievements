# main.py
from flask import Flask, jsonify, request
from flask_cors import CORS
import sys
import os




# Add src directory to path
sys.path.append(os.path.join(os.path.dirname(__file__), 'src'))

from achievement_parser import AchievementParser
from game_detector import GameDetector

app = Flask(__name__)
CORS(app)  # Enable CORS for Electron frontend

# Initialize components
achievement_parser = AchievementParser()
game_detector = GameDetector()



@app.route('/api/games', methods=['GET'])
def get_games():
    """
    GET /api/games
    Retourne la liste des jeux détectés
    """
    try:
        # ✅ UTILISE LES BONNES MÉTHODES !
        game_detector.scan_all_locations()  # 1. Scan les jeux
        game_detector.get_all_games_names()  # 2. Récupère les noms

        game_list = []

        # ✅ UTILISE games_sources qui contient tout !
        for app_id, game_info in game_detector.games_sources.items():
            # Recherche du nombre d'achievements obtenus
            local_achievements_count = achievement_parser.get_local_achievements_count(app_id)
            # Récupère le nombre total d'achievements obtenables (même logique que test ligne 500+)
            achievements = achievement_parser.get_best_achievements_auto(app_id)
            total_obtenable_achievements = len(achievements) if achievements else 0
            game_data = {
                'app_id': app_id,
                'name': game_info.get('name', f"Game {app_id}"),
                'path': game_info.get('path', ''),
                'team': game_info.get('team', 'Unknown'),
                'location': game_info.get('location', ''),
                'local_achievements_count': local_achievements_count,
                'total_obtenable_achievements': total_obtenable_achievements,
                'has_api_data': False
            }
            game_list.append(game_data)

        return jsonify({
            'success': True,
            'games': game_list,
            'total_games': len(game_list)
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/games/<app_id>/achievements', methods=['GET'])
def get_game_achievements(app_id):
    """
    GET /api/games/{app_id}/achievements
    Retourne tous les succès d'un jeu avec leur statut
    """
    try:
        # Get parameters
        include_unlocked = request.args.get('unlocked', 'true').lower() == 'true'
        include_locked = request.args.get('locked', 'true').lower() == 'true'
        sort_by = request.args.get('sort', 'percentage')  # percentage, name, unlocked
        limit = request.args.get('limit', type=int)

        # Get achievements data
        achievements = achievement_parser.get_best_achievements_auto(app_id)

        if not achievements:
            return jsonify({
                'success': False,
                'error': f'No achievements found for game {app_id}'
            }), 404

        # Get local progress if available
        local_progress = {}
        if app_id in achievement_parser.achievement_files:
            file_path = achievement_parser.achievement_files[app_id]
            local_achievements = achievement_parser.parse_achievement_file(file_path)
            local_progress = {ach['name']: ach for ach in local_achievements}

        # Format achievements for frontend
        formatted_achievements = []

        for ach_key, ach_data in achievements.items():
            # Check if unlocked locally
            is_unlocked = ach_key in local_progress
            unlock_time = local_progress.get(ach_key, {}).get('unlocked_time', None)

            # Filter based on parameters
            if not include_unlocked and is_unlocked:
                continue
            if not include_locked and not is_unlocked:
                continue

            formatted_ach = {
                'key': ach_key,
                'name': ach_data.get('displayName', ach_key),
                'description': ach_data.get('description', 'No description'),
                'percentage': ach_data.get('percentage', 0),
                'icon': ach_data.get('icon', ''),
                'icon_gray': ach_data.get('icongray', ''),
                'unlocked': is_unlocked,
                'unlock_time': unlock_time,
                'rarity': get_rarity_level(ach_data.get('percentage', 0)),
                'source': ach_data.get('source', 'UNKNOWN')
            }
            formatted_achievements.append(formatted_ach)

        # Sort achievements
        if sort_by == 'percentage':
            formatted_achievements.sort(key=lambda x: x['percentage'])
        elif sort_by == 'name':
            formatted_achievements.sort(key=lambda x: x['name'])
        elif sort_by == 'unlocked':
            formatted_achievements.sort(key=lambda x: (not x['unlocked'], x['name']))

        # Apply limit
        if limit:
            formatted_achievements = formatted_achievements[:limit]

        # Calculate stats
        total_achievements = len(achievements)
        unlocked_count = len([ach for ach in formatted_achievements if ach['unlocked']])

        return jsonify({
            'success': True,
            'app_id': app_id,
            'achievements': formatted_achievements,
            'stats': {
                'total': total_achievements,
                'unlocked': unlocked_count,
                'locked': total_achievements - unlocked_count,
                'completion_percentage': round((unlocked_count / total_achievements) * 100,
                                               1) if total_achievements > 0 else 0
            }
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/games/<app_id>/stats', methods=['GET'])
def get_game_stats(app_id):
    """
    GET /api/games/{app_id}/stats
    Retourne les statistiques d'un jeu
    """
    try:
        # Scan les jeux et leurs fichiers d'achievements
        game_detector.scan_all_locations()
        game_detector.get_all_games_names()
        for detected_app_id, game_info in game_detector.games_sources.items():
            game_path = game_info.get('path', '')
            if game_path:
                achievement_parser.check_achievements_file(game_path, detected_app_id)

        achievements = achievement_parser.get_best_achievements_auto(app_id)
        if not achievements:
            return jsonify({
                'success': False,
                'error': f'No data found for game {app_id}'
            }), 404

        unlocked_count = achievement_parser.get_local_achievements_count(app_id)
        total_achievements = len(achievements)

        app_id_str = str(app_id)
        completed_achievements = {}
        if app_id_str in achievement_parser.achievement_files:
            file_path = achievement_parser.achievement_files[app_id_str]
            completed_achievements = achievement_parser.parse_achievement_file(file_path)

        rarity_stats = {'common': 0, 'uncommon': 0, 'rare': 0, 'very_rare': 0, 'ultra_rare': 0}
        unlocked_rarity_stats = {'common': 0, 'uncommon': 0, 'rare': 0, 'very_rare': 0, 'ultra_rare': 0}
        for ach_key, ach_data in achievements.items():
            percentage = ach_data.get('percentage', 0)
            rarity = achievement_parser.get_rarity_level(percentage)
            rarity_stats[rarity] += 1
            # unlocked_rarity_breakdown laissé inchangé pour l'instant

        return jsonify({
            'success': True,
            'app_id': app_id,
            'stats': {
                'total_achievements': total_achievements,
                'unlocked_achievements': unlocked_count,
                'locked_achievements': total_achievements - unlocked_count,
                'completion_percentage': round((unlocked_count / total_achievements) * 100, 1) if total_achievements > 0 else 0,
                'rarity_breakdown': rarity_stats,
                'unlocked_rarity_breakdown': unlocked_rarity_stats,
                'completed_achievements': completed_achievements
            }
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/system/cache', methods=['GET'])
def get_cache_stats():
    """
    GET /api/system/cache
    Retourne les statistiques du cache
    """
    try:
        stats = achievement_parser.cache_manager.get_cache_stats()
        return jsonify({
            'success': True,
            'cache': stats
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/system/cache', methods=['DELETE'])
def clear_cache():
    """
    DELETE /api/system/cache
    Vide le cache
    """
    try:
        achievement_parser.cache_manager.clear_cache()
        return jsonify({
            'success': True,
            'message': 'Cache cleared successfully'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


def get_rarity_level(percentage):
    """Helper function to determine rarity based on unlock percentage"""
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


if __name__ == '__main__':
    print("🚀 Starting Achievement Tracker API...")
    print("📋 Available endpoints:")
    print("   GET  /api/games                     - List all detected games")
    print("   GET  /api/games/{id}/achievements   - Get achievements for a game")
    print("   GET  /api/games/{id}/stats          - Get statistics for a game")
    print("   GET  /api/system/cache              - Get cache statistics")
    print("   DELETE /api/system/cache            - Clear cache")
    print("\n🌐 Server running on http://localhost:5000")

    app.run(debug=True, host='localhost', port=5000)
