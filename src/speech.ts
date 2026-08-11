export type SpeechSynthesisAdapter = {
  cancel: () => void;
  speak: (utterance: SpeechSynthesisUtterance) => void;
  createUtterance: (text: string) => SpeechSynthesisUtterance;
};

export function getBrowserSpeechAdapter(): SpeechSynthesisAdapter | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return null;
  return {
    cancel: () => window.speechSynthesis.cancel(),
    speak: (utterance) => window.speechSynthesis.speak(utterance),
    createUtterance: (text) => new SpeechSynthesisUtterance(text),
  };
}

export function speakEnglish(text: string, adapter: SpeechSynthesisAdapter, onFinish?: () => void, onError?: () => void) {
  const value = text.trim();
  if (!value) return null;
  const utterance = adapter.createUtterance(value);
  utterance.lang = 'en-US';
  utterance.rate = 1;
  utterance.onend = () => onFinish?.();
  utterance.onerror = () => onError?.();
  adapter.cancel();
  adapter.speak(utterance);
  return utterance;
}
