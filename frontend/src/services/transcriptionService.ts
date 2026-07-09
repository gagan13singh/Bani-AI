// Transcription service for REST API communication

export interface TranscriptionRequest {
  text: string;
  confidence: number;
  session_id?: string;
}

export interface TranscriptionResponse {
  transcribed_text: string;
  confidence: number;
  sggs_match_found: boolean;
  shabad_id: number;
  best_sggs_match: string;
  best_sggs_score: number | null;
  timestamp: number;
}

export interface SearchResult {
  gurmukhi_text: string;
  english_translation: string;
  verse_id: number;
  shabad_id: number;
  source: string;
  writer: string;
  raag: string;
}

export interface FullTranscriptionResponse extends TranscriptionResponse {
  results: SearchResult[];
}

class TranscriptionService {
  private baseUrl: string;
  private sessionId: string;

  constructor() {
    this.baseUrl = process.env.REACT_APP_API_URL || 'http://localhost:8000';
    this.sessionId = this.generateSessionId();
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  async transcribeAndSearch(text: string, confidence: number): Promise<FullTranscriptionResponse> {
    const request: TranscriptionRequest = {
      text,
      confidence,
      session_id: this.sessionId
    };

    try {
      console.log('🎤 Sending to backend:', text);

      // Step 1: Get SGGS fuzzy match and shabad_id from backend
      const response = await fetch(`${this.baseUrl}/api/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const backendData: TranscriptionResponse = await response.json();
      console.log('📥 Backend Shabad ID:', backendData.shabad_id);

      // Step 2: Create results directly from backend shabad_id (no BaniDB search needed)
      let results: SearchResult[] = [];

      if (backendData.sggs_match_found && backendData.shabad_id) {
        console.log(`Using shabad_id directly: ${backendData.shabad_id}`);
        // Create a result object with the shabad_id from backend
        results = [{
          gurmukhi_text: backendData.best_sggs_match,
          english_translation: "", // Will be populated when full shabad is fetched
          verse_id: 0, // Not needed since we have shabad_id
          shabad_id: backendData.shabad_id,
          source: "",
          writer: "",
          raag: ""
        }];
      } else {
        console.log(`No good SGGS match found - no results`);
      }

      if (results.length === 0) {
        console.log('No transcription results found (caller may refresh UI)');
      }

      return {
        ...backendData,
        results
      };
    } catch (error) {
      console.error('Transcription service error:', error);
      throw error;
    }
  }





  getSessionId(): string {
    return this.sessionId;
  }

  resetSession(): void {
    this.sessionId = this.generateSessionId();
  }
}

// Export singleton instance
export const transcriptionService = new TranscriptionService();