import pytest
import sys
from pathlib import Path

# Add backend directory to sys.path
sys.path.append(str(Path(__file__).parent.parent))

from main import fuzzy_search_database

def test_no_match_returns_none_below_threshold():
    # If DB is not loaded or query is empty/unmatched, should return None
    verse, shabad_id, score = fuzzy_search_database("zzz not gurbani zzz", threshold=90)
    assert verse is None
    assert shabad_id is None
    assert score is None

def test_empty_query_returns_none():
    verse, shabad_id, score = fuzzy_search_database("", threshold=60)
    assert verse is None
    assert shabad_id is None
    assert score is None
