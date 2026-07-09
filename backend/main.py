from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional
import logging
import os
import asyncio
import time
import unicodedata
import sqlite3
import aiosqlite
from rapidfuzz import fuzz, process
from functools import lru_cache

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Pydantic models for REST API
class TranscriptionRequest(BaseModel):
    text: str = Field(..., max_length=500)
    confidence: float
    session_id: Optional[str] = None

class TranscriptionResponse(BaseModel):
    transcribed_text: str
    confidence: float
    sggs_match_found: bool
    shabad_id: int
    best_sggs_match: str
    best_sggs_score: Optional[float]
    timestamp: float

app = FastAPI(title="Bani AI Transcription", version="1.0.0")

# CORS middleware for frontend communication
allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Database Fuzzy Search Setup ---
from pathlib import Path

DATABASE_PATH = Path(__file__).parent / "uploads" / "shabads_verses_Optimised_SGGS_window8words_step2_byShabad.db"
FOUR_WORD_DATABASE_PATH = Path(__file__).parent / "uploads" / "shabads_verses_cleaned_atLeast_FOUR_words.db"
VERSES_DATA = []  # List of (ShabadID, GurmukhiUni) tuples
VERSES_DATA_4WORDS = []  # List of (ShabadID, GurmukhiUni) for repetitive-query search
DATABASE_LOADED = False
DATABASE_4WORDS_LOADED = False
FUZZY_THRESHOLD = float(os.getenv("FUZZY_MATCH_THRESHOLD", "60"))
REPETITION_RATIO_THRESHOLD = 80  # first_half vs second_half ratio above this => treat as repetitive

# Async loading of database verses
async def load_database_verses():
    """Asynchronously load all verses from SQLite databases (main + 4-word for repetitive handling)"""
    global VERSES_DATA, VERSES_DATA_4WORDS, DATABASE_LOADED, DATABASE_4WORDS_LOADED

    if DATABASE_PATH.exists():
        try:
            async with aiosqlite.connect(DATABASE_PATH) as db:
                async with db.execute("SELECT ShabadID, GurmukhiUni FROM Verse") as cursor:
                    rows = await cursor.fetchall()
                    VERSES_DATA = [(row[0], unicodedata.normalize('NFC', row[1])) for row in rows]
            DATABASE_LOADED = True
            logger.info(f"Loaded {len(VERSES_DATA)} verses from database for fuzzy search.")
        except Exception as e:
            logger.error(f"Error loading database: {e}")
            DATABASE_LOADED = False
    else:
        logger.warning(f"Database not found at {DATABASE_PATH}. Fuzzy search will be disabled.")

    if FOUR_WORD_DATABASE_PATH.exists():
        try:
            async with aiosqlite.connect(FOUR_WORD_DATABASE_PATH) as db:
                async with db.execute("SELECT ShabadID, GurmukhiUni FROM Verse") as cursor:
                    rows = await cursor.fetchall()
                    VERSES_DATA_4WORDS = [(row[0], unicodedata.normalize('NFC', row[1])) for row in rows]
            DATABASE_4WORDS_LOADED = True
            logger.info(f"Loaded {len(VERSES_DATA_4WORDS)} verses from 4-word database for repetitive-query search.")
        except Exception as e:
            logger.error(f"Error loading 4-word database: {e}")
            DATABASE_4WORDS_LOADED = False
    else:
        logger.warning(f"4-word database not found at {FOUR_WORD_DATABASE_PATH}. Repetitive-query path disabled.")



