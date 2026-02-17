import React, { useEffect, useMemo, useState } from 'react';

const TypingText = ({
  words = [],
  typingSpeed = 70,
  deletingSpeed = 45,
  pauseMs = 1200,
  preserveWidth = true,
  className = '',
}) => {
  const safeWords = useMemo(() => {
    return Array.isArray(words) && words.length > 0 ? words : [''];
  }, [words]);
  const longestWordLength = useMemo(
    () => safeWords.reduce((max, word) => Math.max(max, String(word || '').length), 0),
    [safeWords]
  );
  const [wordIndex, setWordIndex] = useState(0);
  const [typed, setTyped] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const currentWord = safeWords[wordIndex];
    const doneTyping = typed === currentWord;
    const doneDeleting = typed.length === 0;

    let timeout;

    if (doneTyping && !isDeleting) {
      timeout = setTimeout(() => setIsDeleting(true), pauseMs);
    } else if (doneDeleting && isDeleting) {
      setIsDeleting(false);
      setWordIndex((prev) => (prev + 1) % safeWords.length);
    } else {
      timeout = setTimeout(
        () => {
          setTyped((prev) =>
            isDeleting ? currentWord.slice(0, Math.max(prev.length - 1, 0)) : currentWord.slice(0, prev.length + 1)
          );
        },
        isDeleting ? deletingSpeed : typingSpeed
      );
    }

    return () => clearTimeout(timeout);
  }, [typed, isDeleting, wordIndex, safeWords, typingSpeed, deletingSpeed, pauseMs]);

  return (
    <span
      className={`inline-flex items-baseline max-w-full whitespace-nowrap ${className}`}
      style={
        preserveWidth
          ? { width: `min(100%, ${Math.max(longestWordLength + 1, 12)}ch)` }
          : undefined
      }
    >
      <span>{typed || '\u00A0'}</span>
      <span className="animate-pulse ml-0.5">|</span>
    </span>
  );
};

export default TypingText;
