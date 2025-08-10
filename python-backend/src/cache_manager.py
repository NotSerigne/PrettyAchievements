import json
import os
import time
from pathlib import Path
from typing import Optional, Dict, Any


class CacheManager:
    def __init__(self, config_manager):
        self.config_manager = config_manager

        # Load cache configuration
        cache_config = self.config_manager.get("cache", {})
        self.cache_base_dir = cache_config.get("cache_dir", "./data/cache")
        self.default_ttl = cache_config.get("default_ttl", 3600 * 24)  # 24 hours
        self.max_cache_size = cache_config.get("max_cache_size", 100 * 1024 * 1024)  # 100MB
        self.enabled = cache_config.get("enabled", True)

        # Cache types definition
        self.cache_types = {
            "games": "games",
            "achievements": "achievements",
            "local_achievements": "local_achievements",
            "steam_store": "steam_store"
        }

        if self.enabled:
            self.setup_cache_directories()
            self.metadata = self.load_metadata()
        else:
            self.metadata = {}

    def setup_cache_directories(self):
        """Create cache directory structure"""
        try:
            for cache_type in self.cache_types.values():
                cache_dir = Path(self.cache_base_dir) / cache_type
                cache_dir.mkdir(parents=True, exist_ok=True)

            print(f"Cache directories initialized at {self.cache_base_dir}")
        except OSError as e:
            print(f"Warning: Could not create cache directories: {e}")
            self.enabled = False

    def load_metadata(self):
        """Load cache metadata from disk"""
        metadata_file = Path(self.cache_base_dir) / "cache_metadata.json"

        try:
            if metadata_file.exists():
                with open(metadata_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            else:
                # Initialize empty metadata structure
                return {cache_type: {} for cache_type in self.cache_types.values()}
        except (json.JSONDecodeError, OSError) as e:
            print(f"Warning: Could not load cache metadata: {e}")
            return {cache_type: {} for cache_type in self.cache_types.values()}

    def save_metadata(self):
        """Save cache metadata to disk"""
        if not self.enabled:
            return False

        metadata_file = Path(self.cache_base_dir) / "cache_metadata.json"

        try:
            with open(metadata_file, 'w', encoding='utf-8') as f:
                json.dump(self.metadata, f, indent=2)
            return True
        except OSError as e:
            print(f"Warning: Could not save cache metadata: {e}")
            return False

    def get_cache_file_path(self, cache_type: str, key: str) -> Path:
        """Generate cache file path for given type and key"""
        safe_key = str(key).replace('/', '_').replace('\\', '_')
        return Path(self.cache_base_dir) / cache_type / f"{safe_key}.json"

    def is_cache_expired(self, cache_type: str, key: str) -> bool:
        """Check if cache entry is expired"""
        if not self.enabled or cache_type not in self.metadata:
            return True

        key_str = str(key)
        if key_str not in self.metadata[cache_type]:
            return True

        entry_metadata = self.metadata[cache_type][key_str]
        created_time = entry_metadata.get("created_time", 0)
        ttl = entry_metadata.get("ttl", self.default_ttl)

        return (time.time() - created_time) > ttl

    def get_cache(self, cache_type: str, key: str) -> Optional[Dict[str, Any]]:
        """Retrieve data from cache"""
        if not self.enabled or self.is_cache_expired(cache_type, key):
            return None

        cache_file = self.get_cache_file_path(cache_type, key)

        try:
            if cache_file.exists():
                with open(cache_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            print(f"Warning: Could not read cache file {cache_file}: {e}")
            # Remove corrupted cache entry
            self.invalidate_cache(cache_type, key)

        return None

    def set_cache(self, cache_type: str, key: str, data: Dict[str, Any], ttl: Optional[int] = None) -> bool:
        """Store data in cache"""
        if not self.enabled:
            return False

        cache_file = self.get_cache_file_path(cache_type, key)
        ttl = ttl or self.default_ttl

        try:
            # Save data to file
            with open(cache_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

            # Update metadata
            key_str = str(key)
            if cache_type not in self.metadata:
                self.metadata[cache_type] = {}

            self.metadata[cache_type][key_str] = {
                "created_time": time.time(),
                "ttl": ttl,
                "size": cache_file.stat().st_size,
                "last_accessed": time.time()
            }

            self.save_metadata()
            return True

        except OSError as e:
            print(f"Warning: Could not write cache file {cache_file}: {e}")
            return False

    def invalidate_cache(self, cache_type: str, key: str) -> bool:
        """Remove specific cache entry"""
        if not self.enabled:
            return False

        cache_file = self.get_cache_file_path(cache_type, key)
        key_str = str(key)

        try:
            # Remove file if exists
            if cache_file.exists():
                cache_file.unlink()

            # Remove from metadata
            if cache_type in self.metadata and key_str in self.metadata[cache_type]:
                del self.metadata[cache_type][key_str]
                self.save_metadata()

            return True

        except OSError as e:
            print(f"Warning: Could not invalidate cache entry: {e}")
            return False

    def clear_cache_type(self, cache_type: str) -> int:
        """Clear all cache entries of specific type"""
        if not self.enabled or cache_type not in self.cache_types.values():
            return 0

        cache_dir = Path(self.cache_base_dir) / cache_type
        removed_count = 0

        try:
            if cache_dir.exists():
                for cache_file in cache_dir.glob("*.json"):
                    cache_file.unlink()
                    removed_count += 1

            # Clear metadata
            if cache_type in self.metadata:
                self.metadata[cache_type] = {}
                self.save_metadata()

            print(f"Cleared {removed_count} cache entries of type '{cache_type}'")
            return removed_count

        except OSError as e:
            print(f"Warning: Could not clear cache type '{cache_type}': {e}")
            return removed_count

    def cleanup_expired(self) -> int:
        """Remove all expired cache entries"""
        if not self.enabled:
            return 0

        removed_count = 0
        current_time = time.time()

        for cache_type in self.metadata:
            expired_keys = []

            for key, entry_metadata in self.metadata[cache_type].items():
                created_time = entry_metadata.get("created_time", 0)
                ttl = entry_metadata.get("ttl", self.default_ttl)

                if (current_time - created_time) > ttl:
                    expired_keys.append(key)

            # Remove expired entries
            for key in expired_keys:
                if self.invalidate_cache(cache_type, key):
                    removed_count += 1

        if removed_count > 0:
            print(f"Cleaned up {removed_count} expired cache entries")

        return removed_count

    def get_cache_stats(self) -> Dict[str, Any]:
        """Get cache statistics"""
        if not self.enabled:
            return {"enabled": False}

        stats = {
            "enabled": True,
            "total_files": 0,
            "total_size": 0,
            "by_type": {}
        }

        for cache_type in self.metadata:
            type_files = len(self.metadata[cache_type])
            type_size = sum(entry.get("size", 0) for entry in self.metadata[cache_type].values())

            stats["by_type"][cache_type] = {
                "files": type_files,
                "size": type_size,
                "size_mb": round(type_size / (1024 * 1024), 2)
            }

            stats["total_files"] += type_files
            stats["total_size"] += type_size

        stats["total_size_mb"] = round(stats["total_size"] / (1024 * 1024), 2)

        return stats
