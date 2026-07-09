import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import '../App.css';
import FullShabadDisplay from './FullShabadDisplay';
import LoadingOverlay from './LoadingOverlay';
import StickyButtons from './StickyButtons';
import MetadataPills from './MetadataPills';
import SacredWordOverlay from './SacredWordOverlay';
import { transcriptionService } from '../services/transcriptionService';
import { banidbService } from '../services/banidbService';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

interface BaniCoreProps {
    mode: 'kirtan' | 'paath';
}

function BaniCore({ mode }: BaniCoreProps) {
    const navigate = useNavigate();
    const [shabads, setShabads] = useState<any[]>([]);
    const searchTriggered = false;
    const [lastSggsMatchFound, setLastSggsMatchFound] = useState<boolean | null>(null);
    const [lastBestSggsMatch, setLastBestSggsMatch] = useState<string | null>(null);
    const [showLoader, setShowLoader] = useState(true);
    const [userMessage, setUserMessage] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [previousShabadId, setPreviousShabadId] = useState<number | null>(null); // kirtan two-step confirmation

    const shabadsBeingFetched = useRef<Set<number>>(new Set());
    const shabadsLoadedRef = useRef(false);
    const transcriptionSentRef = useRef(false);
    const wordCountTriggeredRef = useRef(false); // paath: single 8-word send
    const processedWordCountRef = useRef(0); // kirtan: words already sent (first 8, then next 8, ...)
    const kirtanConfirmedRef = useRef(false); // kirtan: stop sending after match confirmed
    const [subtitleText, setSubtitleText] = useState('');
    const [showMatchedSubtitle, setShowMatchedSubtitle] = useState(false);
    const [isFiltering, setIsFiltering] = useState(false);
    const MATCH_DISPLAY_DELAY = 1800; // ms

    // Use the new speech recognition hook - keep running even when shabads are loaded
    const {
        isListening,
        transcribedText,
        interimTranscript,
        error,
        noSpeechCount,
        volume,
        start: startSpeechRecognition,
        returnToLoadingOverlay,
        resetTranscription,
        sacredWordOverlay
    } = useSpeechRecognition(shabads.length > 0);

    const resetTranscriptionState = useCallback(() => {
        setShabads([]);
        resetTranscription();
        setLastSggsMatchFound(null);
        setLastBestSggsMatch(null);
        setShowLoader(true);
        shabadsLoadedRef.current = false;
        transcriptionSentRef.current = false;
        wordCountTriggeredRef.current = false;
        processedWordCountRef.current = 0;
        setPreviousShabadId(null);
        kirtanConfirmedRef.current = false;
    }, [resetTranscription]);

    type ShabadMergeMode = 'append' | 'replace';

    const fetchAndAttachShabad = useCallback(
        async (newShabadId: number, merge: ShabadMergeMode) => {
            if (shabads.some(s => s.shabad_id === newShabadId) || shabadsBeingFetched.current.has(newShabadId)) {
                return;
            }
            shabadsBeingFetched.current.add(newShabadId);
            try {
                const shabadData = await banidbService.getFullShabad(newShabadId);
                if (merge === 'replace') {
                    setShabads([shabadData]);
                } else {
                    setShabads(prev => [...prev, shabadData]);
                }
            } catch (err) {
                console.error('Error fetching full shabad:', err);
            } finally {
                shabadsBeingFetched.current.delete(newShabadId);
            }
        },
        [shabads]
    );

    // Send transcription: kirtan = two-step confirmation; paath = single send and show
    const sendTranscription = useCallback(
        async (text: string, confidence: number, opts?: { kirtanBatchWordCount?: number }) => {
            if (noSpeechCount >= 3) return;
            if (transcriptionSentRef.current) return;
            if (isProcessing) return;
            if (mode === 'kirtan' && kirtanConfirmedRef.current) return;
            // In kirtan we keep sending for second detection; in paath stop once shabads are loaded
            if (mode !== 'kirtan' && (shabadsLoadedRef.current || searchTriggered)) return;

            try {
                setIsProcessing(true);
                transcriptionSentRef.current = true;

                const response = await transcriptionService.transcribeAndSearch(text, confidence);

                if (!response.results || response.results.length === 0) {
                    transcriptionSentRef.current = false;
                    // Paath: keep wordCountTriggeredRef true so the same accumulated text cannot
                    // re-trigger send when sendTranscription's identity changes (isProcessing).
                    if (mode === 'kirtan' && opts?.kirtanBatchWordCount != null) {
                        processedWordCountRef.current += opts.kirtanBatchWordCount;
                    }
                    setUserMessage('No results found. Resetting...');
                    setTimeout(() => {
                        resetTranscriptionState();
                    }, 1000);
                    return;
                }

                if (mode === 'kirtan' && opts?.kirtanBatchWordCount != null) {
                    processedWordCountRef.current += opts.kirtanBatchWordCount;
                }

                const newShabadId = response.results[0].shabad_id;

                if (mode === 'kirtan') {
                    // ---- KIRTAN: two-step confirmation ----
                    if (previousShabadId === null) {
                        // First detection: show shabad immediately, store ID, wait for next 8 words
                        setPreviousShabadId(newShabadId);
                        setLastSggsMatchFound(response.sggs_match_found ?? null);
                        setLastBestSggsMatch(response.best_sggs_match ?? null);
                        await fetchAndAttachShabad(newShabadId, 'append');
                    } else {
                        // Second detection (or onward)
                        if (previousShabadId === newShabadId) {
                            // Match confirmed: stop sending until reset
                            kirtanConfirmedRef.current = true;
                            setPreviousShabadId(null);
                            setLastSggsMatchFound(response.sggs_match_found ?? null);
                            setLastBestSggsMatch(response.best_sggs_match ?? null);
                            await fetchAndAttachShabad(newShabadId, 'append');
                        } else {
                            // Mismatch: show new shabad, set as new previous, continue second-detection flow
                            setPreviousShabadId(newShabadId);
                            setLastSggsMatchFound(response.sggs_match_found ?? null);
                            setLastBestSggsMatch(response.best_sggs_match ?? null);
                            await fetchAndAttachShabad(newShabadId, 'replace');
                        }
                    }
                } else {
                    // ---- PAATH: single send and show ----
                    setLastSggsMatchFound(response.sggs_match_found ?? null);
                    setLastBestSggsMatch(response.best_sggs_match ?? null);
                    await fetchAndAttachShabad(newShabadId, 'append');
                }

                transcriptionSentRef.current = false;
                if (mode === 'paath') wordCountTriggeredRef.current = false;
            } catch (err) {
                console.error('Transcription error:', err);
                transcriptionSentRef.current = false;
                wordCountTriggeredRef.current = false;
                setUserMessage('Could not complete search. Resetting...');
                setTimeout(() => {
                    resetTranscriptionState();
                }, 1000);
            } finally {
                setIsProcessing(false);
            }
        },
        [fetchAndAttachShabad, searchTriggered, isProcessing, noSpeechCount, mode, previousShabadId, resetTranscriptionState]
    );

    // Trigger transcription: kirtan = first 8 words then next 8; paath = single 8-word send
    useEffect(() => {
        if (noSpeechCount >= 3) return;
        if (isFiltering) return;

        const combinedText = (transcribedText + ' ' + interimTranscript).trim();
        if (!combinedText) return;

        setIsFiltering(true);

        try {
            const words = combinedText.split(/\s+/).filter(Boolean);
            const totalWords = words.length;

            if (mode === 'kirtan') {
                // Stop sending after a match is confirmed; only send while waiting for second detection
                if (!kirtanConfirmedRef.current && totalWords - processedWordCountRef.current >= 8) {
                    const nextEight = words.slice(
                        processedWordCountRef.current,
                        processedWordCountRef.current + 8
                    );
                    const batchText = nextEight.join(' ');
                    sendTranscription(batchText, 0.8, { kirtanBatchWordCount: nextEight.length });
                }
            } else {
                // Paath: single send when 8+ words
                if (totalWords >= 8 && !wordCountTriggeredRef.current && !shabadsLoadedRef.current && !transcriptionSentRef.current) {
                    wordCountTriggeredRef.current = true;
                    sendTranscription(combinedText, 0.8);
                }
            }
        } finally {
            setIsFiltering(false);
        }
    }, [transcribedText, interimTranscript, sendTranscription, noSpeechCount, isFiltering, mode]);

    // Handle speech recognition errors
    useEffect(() => {
        if (error) {
            setUserMessage(`Speech error: ${error}`);
        } else if (!isProcessing) {
            // Only clear message if not processing to avoid clearing processing messages
            setUserMessage('');
        }
    }, [error, isProcessing]);

    // Handle returning to loading overlay when max no-speech errors reached
    useEffect(() => {
        if (noSpeechCount >= 3 && shabads.length > 0) {
            setShowLoader(true);
            setShabads([]);
            resetTranscription();
            transcriptionSentRef.current = false;
            wordCountTriggeredRef.current = false;
            processedWordCountRef.current = 0;
            setPreviousShabadId(null);
            kirtanConfirmedRef.current = false;
            shabadsLoadedRef.current = false;
            setSubtitleText('');
            setShowMatchedSubtitle(false);
            setLastSggsMatchFound(null);
            setLastBestSggsMatch(null);
            setTimeout(() => {
                setSubtitleText('');
                resetTranscription();
            }, 10);
        }
    }, [noSpeechCount, shabads.length, resetTranscription]);

    // Hide loader as soon as a shabad is found
    useEffect(() => {
        if (shabads.length > 0) {
            setShowLoader(false);
            shabadsLoadedRef.current = true; // Update ref when shabads are loaded
        }
    }, [shabads]);

    // Show live transcription as subtitle during loading (FILTERED)
    useEffect(() => {
        // Immediately clear subtitle if max no-speech errors reached
        if (noSpeechCount >= 3) {
            setSubtitleText('');
            return;
        }

        if (showLoader && !showMatchedSubtitle && !shabadsLoadedRef.current && noSpeechCount < 3) {
            // Use pre-filtered text from speech recognition hook
            const subtitle = (transcribedText + ' ' + interimTranscript).trim();
            setSubtitleText(subtitle);
        }
    }, [transcribedText, interimTranscript, showLoader, showMatchedSubtitle, noSpeechCount]);

    // When SGGS match is found, show matched text as subtitle, then transition
    useEffect(() => {
        if (showLoader && lastSggsMatchFound && lastBestSggsMatch) {
            setShowMatchedSubtitle(true);
            setSubtitleText(lastBestSggsMatch);
            const timer = setTimeout(() => {
                setShowLoader(false);
                setShowMatchedSubtitle(false);
            }, MATCH_DISPLAY_DELAY);
            return () => clearTimeout(timer);
        }
    }, [showLoader, lastSggsMatchFound, lastBestSggsMatch]);


    // Automatically start speech recognition on mount - SpeechRecognitionManager handles all restarts internally
    useEffect(() => {
        startSpeechRecognition();
    }, [startSpeechRecognition]);

    // Expose reset function for development/testing
    useEffect(() => {
        if (process.env.NODE_ENV === 'development') {
            (window as any).resetBaniAI = resetTranscriptionState;
            (window as any).returnToLoading = () => {
                setShowLoader(true);
                returnToLoadingOverlay();
            };
        }
    }, [resetTranscriptionState, returnToLoadingOverlay]);

    // Callback to fetch next shabad
    const handleNeedNextShabad = useCallback(async () => {
        const lastShabad = shabads[shabads.length - 1];
        const nextShabadId = lastShabad?.navigation?.next;
        console.log(`[PAGINATION] Attempting to fetch next shabad. Current: ${lastShabad?.shabad_id}, Next: ${nextShabadId}`);

        if (
            nextShabadId &&
            !shabads.some(s => s.shabad_id === nextShabadId) &&
            !shabadsBeingFetched.current.has(nextShabadId)
        ) {
            console.log(`[PAGINATION] Fetching shabad ${nextShabadId}`);
            shabadsBeingFetched.current.add(nextShabadId);
            try {
                const data = await banidbService.getFullShabad(nextShabadId);
                setShabads(prev => {
                    console.log(`[PAGINATION] Successfully fetched shabad ${nextShabadId}, total shabads: ${prev.length + 1}`);
                    return [...prev, data];
                });
            } catch (err) {
                console.error('Error fetching next shabad:', err);
            } finally {
                shabadsBeingFetched.current.delete(nextShabadId);
            }
        } else {
            console.log(`[PAGINATION] Skipping fetch - nextShabadId: ${nextShabadId}, already exists: ${shabads.some(s => s.shabad_id === nextShabadId)}, being fetched: ${shabadsBeingFetched.current.has(nextShabadId)}`);
        }
    }, [shabads]);

    return (
        <>
            <button
                className="back-button"
                onClick={() => navigate('/')}
            >
                ← Back
            </button>
            <LoadingOverlay
                className={showLoader ? '' : 'fade-out'}
                volume={volume}
                subtitle={showLoader ? subtitleText : undefined}
            />
            <SacredWordOverlay
                isVisible={sacredWordOverlay.isVisible}
                sacredWord={sacredWordOverlay.sacredWord}
            />
            <div style={{ display: showLoader ? 'none' : 'block' }}>
                <div className="App">
                    <header className="App-header">
                        <h1>ੴ Bani AI - {mode === 'kirtan' ? 'Kirtan Mode' : 'Paath Mode'}</h1>
                        <p>Real-time Punjabi Audio Transcription & BaniDB Search</p>
                        {userMessage && (
                            <div className="user-message" style={{ color: '#ffb347', fontWeight: 600, margin: '1rem 0' }}>
                                {userMessage}
                            </div>
                        )}
                        <div className="connection-status">
                            <span className={`status-indicator ${isProcessing ? 'connecting' : error ? 'disconnected' : 'connected'}`}>
                                {isProcessing ? '🟡' : error ? '🔴' : '🟢'}
                            </span>
                            <span className="status-text">
                                {isProcessing ? 'Processing...' : error ? `Error: ${error}` : isListening ? 'Listening...' : 'Ready for transcription'}
                            </span>
                        </div>
                    </header>

                    {/* Sticky Pills + Buttons Row */}
                    {shabads.length > 0 && (
                        <div className="sticky-header-row">
                            <div className="sticky-header-left">
                                <MetadataPills
                                    raag={shabads[0]?.raag}
                                    writer={shabads[0]?.writer}
                                    page={shabads[0]?.page_no}
                                />
                                <StickyButtons />
                            </div>
                        </div>
                    )}

                    <main className="App-main">
                        {/* Show Full Shabad box if present */}
                        {shabads.length > 0 && (
                            <div className="panel-header search-results" style={{ marginBottom: '2rem' }}>
                                <FullShabadDisplay
                                    shabads={shabads}
                                    transcribedText={(() => {
                                        // Use pre-filtered text from speech recognition hook
                                        const combined = (transcribedText + ' ' + interimTranscript).trim();
                                        const words = combined.split(/\s+/);
                                        const last4Words = words.slice(-4).join(' ');
                                        return last4Words;
                                    })()}
                                    onNeedNextShabad={handleNeedNextShabad}
                                />
                            </div>
                        )}

                        {error && (
                            <div className="error-message">
                                ⚠️ {error}
                            </div>
                        )}
                    </main>
                </div>
            </div>
        </>
    );
}

export default BaniCore;