@lru_cache(maxsize=1000)
def fuzzy_search_database(query: str, threshold: float = FUZZY_THRESHOLD):
    """Fuzzy search using database verses - batch scoring with fuzz.ratio"""
    logger.info(f"DEBUG SEARCH: Starting search for query='{query}', threshold={threshold}")
    
    if not DATABASE_LOADED or not query.strip():
        logger.info("DEBUG SEARCH: Database not loaded or empty query")
        return None, None, None
    
    normalized_query = unicodedata.normalize('NFC', query.strip())
    words = normalized_query.split()

    # Repetitive transcription: split 8-word query into two halves of 4; if halves are very similar, search first half only with partial_ratio on 4-word DB
    if len(words) >= 8:
        first_half = " ".join(words[0:4])
        second_half = " ".join(words[4:8])
        half_ratio = fuzz.ratio(first_half, second_half)
        if half_ratio > REPETITION_RATIO_THRESHOLD and DATABASE_4WORDS_LOADED:
            logger.info(f"DEBUG SEARCH: Repetitive query detected (halves ratio={half_ratio:.1f} > {REPETITION_RATIO_THRESHOLD}). Searching first half with partial_ratio on 4-word DB.")
            verse_texts_4 = [v[1] for v in VERSES_DATA_4WORDS]
            batch_results = process.extract(
                first_half,
                verse_texts_4,
                scorer=fuzz.partial_ratio,
                limit=len(verse_texts_4),
                score_cutoff=0,
            )
            if batch_results:
                verse_text, score, original_index = batch_results[0]
                best_shabad_id = VERSES_DATA_4WORDS[original_index][0]
                logger.info(f"DEBUG SEARCH: Best partial_ratio match - ShabadID: {best_shabad_id}, score: {score:.2f} | '{verse_text}'")
                if score >= threshold:
                    return verse_text, best_shabad_id, score
                return None, None, None

    # Step 1: Batch process all verses using rapidfuzz.process for optimal performance
    logger.info(f"DEBUG SEARCH: Step 1 - Batch scoring all {len(VERSES_DATA)} verses with rapidfuzz.process")
    
    # Extract just the verse texts for batch processing
    verse_texts = [verse_text for shabad_id, verse_text in VERSES_DATA]
    
    # Use rapidfuzz.process.extract for batch processing - much faster than individual fuzz.ratio calls
    # This uses optimized C++ implementation and can utilize multiple cores
    batch_results = process.extract(
        normalized_query, 
        verse_texts, 
        scorer=fuzz.ratio,
        limit=len(verse_texts),  # Get all results
        score_cutoff=0  # No cutoff, we'll filter later
    )
    
    # Convert batch results back to our format with original indices and shabad_ids
    # Results from process.extract are already sorted by score (descending)
    all_scores = []
    for verse_text, score, original_index in batch_results:
        shabad_id = VERSES_DATA[original_index][0]  # Get shabad_id from original data
        all_scores.append((original_index, shabad_id, verse_text, score))
    
    # Best candidate is the highest fuzz.ratio score from batch verse scoring (first result)
    if not all_scores:
        logger.info("DEBUG SEARCH: No results from batch scoring")
        return None, None, None
    
    verse_idx, best_shabad_id, best_verse, best_score = all_scores[0]
    logger.info(f"DEBUG SEARCH: Best match - Verse {verse_idx} (ShabadID: {best_shabad_id}): {best_score:.2f} | '{best_verse}'")

    # Return the best result if above threshold
    if best_score >= threshold:
        return best_verse, best_shabad_id, best_score
    # elif best_score >= 55:  # I want to be more strict about the threshold of 60, so we are not returning any matches below 60
      #  return best_verse, best_shabad_id, best_score
    else:
        logger.info("DEBUG SEARCH: No matches found above threshold")
        return None, None, None



@app.get("/")
async def root():
    return {"message": "Waheguru ji ka Khalsa, Waheguru ji ki Fateh - Bani AI Transcription API"}

@app.get("/api/health")
async def health_check():
    is_healthy = DATABASE_LOADED and DATABASE_4WORDS_LOADED
    return {
        "status": "healthy" if is_healthy else "degraded",
        "service": "Bani AI Transcription",
        "main_database_loaded": DATABASE_LOADED,
        "main_verse_count": len(VERSES_DATA),
        "repetition_database_loaded": DATABASE_4WORDS_LOADED,
        "repetition_verse_count": len(VERSES_DATA_4WORDS)
    }

@app.post("/api/transcribe")
async def transcribe_and_search(request: TranscriptionRequest) -> TranscriptionResponse:
    """Process transcription and return database fuzzy search results"""
    transcribed_text = request.text
    confidence = request.confidence
    
    logger.info(f"Received transcription: {transcribed_text} (confidence: {confidence})")

    # Fuzzy search database
    loop = asyncio.get_event_loop()
    best_verse, best_shabad_id, best_score = await loop.run_in_executor(
        None, fuzzy_search_database, transcribed_text, FUZZY_THRESHOLD
    )
    logger.info(f"Fuzzy search threshold: {FUZZY_THRESHOLD}")
    
    sggs_match_found = False
    shabad_id = 0
    best_sggs_match = ""
    best_sggs_score = None
    
    if best_verse and best_shabad_id and best_score:
        shabad_id = best_shabad_id
        best_sggs_match = best_verse
        best_sggs_score = best_score
        logger.info(f"Best fuzzy match: Score={best_score:.2f}, ShabadID={best_shabad_id}")
        logger.info(f"Verse: '{best_verse}'")
        logger.info(f"Transcription: '{transcribed_text}'")
        
        if best_score >= FUZZY_THRESHOLD:
            sggs_match_found = True
        else:
            logger.info(f"Best match below threshold ({FUZZY_THRESHOLD}). No match used.")
    else:
        logger.info("No fuzzy matches found at all.")

    return TranscriptionResponse(
        transcribed_text=transcribed_text,
        confidence=confidence,
        sggs_match_found=sggs_match_found,
        shabad_id=shabad_id,
        best_sggs_match=best_sggs_match,
        best_sggs_score=best_sggs_score,
        timestamp=time.time()
    )



if os.getenv("ENABLE_DEBUG_ENDPOINTS", "false").lower() == "true":
    @app.get("/api/test-database-search")
    async def test_database_search_endpoint(query: str):
        """Test endpoint to check database fuzzy search functionality"""
        loop = asyncio.get_event_loop()
        best_verse, best_shabad_id, best_score = await loop.run_in_executor(
            None, fuzzy_search_database, query
        )
        
        return {
            "query": query,
            "database_loaded": DATABASE_LOADED,
            "total_verses": len(VERSES_DATA),
            "best_match": {
                "verse": best_verse,
                "shabad_id": best_shabad_id,
                "score": best_score
            } if best_verse else None,
            "configuration": {
                "fuzzy_threshold": FUZZY_THRESHOLD,
                "scorer": "fuzz.ratio"
            }
        }

@app.on_event("startup")
async def startup_event():
    """Initialize async tasks on startup"""
    # Load database verses asynchronously
    await load_database_verses()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 